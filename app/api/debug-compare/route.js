import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getAllCostSheetCsvs } from "../../../lib/storage";
import * as storageModule from "../../../lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const accountId = "kyle";
    const viaFunction = await getAllCostSheetCsvs(accountId);
    const viaRaw = await kv.get(`costsheet:all-uploads:${accountId}`);
    const funcSource = getAllCostSheetCsvs.toString();

    return NextResponse.json({
      viaFunctionLength: viaFunction.length,
      viaRawLength: Array.isArray(viaRaw) ? viaRaw.length : null,
      funcSource,
      storageModuleKeys: Object.keys(storageModule),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
