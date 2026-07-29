import { NextResponse } from "next/server";
import { removeCostSheetCsvByFilename, getAllCostSheetCsvs } from "../../../lib/storage";

// TEMPORARY admin route - not linked from the UI. Removes ONE mistakenly
// uploaded cost sheet by exact filename from an account's upload list,
// leaving every other upload untouched. Used once to fix Laurie's cost
// sheet having been uploaded to Kyle's account by mistake. Safe to delete
// once used.
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const account = body.account;
    const filename = body.filename;
    const confirm = body.confirm;

    if (!account || !filename) {
      return NextResponse.json({ error: "Missing account or filename in request body." }, { status: 400 });
    }

    const before = await getAllCostSheetCsvs(account);

    if (confirm !== true) {
      // Dry run by default - shows what WOULD be removed without touching anything.
      return NextResponse.json({
        dryRun: true,
        account,
        filename,
        currentUploads: before.map((u) => ({ filename: u.filename, uploadedAt: u.uploadedAt })),
        wouldRemove: before.some((u) => u.filename === filename),
        note: "Set confirm: true to actually remove it.",
      });
    }

    const result = await removeCostSheetCsvByFilename(account, filename);
    return NextResponse.json({ account, filename, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
