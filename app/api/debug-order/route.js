import { NextResponse } from "next/server";
import { getReconDataForDateRange } from "../../../lib/walmartClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Temporary diagnostic endpoint: returns every raw settlement/recon row
 * for a specific order ID within a date range, so we can compare exactly
 * what Walmart's API reports against what the Seller Center UI shows,
 * instead of guessing at where a discrepancy comes from.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    const orderId = searchParams.get("orderId");
    if (!startDate || !endDate || !orderId) {
      return NextResponse.json({ error: "start, end, and orderId query params required" }, { status: 400 });
    }

    const rows = await getReconDataForDateRange({ startDate, endDate });
    const matching = rows.filter(
      (row) => row["Purchase Order #"] === orderId || row["Customer Order #"] === orderId
    );

    return NextResponse.json({
      totalRowsInRange: rows.length,
      matchingRowCount: matching.length,
      matchingRows: matching,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

