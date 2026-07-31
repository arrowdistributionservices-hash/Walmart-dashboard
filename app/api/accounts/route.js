import { NextResponse } from "next/server";
import { listAccountsWithStatus } from "../../../lib/accounts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { accounts: listAccountsWithStatus() },
    { headers: { "Cache-Control": "no-store, max-age=0", "Access-Control-Allow-Origin": "*" } }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
import { NextResponse } from "next/server";
import { listAccountsWithStatus } from "../../../lib/accounts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { accounts: listAccountsWithStatus() },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
