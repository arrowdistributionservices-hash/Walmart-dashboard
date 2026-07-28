import { NextResponse } from "next/server";
import { getReconDataForDateRange } from "../../../lib/walmartClient";
import { ACCOUNTS } from "../../../lib/accounts";

// TEMPORARY diagnostic route - not linked from the UI. Lists every distinct
// "Amount Type" value present in the raw Recon Report for an account/date
// range, with counts and summed totals, so we can see which categories our
// current fee/revenue classification (in walmartClient.js) is capturing vs.
// silently ignoring. Safe to delete once reviewed.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account") || ACCOUNTS[0].id;
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");

    const { rows, settledThroughDate } = await getReconDataForDateRange(accountId, { startDate, endDate });

    const byType = {};
    const byDetail = {};
    for (const row of rows) {
      const type = row["Amount Type"] || "(blank)";
      const desc = row["Transaction Description"] || "";
      const amount = toNumber(row["Amount"]);
      if (!byType[type]) byType[type] = { count: 0, total: 0, sampleTransactionTypes: new Set() };
      byType[type].count += 1;
      byType[type].total += amount;
      if (row["Transaction Type"]) byType[type].sampleTransactionTypes.add(row["Transaction Type"]);

      const detailKey = `${type} | ${desc}`;
      if (!byDetail[detailKey]) byDetail[detailKey] = { count: 0, total: 0 };
      byDetail[detailKey].count += 1;
      byDetail[detailKey].total += amount;
    }

    const summary = Object.entries(byType)
      .map(([type, v]) => ({
        type,
        count: v.count,
        total: Math.round(v.total * 100) / 100,
        transactionTypes: [...v.sampleTransactionTypes],
      }))
      .sort((a, b) => b.count - a.count);

    const detailSummary = Object.entries(byDetail)
      .map(([key, v]) => ({ key, count: v.count, total: Math.round(v.total * 100) / 100 }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      accountId,
      settledThroughDate,
      totalRows: rows.length,
      distinctAmountTypes: summary.length,
      summary,
      detailSummary,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
