import { NextResponse } from "next/server";
import { addCostSheetCsv } from "../../../lib/storage";
import { parseCostSheetCsvText, mergeCostSheets } from "../../../lib/costSheetCsv";
import { ACCOUNTS } from "../../../lib/accounts";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const accountId = formData.get("account") || ACCOUNTS[0].id;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const csvText = await file.text();

    const { entries, blocksFound } = parseCostSheetCsvText(csvText);
    if (entries.length === 0) {
      return NextResponse.json(
        {
          error:
            "Couldn't find any cost rows in this file. Expected a table with Title, UPC/Walmart ID, and a cost column (e.g. BuyCost).",
        },
        { status: 400 }
      );
    }

    const allUploads = await addCostSheetCsv(accountId, csvText, file.name);
    const merged = mergeCostSheets(allUploads.map((u) => u.csvText));

    return NextResponse.json({
      success: true,
      accountId,
      entryCount: entries.length,
      blocksFound,
      filename: file.name,
      totalUploads: allUploads.length,
      totalTrackedItems: merged.entries.length,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
