import { NextResponse } from "next/server";
import { computeAccountData } from "../../../lib/computeAccountData";
import { ACCOUNTS } from "../../../lib/accounts";

export const dynamic = "force-dynamic"; // never cache - always fetch fresh Walmart data
export const maxDuration = 60;

const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account") || ACCOUNTS[0].id;
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - 30);

    const startDate = searchParams.get("start") || defaultStart.toISOString().slice(0, 10);
    const endDate = searchParams.get("end") || today.toISOString().slice(0, 10);

    const data = await computeAccountData(accountId, { startDate, endDate });

    if (!data.configured) {
      return NextResponse.json(
        {
          accountId: data.accountId,
          accountName: data.accountName,
          configured: false,
          error: `Walmart API credentials for ${data.accountName} haven't been added to Vercel yet.`,
        },
        { status: 200, headers: { "Cache-Control": "no-store, max-age=0", ...CORS_HEADERS } }
      );
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, max-age=0", ...CORS_HEADERS } });
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
