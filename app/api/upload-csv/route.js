import { NextResponse } from "next/server";
import { saveSellerboardCsv } from "../../../lib/storage";
import { parseSellerboardCsvText } from "../../../lib/sellerboardCsv";
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
    const { rows, columnsUsed } = parseSellerboardCsvText(csvText);

    await saveSellerboardCsv(accountId, csvText, file.name);

    return NextResponse.json({
      success: true,
      accountId,
      rowCount: rows.length,
      columnsUsed,
      filename: file.name,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
