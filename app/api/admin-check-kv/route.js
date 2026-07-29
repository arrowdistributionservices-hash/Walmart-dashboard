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
