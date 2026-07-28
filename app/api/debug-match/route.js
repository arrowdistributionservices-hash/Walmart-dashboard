import { NextResponse } from "next/server";
import {
  getAllOrdersAllFulfillmentTypes,
  getReconDataForDateRange,
} from "../../../lib/walmartClient";
import { ACCOUNTS } from "../../../lib/accounts";

// TEMPORARY diagnostic route - not linked from the UI. Compares raw order
// purchaseOrderId values against raw Recon Report "Purchase Order #" /
// "Customer Order #" values for a date range, to check whether the join key
// used in aggregateReconByOrder actually matches Walmart's real order IDs.
// Safe to delete once the mismatch is understood.
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

    const orderIdSamples = orders.slice(0, 5).map((o) => ({
      purchaseOrderId: o.purchaseOrderId,
      type: typeof o.purchaseOrderId,
      shippingInfoOrderNumber: o?.shippingInfo?.customerOrderId || null,
    }));

    const reconRowKeysSample = reconRows.length
      ? Object.keys(reconRows[0])
      : [];

    const reconIdSamples = reconRows.slice(0, 10).map((r) => ({
      "Purchase Order #": r["Purchase Order #"],
      "Customer Order #": r["Customer Order #"],
      "Amount Type": r["Amount Type"],
      "Amount": r["Amount"],
      "Transaction Posted Timestamp": r["Transaction Posted Timestamp"],
    }));

    let targetOrder = null;
    let targetReconRows = [];
    if (targetOrderId) {
      targetOrder = orders.find((o) => String(o.purchaseOrderId) === String(targetOrderId)) || null;
      targetReconRows = reconRows.filter(
        (r) =>
          String(r["Purchase Order #"]).includes(targetOrderId) ||
          String(r["Customer Order #"]).includes(targetOrderId) ||
          targetOrderId.includes(String(r["Purchase Order #"])) ||
          targetOrderId.includes(String(r["Customer Order #"]))
      );
    }

    return NextResponse.json({
      accountId,
      settledThroughDate,
      totalOrders: orders.length,
      totalReconRows: reconRows.length,
      orderIdSamples,
      reconRowKeysSample,
      reconIdSamples,
      targetOrderId,
      targetOrderFound: !!targetOrder,
      targetOrderRaw: targetOrder,
      targetReconRowsFound: targetReconRows.length,
      targetReconRows,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
