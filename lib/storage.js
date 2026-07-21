import { kv } from "@vercel/kv";

const KEY = "sellerboard:latest-csv";

/** Stores the raw CSV text + who/when uploaded it, visible to the whole team. */
export async function saveSellerboardCsv(csvText, filename) {
  await kv.set(KEY, {
    csvText,
    filename,
    uploadedAt: new Date().toISOString(),
  });
}

/** Retrieves the most recently uploaded CSV, or null if none has been uploaded yet. */
export async function getLatestSellerboardCsv() {
  const data = await kv.get(KEY);
  return data || null;
}
