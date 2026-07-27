import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = "costsheet:all-uploads:kyle";
  const existing = (await kv.get(key)) || [];
  const cleaned = existing.filter(
    (u) => u.filename !== "test.csv" && u.filename !== "test2.csv"
  );
  await kv.set(key, cleaned);
  return NextResponse.json({
    before: existing.length,
    after: cleaned.length,
    remainingFilenames: cleaned.map((u) => u.filename),
  });
}
