import { NextResponse } from "next/server";
import { getReconDataForDateRange } from "../../../lib/walmartClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Temporary diagnostic endpoint: summarizes every distinct "Amount Type"
 * present in the Walmart settlement/recon report for a date range, so we
 * can see exactly which categories exist (fees, taxes, etc.) before
 * building fee-deduction logic against real field names instead of guesses.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    if (!startDate || !endDate) {
      return NextResponse.json({ error: "start and end query params required" }, { status: 400 });
    }

    const rows = await getReconDataForDateRange({ startDate, endDate });

    const byAmountType = {};
    for (const row of rows) {
      const type = row["Amount Type"] || "(missing)";
      const amount = Number(String(row["Amount"] || "0").replace(/[^0-9.-]/g, "")) || 0;
      if (!byAmountType[type]) byAmountType[type] = { count: 0, sum: 0, sampleRow: row };
      byAmountType[type].count++;
      byAmountType[type].sum += amount;
    }

    const summary = Object.entries(byAmountType)
      .map(([type, v]) => ({ amountType: type, count: v.count, sum: Math.round(v.sum * 100) / 100 }))
      .sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));

    return NextResponse.json({
      totalRows: rows.length,
      distinctAmountTypes: summary,
      sampleFullRow: rows[0] || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

