import {
  getAllOrdersAllFulfillmentTypes,
  aggregateRevenueByDay,
  aggregateRevenueByOrderId,
  extractAllOrderLineItems,
  getReconDataForDateRange,
  aggregateReconByDay,
  aggregateReconByOrder,
} from "./walmartClient";
import { kv } from "@vercel/kv";
import { lookupCost, mergeCostSheets } from "./costSheetCsv";
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

  // --- Cost sheet data (item cost / COGS, from every uploaded sheet so far) ---
  const allCostSheetUploads = (await kv.get(`costsheet:all-uploads:${accountId}`)) || [];
  let costByKey = {};
  let costMeta = null;

  if (allCostSheetUploads.length > 0) {
    const merged = mergeCostSheets(allCostSheetUploads.map((u) => u.csvText));
    costByKey = merged.costByKey;
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

  const itemCostByDay = {};
  const itemCostByOrderId = {};
  const unmatchedLinesByOrderId = {};
  let matchedLineCount = 0;
  let unmatchedLineCount = 0;
  let matchedRevenue = 0;
  let unmatchedRevenue = 0;
  const unmatchedSkuCounts = {};

  for (const line of allLines) {
    const match = costByKey && Object.keys(costByKey).length
      ? lookupCost(costByKey, { sku: line.sku, upc: line.upc })
      : null;

    if (match) {
      matchedLineCount++;
      matchedRevenue += line.revenue;
      const lineCost = match.costPerUnit * line.quantity;
      itemCostByDay[line.orderDate] = (itemCostByDay[line.orderDate] || 0) + lineCost;
      if (line.purchaseOrderId) {
        itemCostByOrderId[line.purchaseOrderId] = (itemCostByOrderId[line.purchaseOrderId] || 0) + lineCost;
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
        topUnmatchedSkus,
      }
    : null;

  // --- Build order-level breakdown first (daily is derived from this, so
  // the two views can never disagree about which orders are settled) ---
  const allOrderIds = new Set([
    ...Object.keys(ordersByOrderId),
    ...Object.keys(reconByOrder),
    ...Object.keys(itemCostByOrderId),
  ]);
  const orderLevel = [...allOrderIds].map((orderId) => {
    const walmartOrdersRev = ordersByOrderId[orderId]?.revenue || 0;
    const orderDate = ordersByOrderId[orderId]?.orderDate || null;
    const feesPending = !orderIsSettled(orderId, orderDate);
    const incentive = feesPending ? estIncentiveByOrderId[orderId] || 0 : reconByOrder[orderId]?.incentive || 0;
    const fees = feesPending ? estFeeByOrderId[orderId] || 0 : reconByOrder[orderId]?.fees || 0;
    const walmartTotal = walmartOrdersRev + incentive;
    const netAfterFees = walmartTotal + fees;
    const itemCost = itemCostByOrderId[orderId] || 0;
    const profit = netAfterFees - itemCost;
    const unmatchedLineItems = unmatchedLinesByOrderId[orderId] || 0;
    return {
      orderId,
      date: orderDate,
      walmartOrdersRev,
      incentive,
      fees,
      walmartTotal,
      netAfterFees,
      itemCost,
      profit,
      costMatched: itemCost > 0 && unmatchedLineItems === 0,
      unmatchedLineItems,
      feesPending,
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
  for (const o of orderLevel) {
    if (!o.date) continue;
    feesByDay[o.date] = (feesByDay[o.date] || 0) + o.fees;
    incentiveByDay[o.date] = (incentiveByDay[o.date] || 0) + o.incentive;
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
    const walmartTotal = ordersRev + incentive;
    const netAfterFees = walmartTotal + fees;
    const itemCost = itemCostByDay[date] || 0;
    const profit = netAfterFees - itemCost;
    const feesPending = !!pendingByDay[date];
    return { date, ordersRev, incentive, fees, walmartTotal, netAfterFees, itemCost, profit, feesPending };
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
    feeEstimation: {
      trainedOnLines: feeModel.trainedOnLines,
      trainedOnRevenue: feeModel.trainedOnRevenue,
      pendingLinesEstimated: pendingLines.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
