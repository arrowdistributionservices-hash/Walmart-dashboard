import { NextResponse } from "next/server";
import { getAvailableReconReportDates, debugReconReportPages } from "../../../lib/walmartClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Probe route only - for each settlement report Walmart lists, reports how
// many rows/pages came back, any page that errored, and the posted-date
// span and distinct order count, to check whether recent settlements are
// missing from the reports or being lost while paging. Not wired into any UI.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account") || "kyle";
    const only = searchParams.get("dates"); // optional comma-separated MMDDYYYY list
    const dates = await getAvailableReconReportDates(accountId);
    const targets = only ? only.split(",") : dates.slice(-6);
    const reports = [];
    for (const reportDate of targets) reports.push({ reportDate, ...(await debugReconReportPages(accountId, reportDate)) });
    return NextResponse.json({ accountId, availableReportDates: dates, reports });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
