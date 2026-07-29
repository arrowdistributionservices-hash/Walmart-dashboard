import { kv } from "@vercel/kv";

const sellerboardKey = (accountId) => `sellerboard:latest-csv:${accountId}`;
const costSheetListKey = (accountId) => `costsheet:all-uploads:${accountId}`;

/** Stores the raw CSV text + who/when uploaded it, visible to the whole team. */
export async function saveSellerboardCsv(accountId, csvText, filename) {
  await kv.set(sellerboardKey(accountId), {
    csvText,
    filename,
    uploadedAt: new Date().toISOString(),
  });
}

/** Retrieves the most recently uploaded CSV, or null if none has been uploaded yet. */
export async function getLatestSellerboardCsv(accountId) {
  const data = await kv.get(sellerboardKey(accountId));
  return data || null;
}

/**
 * Adds a cost sheet upload to the accumulated list, rather than replacing
 * whatever was uploaded before. This lets a client upload multiple sheet
 * tabs (e.g. "Order 1", "Order 2", ...) one at a time without earlier
 * uploads' cost data being lost - each upload just adds to (or updates,
 * per matching SKU/UPC) the combined set of known item costs.
 */
export async function addCostSheetCsv(accountId, csvText, filename) {
  const key = costSheetListKey(accountId);
  const existing = (await kv.get(key)) || [];
  const updated = [
    ...existing,
    {
      csvText,
      filename,
      uploadedAt: new Date().toISOString(),
    },
  ];
  await kv.set(key, updated);
  return updated;
}

/** Retrieves every cost sheet uploaded so far, oldest first, or [] if none uploaded yet. */
export async function getAllCostSheetCsvs(accountId) {
  const data = await kv.get(costSheetListKey(accountId));
  return data || [];
}

/** Clears all uploaded cost sheets, so a client can start fresh. */
export async function clearCostSheetCsvs(accountId) {
  await kv.del(costSheetListKey(accountId));
}

/**
 * Removes one mistakenly-uploaded cost sheet by exact filename, leaving the
 * rest of the account's uploads untouched. Returns how many entries were
 * removed (0 if no match) and the filenames still on file afterward.
 */
export async function removeCostSheetCsvByFilename(accountId, filename) {
  const key = costSheetListKey(accountId);
  const existing = (await kv.get(key)) || [];
  const remaining = existing.filter((u) => u.filename !== filename);
  const removedCount = existing.length - remaining.length;
  if (removedCount > 0) {
    await kv.set(key, remaining);
  }
  return { removedCount, remainingFilenames: remaining.map((u) => u.filename) };
}
