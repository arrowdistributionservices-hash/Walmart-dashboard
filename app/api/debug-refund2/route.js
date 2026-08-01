import { NextResponse } from "next/server";
import { getReconDataForDateRange } from "../../../lib/walmartClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account") || "kyle";
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 45);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = today.toISOString().slice(0, 10);

    const { rows } = await getReconDataForDateRange(accountId, { startDate, endDate });

    const processingFees = rows.filter((r) => {
      const desc = (r["Transaction Description"] || "").toLowerCase();
      return desc.includes("processing") || desc.includes("removal") || desc.includes("return");
    });

    const transactionTypeCounts = {};
    for (const r of rows) {
      const t = r["Transaction Type"] || "(blank)";
      transactionTypeCounts[t] = (transactionTypeCounts[t] || 0) + 1;
    }

    const refundOrderIds = [...new Set(rows.filter(r => r["Transaction Type"] === "Refund").map(r => r["Purchase Order #"]))];
    const oneFullRefund = refundOrderIds[0]
      ? rows.filter(r => r["Purchase Order #"] === refundOrderIds[0])
      : [];

    return NextResponse.json({
      accountId,
      transactionTypeCounts,
      processingFeesCount: processingFees.length,
      processingFeesSample: processingFees.slice(0, 10).map(r => ({
        amountType: r["Amount Type"], amount: r["Amount"], transactionType: r["Transaction Type"], desc: r["Transaction Description"], orderId: r["Purchase Order #"],
      })),
      oneFullRefundOrderId: refundOrderIds[0] || null,
      oneFullRefundRows: oneFullRefund.map(r => ({
        amountType: r["Amount Type"], amount: r["Amount"], transactionType: r["Transaction Type"], desc: r["Transaction Description"],
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
