import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const account = searchParams.get("account") || "kyle";
    const key = `costsheet:all-uploads:${account}`;
    const raw = await kv.get(key);

    // Also fetch the SAME key via a raw, explicitly uncached HTTP call to
    // Upstash's REST API directly, bypassing the @vercel/kv package
    // entirely - to test whether @vercel/kv's internal fetch() is being
    // picked up by Next.js's persistent Data Cache despite force-dynamic.
    let rawRest = null;
    try {
      const restRes = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
        cache: "no-store",
      });
      const restJson = await restRes.json();
      rawRest = restJson.result ? JSON.parse(restJson.result) : restJson.result;
    } catch (e) {
      rawRest = { error: e.message };
    }

    return NextResponse.json({
      key,
      viaKvPackage: {
        isArray: Array.isArray(raw),
        length: Array.isArray(raw) ? raw.length : null,
        filenames: Array.isArray(raw) ? raw.map((u) => u.filename) : raw,
      },
      viaRawRestNoStore: {
        isArray: Array.isArray(rawRest),
        length: Array.isArray(rawRest) ? rawRest.length : null,
        filenames: Array.isArray(rawRest) ? rawRest.map((u) => u.filename) : rawRest,
      },
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
