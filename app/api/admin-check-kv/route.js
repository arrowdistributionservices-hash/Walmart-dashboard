import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const account = searchParams.get("account") || "kyle";
    const key = `costsheet:all-uploads:${account}`;
    const raw = await kv.get(key);
    return NextResponse.json({
      key,
      isArray: Array.isArray(raw),
      length: Array.isArray(raw) ? raw.length : null,
      filenames: Array.isArray(raw) ? raw.map((u) => u.filename) : raw,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Writes directly via THIS route's kv client, to test whether it's the same
// underlying KV instance that computeAccountData.js/walmart-data reads from.
export async function POST(request) {
  try {
    const body = await request.json();
    const account = body.account || "kyle";
    const filename = body.filename;
    const key = `costsheet:all-uploads:${account}`;
    const existing = (await kv.get(key)) || [];
    const remaining = existing.filter((u) => u.filename !== filename);
    const removedCount = existing.length - remaining.length;
    if (removedCount > 0) {
      await kv.set(key, remaining);
    }
    const verify = await kv.get(key);
    return NextResponse.json({
      key,
      removedCount,
      remainingFilenames: remaining.map((u) => u.filename),
      verifyLength: Array.isArray(verify) ? verify.length : null,
      verifyFilenames: Array.isArray(verify) ? verify.map((u) => u.filename) : verify,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
