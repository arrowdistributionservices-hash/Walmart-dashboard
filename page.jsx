import { NextResponse } from "next/server";
import { saveSellerboardCsv } from "../../../lib/storage";
import { parseSellerboardCsvText } from "../../../lib/sellerboardCsv";

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
    const { rows, columnsUsed } = parseSellerboardCsvText(csvText);

    await saveSellerboardCsv(csvText, file.name);

    return NextResponse.json({
      success: true,
      rowCount: rows.length,
      columnsUsed,
      filename: file.name,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
