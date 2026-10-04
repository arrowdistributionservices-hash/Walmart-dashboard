import { NextResponse } from "next/server";
import { walmartRequestRaw } from "../../../lib/walmartClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Probe route only - checks whether Walmart's Items API can resolve a
// Walmart.com item ID (the number in /ip/<id>) to this seller's SKU/UPC, so
// cost rows keyed only by item ID can be joined to order lines exactly.
// Not wired into any UI.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account") || "kyle";
  const id = searchParams.get("id");
  const type = searchParams.get("type") || "ITEM_ID";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const attempts = [];
  for (const path of [`/v3/items/${encodeURIComponent(id)}`]) {
    try {
      attempts.push({ path, type, ok: true, data: await walmartRequestRaw(accountId, path, { productIdType: type }) });
    } catch (err) {
      attempts.push({ path, type, ok: false, error: String(err.message).slice(0, 500) });
    }
  }
  return NextResponse.json({ accountId, id, attempts });
}
