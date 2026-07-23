import { NextResponse } from "next/server";
import { saveCostSheetCsv } from "../../../lib/storage";
import { parseCostSheetCsvText } from "../../../lib/costSheetCsv";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const csvText = await file.text();

    // Validate it parses before saving, so a bad file doesn't silently
    // break the dashboard for everyone.
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

    await saveCostSheetCsv(csvText, file.name);

    return NextResponse.json({
      success: true,
      entryCount: entries.length,
      blocksFound,
      filename: file.name,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

