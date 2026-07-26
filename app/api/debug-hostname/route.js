import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.KV_REST_API_URL || "";
  let hostname = "unknown";
  try {
    hostname = new URL(url).hostname;
  } catch (e) {}
  return NextResponse.json({
    hostname,
    urlPrefix: url.slice(0, 40),
    allKvEnvKeys: Object.keys(process.env).filter((k) => k.includes("KV") || k.includes("REDIS")),
  });
}
