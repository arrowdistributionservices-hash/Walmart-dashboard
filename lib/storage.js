import { kv } from "@vercel/kv";

const SELLERBOARD_KEY = "sellerboard:latest-csv";
const COST_SHEET_KEY = "costsheet:latest-csv";

/** Stores the raw CSV text + who/when uploaded it, visible to the whole team. */
export async function saveSellerboardCsv(csvText, filename) {
  await kv.set(SELLERBOARD_KEY, {
    csvText,
    filename,
    uploadedAt: new Date().toISOString(),
  });
}

/** Retrieves the most recently uploaded CSV, or null if none has been uploaded yet. */
export async function getLatestSellerboardCsv() {
  const data = await kv.get(SELLERBOARD_KEY);
  return data || null;
}

/** Stores the raw cost sheet CSV text + who/when uploaded it. */
export async function saveCostSheetCsv(csvText, filename) {
  await kv.set(COST_SHEET_KEY, {
    csvText,
    filename,
    uploadedAt: new Date().toISOString(),
  });
}

/** Retrieves the most recently uploaded cost sheet, or null if none uploaded yet. */
export async function getLatestCostSheetCsv() {
  const data = await kv.get(COST_SHEET_KEY);
  return data || null;
}

