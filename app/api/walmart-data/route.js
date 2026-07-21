import { NextResponse } from "next/server";
import {
  getAllOrdersAllFulfillmentTypes,
  aggregateRevenueByDay,
  aggregateRevenueByOrderId,
  getReconDataForDateRange,
  aggregateReconByDay,
  aggregateReconByOrder,
} from "../../../lib/walmartClient";
import { getLatestSellerboardCsv } from "../../../lib/storage";
import { parseSellerboardCsvText } from "../../../lib/sellerboardCsv";

export const dynamic = "force-dynamic"; // never cache — always fetch fresh Walmart data
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

    // --- Build daily comparison ---
    const allDays = new Set([...Object.keys(ordersByDay), ...Object.keys(reconByDay), ...Object.keys(sbByDay)]);
    const daily = [...allDays].sort().map((date) => {
      const ordersRev = ordersByDay[date] || 0;
      const incentive = reconByDay[date]?.incentive || 0;
      const walmartTotal = ordersRev + incentive;
      const sellerboardRev = sbByDay[date] || 0;
      return {
        date,
        ordersRev,
        incentive,
        walmartTotal,
        sellerboardRev,
        diff: walmartTotal - sellerboardRev,
      };
    });

    // --- Build order-level comparison ---
    const allOrderIds = new Set([
      ...Object.keys(ordersByOrderId),
      ...Object.keys(reconByOrder),
      ...Object.keys(sbByOrderId),
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
      return {
        orderId,
        date: ordersByOrderId[orderId]?.orderDate || null,
        walmartOrdersRev,
        incentive,
        walmartTotal,
        sellerboardRev,
        diff: walmartTotal - sellerboardRev,
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
      }),
      { ordersRev: 0, incentive: 0, walmartTotal: 0, sellerboardRev: 0 }
    );

    return NextResponse.json(
      {
        range: { startDate, endDate },
        totals,
        daily,
        orderLevel,
        sellerboardMeta: sbMeta,
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
