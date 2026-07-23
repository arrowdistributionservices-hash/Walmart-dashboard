import { kv } from "@vercel/kv";

const SELLERBOARD_KEY = "sellerboard:latest-csv";
const COST_SHEET_LIST_KEY = "costsheet:all-uploads";

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

/**
 * Adds a cost sheet upload to the accumulated list, rather than replacing
 * whatever was uploaded before. This lets a client upload multiple sheet
 * tabs (e.g. "Order 1", "Order 2", ...) one at a time without earlier
 * uploads' cost data being lost - each upload just adds to (or updates,
 * per matching SKU/UPC) the combined set of known item costs.
 */
export async function addCostSheetCsv(csvText, filename) {
  const existing = (await kv.get(COST_SHEET_LIST_KEY)) || [];
  const updated = [
    ...existing,
    {
      csvText,
      filename,
      uploadedAt: new Date().toISOString(),
    },
  ];
  await kv.set(COST_SHEET_LIST_KEY, updated);
  return updated;
}

/** Retrieves every cost sheet uploaded so far, oldest first, or [] if none uploaded yet. */
export async function getAllCostSheetCsvs() {
  const data = await kv.get(COST_SHEET_LIST_KEY);
  return data || [];
}

/** Clears all uploaded cost sheets, so a client can start fresh. */
export async function clearCostSheetCsvs() {
  await kv.del(COST_SHEET_LIST_KEY);
}

