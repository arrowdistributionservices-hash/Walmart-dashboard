import { NextResponse } from "next/server";
import { getAllCostSheetCsvs } from "../../../lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("account") || "kyle";
    const uploads = await getAllCostSheetCsvs(accountId);
    return NextResponse.json({
      accountId,
      uploadCount: uploads.length,
      filenames: uploads.map((u) => u.filename),
      envCheck: {
        hasKvUrl: !!process.env.KV_REST_API_URL,
        hasKvToken: !!process.env.KV_REST_API_TOKEN,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
