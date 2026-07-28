import { NextResponse } from "next/server";
import {
  getAllOrdersAllFulfillmentTypes,
  extractAllOrderLineItems,
  getReconDataForDateRange,
  aggregateReconByOrder,
} from "../../../lib/walmartClient";
import { buildFeeModel, estimateLine, priceBucket } from "../../../lib/feeEstimator";
import { ACCOUNTS } from "../../../lib/accounts";

// TEMPORARY diagnostic route - not linked from the UI. Exposes the fee
// estimation model's internals (per-SKU and per-price-band rates, and the
// exact settled orders that trained them) so we can sanity-check whether an
// estimate is being skewed by outlier settlement rows. Safe to delete once
// investigated.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account") || ACCOUNTS[0].id;
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    const targetOrderId = searchParams.get("orderId");

    const orders = await getAllOrdersAllFulfillmentTypes(accountId, {
      createdStartDate: `${startDate}T00:00:00.000Z`,
      createdEndDate: `${endDate}T23:59:59.999Z`,
    });
    const { rows: reconRows, settledThroughDate } = await getReconDataForDateRange(accountId, {
      startDate,
      endDate,
    });
    const reconByOrder = aggregateReconByOrder(reconRows);

    const allLines = extractAllOrderLineItems(orders).filter(
      (line) => line.orderDate && line.orderDate >= startDate && line.orderDate <= endDate
    );

    const orderIsSettled = (orderId, orderDate) => {
      if (!reconByOrder[orderId]) return false;
      if (settledThroughDate && orderDate && orderDate > settledThroughDate) return false;
      return true;
    };

    const settledLines = allLines.filter((l) => orderIsSettled(l.purchaseOrderId, l.orderDate));
    const pendingLines = allLines.filter((l) => !orderIsSettled(l.purchaseOrderId, l.orderDate));
    const feeModel = buildFeeModel(settledLines, reconByOrder);

    const targetLine = allLines.find((l) => l.purchaseOrderId === targetOrderId) || null;
    let skuModelEntry = null;
    let bucketModelEntry = null;
    let estimate = null;
    let settledComparablesRaw = [];

    if (targetLine) {
      const sku = targetLine.sku || `title:${targetLine.title}`;
      const unitPrice = targetLine.revenue / (targetLine.quantity || 1);
      const bucket = priceBucket(unitPrice);
      skuModelEntry = feeModel.skuModel[sku] || null;
      bucketModelEntry = feeModel.bucketModel[bucket] || null;
      estimate = estimateLine(targetLine, feeModel);

      // Every settled line sharing this SKU, with the RAW order-level recon
      // totals that were prorated into the model (so we can see if one of
      // them is an outlier - e.g. a return, chargeback, or storage-fee
      // adjustment - dragging the average off).
      settledComparablesRaw = settledLines
        .filter((l) => (l.sku || `title:${l.title}`) === sku)
        .map((l) => ({
          purchaseOrderId: l.purchaseOrderId,
          orderDate: l.orderDate,
          revenue: l.revenue,
          quantity: l.quantity,
          orderRecon: reconByOrder[l.purchaseOrderId],
        }));
    }

    return NextResponse.json({
      accountId,
      settledThroughDate,
      trainedOnLines: feeModel.trainedOnLines,
      trainedOnRevenue: feeModel.trainedOnRevenue,
      totalSettledLines: settledLines.length,
      totalPendingLines: pendingLines.length,
      targetOrderId,
      targetLine,
      skuModelEntry,
      bucketModelEntry,
      globalModel: feeModel.globalModel,
      estimate,
      settledComparablesRaw,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
