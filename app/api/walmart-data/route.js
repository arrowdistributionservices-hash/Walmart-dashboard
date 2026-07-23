import { NextResponse } from "next/server";
import {
  getAllOrdersAllFulfillmentTypes,
  aggregateRevenueByDay,
  aggregateRevenueByOrderId,
  extractAllOrderLineItems,
  getReconDataForDateRange,
  aggregateReconByDay,
  aggregateReconByOrder,
} from "../../../lib/walmartClient";
import { getLatestSellerboardCsv, getAllCostSheetCsvs } from "../../../lib/storage";
import { parseSellerboardCsvText } from "../../../lib/sellerboardCsv";
import { lookupCost, mergeCostSheets } from "../../../lib/costSheetCsv";

export const dynamic = "force-dynamic"; // never cache - always fetch fresh Walmart data
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - 30);

    const startDate = searchParams.get("start") || defaultStart.toISOString().slice(0, 10);
    const endDate = searchParams.get("end") || today.toISOString().slice(0, 10);

    // --- Live Walmart data ---
    const orders = await getAllOrdersAllFulfillmentTypes({
      createdStartDate: `${startDate}T00:00:00.000Z`,
      createdEndDate: `${endDate}T23:59:59.999Z`,
    });
    const ordersByDay = aggregateRevenueByDay(orders);
    const ordersByOrderId = aggregateRevenueByOrderId(orders);

    const reconRows = await getReconDataForDateRange({ startDate, endDate });
    const reconByDay = aggregateReconByDay(reconRows);
    const reconByOrder = aggregateReconByOrder(reconRows);

    // --- Sellerboard data (from last uploaded CSV, if any) ---
    const stored = await getLatestSellerboardCsv();
    let sbByDay = {};
    let sbByOrderId = {};
    let sbMeta = null;

    if (stored?.csvText) {
      const { rows } = parseSellerboardCsvText(stored.csvText);
      for (const row of rows) {
        if (row.date < startDate || row.date > endDate) continue;
        sbByDay[row.date] = (sbByDay[row.date] || 0) + row.revenue;
        const existing = sbByOrderId[row.orderNumber];
        sbByOrderId[row.orderNumber] = (existing || 0) + row.revenue;
      }
      sbMeta = { filename: stored.filename, uploadedAt: stored.uploadedAt };
    }

    // --- Cost sheet data (item cost / COGS, from every uploaded sheet so far) ---
    const allCostSheetUploads = await getAllCostSheetCsvs();
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

    const itemCostByDay = {};
    const itemCostByOrderId = {};
    const unmatchedLinesByOrderId = {};
    let matchedLineCount = 0;
    let unmatchedLineCount = 0;
    let matchedRevenue = 0;
    let unmatchedRevenue = 0;
    const unmatchedSkuCounts = {}; // sku/title -> { count, revenue }

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

    // --- Build daily comparison ---
    const allDays = new Set([
      ...Object.keys(ordersByDay),
      ...Object.keys(reconByDay),
      ...Object.keys(sbByDay),
      ...Object.keys(itemCostByDay),
    ]);
    const daily = [...allDays].sort().map((date) => {
      const ordersRev = ordersByDay[date] || 0;
      const incentive = reconByDay[date]?.incentive || 0;
      const walmartTotal = ordersRev + incentive;
      const sellerboardRev = sbByDay[date] || 0;
      const itemCost = itemCostByDay[date] || 0;
      const profit = walmartTotal - itemCost;
      return {
        date,
        ordersRev,
        incentive,
        walmartTotal,
        sellerboardRev,
        diff: walmartTotal - sellerboardRev,
        itemCost,
        profit,
      };
    });

    // --- Build order-level comparison ---
    const allOrderIds = new Set([
      ...Object.keys(ordersByOrderId),
      ...Object.keys(reconByOrder),
      ...Object.keys(sbByOrderId),
      ...Object.keys(itemCostByOrderId),
    ]);
    const orderLevel = [...allOrderIds].map((orderId) => {
      const walmartOrdersRev = ordersByOrderId[orderId]?.revenue || 0;
      const incentive = reconByOrder[orderId]?.incentive || 0;
      const walmartTotal = walmartOrdersRev + incentive;
      const sellerboardRev = sbByOrderId[orderId] || 0;
      const inSellerboard = Object.prototype.hasOwnProperty.call(sbByOrderId, orderId);
      const inWalmart = Object.prototype.hasOwnProperty.call(ordersByOrderId, orderId);
      let presence = "matched";
      if (inSellerboard && !inWalmart) presence = "sellerboard_only";
      else if (!inSellerboard && inWalmart) presence = "walmart_only";
      const itemCost = itemCostByOrderId[orderId] || 0;
      const profit = walmartTotal - itemCost;
      const unmatchedLineItems = unmatchedLinesByOrderId[orderId] || 0;
      return {
        orderId,
        date: ordersByOrderId[orderId]?.orderDate || null,
        walmartOrdersRev,
        incentive,
        walmartTotal,
        sellerboardRev,
        diff: walmartTotal - sellerboardRev,
        itemCost,
        profit,
        costMatched: itemCost > 0 && unmatchedLineItems === 0,
        unmatchedLineItems,
        presence,
      };
    });
    orderLevel.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const totals = daily.reduce(
      (acc, d) => ({
        ordersRev: acc.ordersRev + d.ordersRev,
        incentive: acc.incentive + d.incentive,
        walmartTotal: acc.walmartTotal + d.walmartTotal,
        sellerboardRev: acc.sellerboardRev + d.sellerboardRev,
        itemCost: acc.itemCost + d.itemCost,
        profit: acc.profit + d.profit,
      }),
      { ordersRev: 0, incentive: 0, walmartTotal: 0, sellerboardRev: 0, itemCost: 0, profit: 0 }
    );

    return NextResponse.json(
      {
        range: { startDate, endDate },
        totals,
        daily,
        orderLevel,
        sellerboardMeta: sbMeta,
        costSheetMeta: costMeta,
        costCoverage,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

