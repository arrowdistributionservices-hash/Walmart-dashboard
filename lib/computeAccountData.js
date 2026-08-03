import {
  getAllOrdersAllFulfillmentTypes,
  aggregateRevenueByDay,
  aggregateRevenueByOrderId,
  extractAllOrderLineItems,
  getReconDataForDateRange,
  aggregateReconByDay,
  aggregateReconByOrder,
  buildFeeCostBreakdown,
} from "./walmartClient";
import { buildFifoQueues, createFifoAllocator } from "./costSheetCsv";
import { getAccount, getAccountCredentials } from "./accounts";
import { buildFeeModel, estimateLine } from "./feeEstimator";

/**
 * Computes the full dashboard payload (totals, daily breakdown, order-level
 * breakdown, cost coverage) for a single account over a date range. This is
 * the one place that logic lives - the per-account API route, the
 * all-accounts summary route, and the export routes all call this.
 */
export async function computeAccountData(accountId, { startDate, endDate }) {
  const account = getAccount(accountId);
  const { configured } = getAccountCredentials(accountId);
  if (!configured) {
    return { accountId, accountName: account.name, configured: false };
  }

  const orders = await getAllOrdersAllFulfillmentTypes(accountId, {
    createdStartDate: `${startDate}T00:00:00.000Z`,
    createdEndDate: `${endDate}T23:59:59.999Z`,
  });
  const ordersByDay = aggregateRevenueByDay(orders);
  const ordersByOrderId = aggregateRevenueByOrderId(orders);

  const { rows: reconRows, settledThroughDate } = await getReconDataForDateRange(accountId, {
    startDate,
    endDate,
  });
  const reconByDay = aggregateReconByDay(reconRows);
  const reconByOrder = aggregateReconByOrder(reconRows);
  // Only settled rows go into the human-facing breakdown - it names real
  // Walmart-reported categories, so it shouldn't include anything from the
  // fee estimator (which only predicts a blended commission + flat-fee
  // total, not a full category split).
  const settledReconRows = reconRows.filter((row) => {
    const posted = new Date(row["Transaction Posted Timestamp"]);
    if (Number.isNaN(posted.getTime())) return false;
    const postedDate = posted.toISOString().slice(0, 10);
    return !settledThroughDate || postedDate <= settledThroughDate;
  });
  const feeCostBreakdown = buildFeeCostBreakdown(settledReconRows);

  // --- Cost sheet data (item cost / COGS, from every uploaded sheet so far) ---
  // Uses a direct, explicitly uncached fetch to Upstash's REST API instead
  // of the @vercel/kv package. @vercel/kv was observed serving a stale
  // cached response for this exact call site - a cost sheet removal was
  // confirmed (via raw REST + the kv package both) to have persisted
  // correctly in Upstash, and a brand-new route reading the same key via
  // @vercel/kv immediately saw the update, but THIS call site kept
  // returning the pre-removal data for many minutes across multiple fresh
  // deployments. Bypassing the package's fetch wrapper resolved it.
  async function getCostSheetUploadsFresh(accountId) {
    const res = await fetch(
      `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(`costsheet:all-uploads:${accountId}`)}`,
      { headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }, cache: "no-store" }
    );
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.result) return [];
    const parsed = JSON.parse(json.result);
    return Array.isArray(parsed) ? parsed : [];
  }
  const allCostSheetUploads = await getCostSheetUploadsFresh(accountId);

  let fifoAllocator = null;
  let costMeta = null;

  if (allCostSheetUploads.length > 0) {
    const { queues, aliasToCanonical } = buildFifoQueues(allCostSheetUploads.map((u) => u.csvText));
    fifoAllocator = createFifoAllocator({ queues, aliasToCanonical });
    const latest = allCostSheetUploads[allCostSheetUploads.length - 1];
    costMeta = {
      filename: latest.filename,
      uploadedAt: latest.uploadedAt,
      totalUploads: allCostSheetUploads.length,
      uploadedFiles: allCostSheetUploads.map((u) => u.filename),
    };
  }

  // --- Match order line items against the cost sheet to compute COGS ---
  const allLines = extractAllOrderLineItems(orders).filter(
    (line) => line.orderDate && line.orderDate >= startDate && line.orderDate <= endDate
  );

  // --- Estimate fees/incentives for orders whose settlement hasn't posted ---
  // An order is only "settled" if BOTH of these hold:
  //  1. its date is on/before settledThroughDate, and
  //  2. it actually has a matching row in the Recon Report (reconByOrder).
  // (1) alone is not reliable: settledThroughDate is a MAX across every row
  // Walmart has published, but individual orders inside that window can
  // still have zero rows reported - the recon pipeline doesn't process every
  // order in strict date order, so a same-day order can simply fall through
  // to the next report cycle. Checking (2) directly catches those orders
  // that a pure date cutoff misses (confirmed via a live diagnostic: an
  // order dated one day before the watermark had zero matching rows
  // anywhere in ~375 recon rows for the account). Rather than show $0 for
  // anything unsettled, learn a fee-rate/incentive-rate per SKU (falling
  // back to price band, then account-wide average) from orders that HAVE
  // settled, and apply it to the rest. Callers keep using the existing
  // `feesPending` flag to mark these provisional (the "*" in the UI).
  const orderIsSettled = (orderId, orderDate) => {
    if (!reconByOrder[orderId]) return false;
    if (settledThroughDate && orderDate && orderDate > settledThroughDate) return false;
    return true;
  };

  const settledLinesForModel = allLines.filter((line) => orderIsSettled(line.purchaseOrderId, line.orderDate));
  const pendingLines = allLines.filter((line) => !orderIsSettled(line.purchaseOrderId, line.orderDate));
  const feeModel = buildFeeModel(settledLinesForModel, reconByOrder);

  const estFeeByOrderId = {};
  const estIncentiveByOrderId = {};
  for (const line of pendingLines) {
    const { estimatedFee, estimatedIncentive } = estimateLine(line, feeModel);
    if (line.purchaseOrderId) {
      estFeeByOrderId[line.purchaseOrderId] = (estFeeByOrderId[line.purchaseOrderId] || 0) + estimatedFee;
      estIncentiveByOrderId[line.purchaseOrderId] =
        (estIncentiveByOrderId[line.purchaseOrderId] || 0) + estimatedIncentive;
    }
  }

  // --- Match order line items against the cost sheet to compute COGS,
  // using FIFO: sold units are priced against purchased units in the order
  // both actually happened, so the same SKU showing up at different costs
  // on different cost-sheet uploads (re-sourced later at a different
  // price) is costed the way real inventory turns over, not "whichever
  // sheet happened to be uploaded last". Sales must be processed oldest
  // first for this to be correct - allLines itself isn't guaranteed to be
  // in date order, so sort a working copy for this pass only. ---
  const linesForCosting = [...allLines].sort((a, b) => {
    const dateCompare = (a.orderDate || "").localeCompare(b.orderDate || "");
    if (dateCompare !== 0) return dateCompare;
    const orderCompare = String(a.purchaseOrderId || "").localeCompare(String(b.purchaseOrderId || ""));
    if (orderCompare !== 0) return orderCompare;
    return (Number(a.lineNumber) || 0) - (Number(b.lineNumber) || 0);
  });

  const itemCostByDay = {};
  const itemCostByOrderId = {};
  const unmatchedLinesByOrderId = {};
  const fifoFallbackLinesByOrderId = {}; // sold more than was ever logged as purchased
  let matchedLineCount = 0;
  let unmatchedLineCount = 0;
  let fifoFallbackLineCount = 0;
  let matchedRevenue = 0;
  let unmatchedRevenue = 0;
  const unmatchedSkuCounts = {};

  for (const line of linesForCosting) {
    const result = fifoAllocator
      ? fifoAllocator.consume({ sku: line.sku, upc: line.upc, quantity: line.quantity || 1 })
      : null;

    if (result) {
      matchedLineCount++;
      matchedRevenue += line.revenue;
      itemCostByDay[line.orderDate] = (itemCostByDay[line.orderDate] || 0) + result.totalCost;
      if (line.purchaseOrderId) {
        itemCostByOrderId[line.purchaseOrderId] = (itemCostByOrderId[line.purchaseOrderId] || 0) + result.totalCost;
        if (result.usedFallback) {
          fifoFallbackLinesByOrderId[line.purchaseOrderId] = (fifoFallbackLinesByOrderId[line.purchaseOrderId] || 0) + 1;
          fifoFallbackLineCount++;
        }
      }
    } else {
      unmatchedLineCount++;
      unmatchedRevenue += line.revenue;
      if (line.purchaseOrderId) {
        unmatchedLinesByOrderId[line.purchaseOrderId] = (unmatchedLinesByOrderId[line.purchaseOrderId] || 0) + 1;
      }
      const label = line.sku || line.title || "(no SKU)";
      if (!unmatchedSkuCounts[label]) unmatchedSkuCounts[label] = { count: 0, revenue: 0, title: line.title };
      unmatchedSkuCounts[label].count++;
      unmatchedSkuCounts[label].revenue += line.revenue;
    }
  }

  const topUnmatchedSkus = Object.entries(unmatchedSkuCounts)
    .map(([sku, v]) => ({ sku, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15);

  const costCoverage = costMeta
    ? {
        totalLines: allLines.length,
        matchedLines: matchedLineCount,
        unmatchedLines: unmatchedLineCount,
        matchedRevenue,
        unmatchedRevenue,
        fifoFallbackLines: fifoFallbackLineCount,
        topUnmatchedSkus,
      }
    : null;

  // --- Group line items by order so each order row can show what was
  // actually sold (title, SKU, quantity, unit price), not just a revenue
  // total. Most orders in this business are single-item; multi-item orders
  // get every line listed. ---
  const itemsByOrderId = {};
  for (const line of allLines) {
    if (!line.purchaseOrderId) continue;
    (itemsByOrderId[line.purchaseOrderId] ||= []).push({
      title: line.title,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: line.revenue / (line.quantity || 1),
    });
  }

  function formatItemTitle(items) {
    if (!items || !items.length) return "";
    const parts = items.map((it) => {
      const label = it.title || it.sku || "(unknown item)";
      return it.quantity > 1 ? `${it.quantity}x ${label}` : label;
    });
    return parts.length === 1 ? parts[0] : `${parts[0]} +${parts.length - 1} more`;
  }

  function formatItemSku(items) {
    if (!items || !items.length) return "";
    const skus = items.map((it) => it.sku || "(no SKU)");
    return skus.length === 1 ? skus[0] : `${skus[0]} +${skus.length - 1} more`;
  }

  // --- Build order-level breakdown first (daily is derived from this, so
  // the two views can never disagree about which orders are settled) ---
  const allOrderIds = new Set([
    ...Object.keys(ordersByOrderId),
    ...Object.keys(reconByOrder),
    ...Object.keys(itemCostByOrderId),
  ]);
  const orderLevel = [...allOrderIds].map((orderId) => {
    const walmartOrdersRev = ordersByOrderId[orderId]?.revenue || 0;
    // Orders API only returns orders CREATED within the queried range, so an
    // order created earlier (outside the range) whose refund/adjustment
    // SETTLES within it has no entry here and no orderDate. Without a
    // fallback, this row has no date to be bucketed into daily/totals by and
    // gets silently dropped from every aggregate figure below, even though
    // it's computed correctly - use the date its recon activity posted.
    const orderDate = ordersByOrderId[orderId]?.orderDate || reconByOrder[orderId]?.postedDate || null;
    const feesPending = !orderIsSettled(orderId, orderDate);
    const incentive = feesPending ? estIncentiveByOrderId[orderId] || 0 : reconByOrder[orderId]?.incentive || 0;
    const fees = feesPending ? estFeeByOrderId[orderId] || 0 : reconByOrder[orderId]?.fees || 0;
    // refundAmount is the customer-refunded portion of the sale (a negative
    // "Product Price" amount from the recon report - see isRefundRow in
    // walmartClient.js). It's sourced from the ORDERS API for walmartOrdersRev
    // above, which doesn't know about refunds issued later, so it must be
    // folded in here or a returned order keeps showing its full original-sale
    // profit as if the customer had kept the item. refundProcessingFee is
    // NOT added again here - it already lands inside `fees` (its Amount Type
    // is "Fee/Reimbursement", one of FLAT_FEE_AMOUNT_TYPES), it's only broken
    // out separately for display.
    const refundAmount = feesPending ? 0 : reconByOrder[orderId]?.refundAmount || 0;
    const refundProcessingFee = feesPending ? 0 : reconByOrder[orderId]?.refundProcessingFee || 0;
    const walmartTotal = walmartOrdersRev + incentive + refundAmount;
    const netAfterFees = walmartTotal + fees;
    const itemCost = itemCostByOrderId[orderId] || 0;
    const profit = netAfterFees - itemCost;
    const unmatchedLineItems = unmatchedLinesByOrderId[orderId] || 0;
    const items = itemsByOrderId[orderId] || [];
    return {
      orderId,
      date: orderDate,
      itemTitle: formatItemTitle(items),
      itemSku: formatItemSku(items),
      items,
      walmartOrdersRev,
      incentive,
      fees,
      walmartTotal,
      netAfterFees,
      itemCost,
      profit,
      costMatched: itemCost > 0 && unmatchedLineItems === 0,
      unmatchedLineItems,
      costEstimated: (fifoFallbackLinesByOrderId[orderId] || 0) > 0,
      feesPending,
      status: feesPending ? "Pending" : "Settled",
      refundAmount,
      refundProcessingFee,
    };
  });
  orderLevel.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // --- Build daily breakdown by summing the order-level fees/incentive
  // above, instead of a separately-aggregated day-level recon rollup - keeps
  // daily and order-level numbers consistent, and a day is only marked
  // "pending" (*) if at least one of its orders actually is. ---
  const feesByDay = {};
  const incentiveByDay = {};
  const pendingByDay = {};
  const refundAmountByDay = {};
  const refundProcessingFeeByDay = {};
  for (const o of orderLevel) {
    if (!o.date) continue;
    feesByDay[o.date] = (feesByDay[o.date] || 0) + o.fees;
    incentiveByDay[o.date] = (incentiveByDay[o.date] || 0) + o.incentive;
    refundAmountByDay[o.date] = (refundAmountByDay[o.date] || 0) + o.refundAmount;
    refundProcessingFeeByDay[o.date] = (refundProcessingFeeByDay[o.date] || 0) + o.refundProcessingFee;
    if (o.feesPending) pendingByDay[o.date] = true;
  }

  const allDays = new Set([
    ...Object.keys(ordersByDay),
    ...Object.keys(reconByDay),
    ...Object.keys(itemCostByDay),
    ...orderLevel.map((o) => o.date).filter(Boolean),
  ]);
  const daily = [...allDays].sort().map((date) => {
    const ordersRev = ordersByDay[date] || 0;
    const incentive = incentiveByDay[date] || 0;
    const fees = feesByDay[date] || 0;
    const refundAmount = refundAmountByDay[date] || 0;
    const refundProcessingFee = refundProcessingFeeByDay[date] || 0;
    const walmartTotal = ordersRev + incentive + refundAmount;
    const netAfterFees = walmartTotal + fees;
    const itemCost = itemCostByDay[date] || 0;
    const profit = netAfterFees - itemCost;
    const feesPending = !!pendingByDay[date];
    return {
      date,
      ordersRev,
      incentive,
      fees,
      walmartTotal,
      netAfterFees,
      itemCost,
      profit,
      feesPending,
      status: feesPending ? "Pending" : "Settled",
      refundAmount,
      refundProcessingFee,
    };
  });

  const totals = daily.reduce(
    (acc, d) => ({
      ordersRev: acc.ordersRev + d.ordersRev,
      incentive: acc.incentive + d.incentive,
      fees: acc.fees + d.fees,
      walmartTotal: acc.walmartTotal + d.walmartTotal,
      netAfterFees: acc.netAfterFees + d.netAfterFees,
      itemCost: acc.itemCost + d.itemCost,
      profit: acc.profit + d.profit,
    }),
    { ordersRev: 0, incentive: 0, fees: 0, walmartTotal: 0, netAfterFees: 0, itemCost: 0, profit: 0 }
  );

  return {
    accountId,
    accountName: account.name,
    configured: true,
    range: { startDate, endDate },
    totals,
    daily,
    orderLevel,
    costSheetMeta: costMeta,
    settledThroughDate,
    costCoverage,
    feeCostBreakdown,
    feeEstimation: {
      trainedOnLines: feeModel.trainedOnLines,
      trainedOnRevenue: feeModel.trainedOnRevenue,
      pendingLinesEstimated: pendingLines.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
