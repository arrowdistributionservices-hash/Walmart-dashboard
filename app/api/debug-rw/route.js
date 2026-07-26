import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const testKey = "debug:rw-test";
    await kv.set(testKey, { hello: "world", ts: Date.now() });
    const readBack = await kv.get(testKey);

    const realKey = "costsheet:all-uploads:kyle";
    const realValue = await kv.get(realKey);

    // Also list all keys matching costsheet pattern if kv.keys is supported
    let matchingKeys = null;
    try {
      matchingKeys = await kv.keys("costsheet:*");
    } catch (e) {
      matchingKeys = "keys() not supported: " + e.message;
    }

    return NextResponse.json({
      writeReadTest: readBack,
      realKeyExists: !!realValue,
      realKeyLength: Array.isArray(realValue) ? realValue.length : null,
      matchingKeys,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
