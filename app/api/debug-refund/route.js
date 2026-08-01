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

    const { rows, settledThroughDate } = await getReconDataForDateRange(accountId, { startDate, endDate });

    const refundish = rows.filter((r) => {
      const desc = (r["Transaction Description"] || "").toLowerCase();
      const type = (r["Amount Type"] || "").toLowerCase();
      const amt = Number(String(r["Amount"] || "0").replace(/[^0-9.-]/g, ""));
      return desc.includes("refund") || type.includes("refund") || (type === "product price" && amt < 0);
    });

    const typeCounts = {};
    for (const r of rows) {
      const t = r["Amount Type"] || "(blank)";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }

    const sampleKeys = rows[0] ? Object.keys(rows[0]) : [];

    return NextResponse.json({
      accountId,
      settledThroughDate,
      totalRows: rows.length,
      typeCounts,
      sampleKeys,
      refundishCount: refundish.length,
      refundishSample: refundish.slice(0, 8),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
