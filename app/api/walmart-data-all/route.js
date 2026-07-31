import { NextResponse } from "next/server";
import { ACCOUNTS } from "../../../lib/accounts";
import { computeAccountData } from "../../../lib/computeAccountData";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - 30);

    const startDate = searchParams.get("start") || defaultStart.toISOString().slice(0, 10);
    const endDate = searchParams.get("end") || today.toISOString().slice(0, 10);

    const results = await Promise.allSettled(
      ACCOUNTS.map((acct) => computeAccountData(acct.id, { startDate, endDate }))
    );

    const accounts = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return {
        accountId: ACCOUNTS[i].id,
        accountName: ACCOUNTS[i].name,
        configured: true,
        error: r.reason?.message || "Failed to load this account.",
      };
    });

    const grandTotals = accounts.reduce(
      (acc, a) => {
        if (!a.totals) return acc;
        return {
          ordersRev: acc.ordersRev + a.totals.ordersRev,
          incentive: acc.incentive + a.totals.incentive,
          fees: acc.fees + a.totals.fees,
          walmartTotal: acc.walmartTotal + a.totals.walmartTotal,
          netAfterFees: acc.netAfterFees + a.totals.netAfterFees,
          itemCost: acc.itemCost + a.totals.itemCost,
          profit: acc.profit + a.totals.profit,
        };
      },
      { ordersRev: 0, incentive: 0, fees: 0, walmartTotal: 0, netAfterFees: 0, itemCost: 0, profit: 0 }
    );

    return NextResponse.json(
      {
        range: { startDate, endDate },
        grandTotals,
        accounts: accounts.map((a) => ({
          accountId: a.accountId,
          accountName: a.accountName,
          configured: a.configured,
          error: a.error || null,
          totals: a.totals || null,
        })),
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0", ...CORS_HEADERS } }
    );
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
