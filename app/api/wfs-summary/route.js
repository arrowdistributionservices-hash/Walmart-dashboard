import { NextResponse } from "next/server";
import { ACCOUNTS } from "../../../lib/accounts";
import { getAccountCredentials } from "../../../lib/accounts";
import { getWfsSummary } from "../../../lib/walmartClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

export async function OPTIONS() {
  return new Response(null, { headers: { ...CORS_HEADERS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}

// Pulled directly from Walmart's own Fulfillment API (inbound-shipments +
// inventory endpoints) per-account, then summed - not inferred from the
// Prep Brothers webhook. This is a real, complete snapshot as of the
// moment it's called (subject to Walmart's own API being current), not an
// activity log that only knows about recent changes.
export async function GET() {
  const results = await Promise.allSettled(
    ACCOUNTS.map(async (acct) => {
      const { configured } = getAccountCredentials(acct.id);
      if (!configured) return { accountId: acct.id, accountName: acct.name, configured: false };
      const summary = await getWfsSummary(acct.id);
      return { accountId: acct.id, accountName: acct.name, configured: true, ...summary };
    })
  );

  const accounts = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { accountId: ACCOUNTS[i].id, accountName: ACCOUNTS[i].name, configured: true, error: r.reason?.message || String(r.reason) };
  });

  const grand = accounts.reduce(
    (acc, a) => {
      if (!a.inbound) return acc;
      return {
        inboundUnits: acc.inboundUnits + a.inbound.units,
        inboundShipments: acc.inboundShipments + a.inbound.shipments,
        onHandUnits: acc.onHandUnits + a.onHand.units,
        availableUnits: acc.availableUnits + a.onHand.availableUnits,
      };
    },
    { inboundUnits: 0, inboundShipments: 0, onHandUnits: 0, availableUnits: 0 }
  );

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), grand, accounts },
    { headers: CORS_HEADERS }
  );
}
