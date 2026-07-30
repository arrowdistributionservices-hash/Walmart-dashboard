import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { addCostSheetCsv } from "../../../lib/storage";
import { parseCostSheetCsvText, mergeCostSheets } from "../../../lib/costSheetCsv";
import { ACCOUNTS } from "../../../lib/accounts";

/**
 * Reads an uploaded cost-sheet file as CSV text, regardless of what it
 * actually is. People often export from Google Sheets/Excel as .xlsx by
 * mistake, or their CSV comes out UTF-16 encoded (common from some Excel
 * "Save As" flows) - blindly decoding either of those as UTF-8 text
 * produces garbled bytes that crash the CSV parser with a cryptic error.
 * This detects the real format from the file's contents (not just its
 * extension) and decodes/converts it properly.
 */
async function readUploadedFileAsCsvText(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // .xlsx (and .xls) files are ZIP archives - "PK\x03\x04" is the ZIP magic
  // number. Convert the first sheet to CSV instead of trying to read it as text.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error("This Excel file doesn't have any sheets to read.");
    }
    return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
  }

  // UTF-16 CSVs (common from some "CSV UTF-16" exports) start with a BOM.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }

  return new TextDecoder("utf-8").decode(buffer);
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const accountId = formData.get("account") || ACCOUNTS[0].id;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    let csvText;
    try {
      csvText = await readUploadedFileAsCsvText(file);
    } catch (err) {
      return NextResponse.json(
        { error: `Couldn't read "${file.name}" as a spreadsheet: ${err.message}` },
        { status: 400 }
      );
    }

    let entries, blocksFound;
    try {
      ({ entries, blocksFound } = parseCostSheetCsvText(csvText));
    } catch (err) {
      return NextResponse.json(
        {
          error: `"${file.name}" doesn't look like a valid CSV or Excel file - it may be corrupted or in an unsupported format. Try re-exporting it as CSV (UTF-8) or .xlsx and uploading again. (Parser said: ${err.message})`,
        },
        { status: 400 }
      );
    }
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
