// Item costs for each account, pulled from the Overage dashboard's "Avg cost"
// (overage-dashboard /api/avg-costs) instead of uploaded cost-sheet CSVs.
//
// Overage reads each client's own Profit Analysis sheet and gives, per
// Walmart item ID, what the client paid on average across every order tab
// (total spend / total units) plus the latest tab's price. A Walmart sale is
// priced at that average, except for the items in LATEST_TAB_COST_UPCS,
// which use the latest tab's price instead.
//
// Matching a sale to an item is exact-only - nothing is matched by title:
//  1. The sale's SKU/UPC equals a UPC recorded on the client's sheet (the
//     normal case: every client but David lists by UPC).
//  2. A sheet item with no UPC on any of its rows is looked up in Walmart's
//     Items API by its Walmart item ID, using this account's credentials,
//     which returns this seller's own SKU/UPC for that listing.
//  3. A sold SKU that still doesn't match (e.g. a text SKU like
//     "gogreenpowercord") is looked up in the Items API by SKU to get its
//     UPC/GTIN, which is then matched as in 1.
// Items API answers are cached in KV so each item is looked up once. A sale
// that matches nothing gets NO cost and is reported as missing, so it can be
// added to the sheet - it is never guessed.

import { walmartRequestRaw } from "./walmartClient";

const OVERAGE_BASE_URL = process.env.OVERAGE_BASE_URL || "https://overage-dashboard-navy.vercel.app";

// Priced at the latest order tab's cost rather than the average, at the
// user's instruction (2026-10-04): Cronus Zen's buy price moves between
// batches enough that an all-time average misstates current sales.
const LATEST_TAB_COST_UPCS = new Set(["183654000531"]); // Cronus Zen (CM00053)

const LOOKUP_CONCURRENCY = 4;
const MAX_LOOKUPS_PER_REQUEST = 40; // the rest resolve on the next load, from where this one stopped
const NEGATIVE_LOOKUP_TTL_SECONDS = 24 * 60 * 60;

/** Digits with leading zeros stripped - the one form every UPC/GTIN/SKU is compared in. */
export function normId(raw) {
  return String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/** Exact text form for non-numeric SKUs, so "Beef-Tallow-Balm_Walmart" can still be looked up. */
function skuKey(raw) {
  const s = String(raw ?? "").trim();
  return /^\d+$/.test(s) ? normId(s) : s ? `sku:${s.toLowerCase()}` : "";
}

// --- KV via Upstash's REST API with no-store: the @vercel/kv package was
// seen serving stale cached reads on this project, so it is bypassed here. ---
async function kvGet(key) {
  if (!process.env.KV_REST_API_URL) return null;
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.result ? JSON.parse(json.result) : null;
}

async function kvSet(key, value, ttlSeconds) {
  if (!process.env.KV_REST_API_URL) return;
  const path = `/set/${encodeURIComponent(key)}` + (ttlSeconds ? `?EX=${ttlSeconds}` : "");
  await fetch(`${process.env.KV_REST_API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: JSON.stringify(value),
    cache: "no-store",
  });
}

/**
 * One Items API lookup, cached. Returns {sku, upc, gtin} for this seller's
 * listing, or null when Walmart says this seller has no such item. Throws on
 * anything else (rate limit, outage) so a transient failure is never cached
 * as "not found".
 */
async function lookupItem(accountId, id, productIdType) {
  const cacheKey = `itemlookup:${accountId}:${productIdType}:${id}`;
  const cached = await kvGet(cacheKey);
  if (cached) return cached.missing ? null : cached;

  let found = null;
  try {
    const data = await walmartRequestRaw(accountId, `/v3/items/${encodeURIComponent(id)}`, { productIdType });
    const item = (data?.ItemResponse || [])[0];
    if (item) found = { sku: item.sku || "", upc: item.upc || "", gtin: item.gtin || "", productName: item.productName || "" };
  } catch (err) {
    if (!/failed: 404/.test(err.message)) throw err;
  }
  await kvSet(cacheKey, found || { missing: true }, found ? undefined : NEGATIVE_LOOKUP_TTL_SECONDS);
  return found;
}

async function runLimited(tasks, limit) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) await tasks[next++]();
  });
  await Promise.all(workers);
}

/**
 * Fetches the account's item costs from Overage and returns a pricer for its
 * order lines.
 *
 * @param {Object} account - from lib/accounts.js; needs overageClient + profitSheetId
 * @param {Array} soldLines - the order lines about to be priced ({sku, upc}),
 *   so unmatched SKUs can be resolved through the Items API
 */
export async function loadAvgCosts(account, soldLines) {
  if (!account.overageClient) {
    throw new Error(`${account.name} has no Overage client mapped in lib/accounts.js`);
  }
  const res = await fetch(`${OVERAGE_BASE_URL}/api/avg-costs?client=${encodeURIComponent(account.overageClient)}`, {
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Overage returned ${res.status}`);
  // Guard against a roster mix-up on either side (e.g. Brian vs Bryan):
  // costs are only accepted from the sheet this account is pinned to.
  if (payload.sheetId !== account.profitSheetId) {
    throw new Error(
      `Overage returned costs from sheet ${payload.sheetId} for ${account.name}, expected ${account.profitSheetId} - refusing to use them`
    );
  }

  const itemsById = new Map(payload.items.map((i) => [i.walmartId, i]));
  const idsByKey = new Map(); // normalized UPC/GTIN/SKU -> Set(walmartId)
  const addAlias = (raw, walmartId) => {
    const key = skuKey(raw);
    if (!key) return;
    if (!idsByKey.has(key)) idsByKey.set(key, new Set());
    idsByKey.get(key).add(walmartId);
  };
  for (const item of payload.items) for (const upc of item.upcs) addAlias(upc, item.walmartId);
  // UPCs learned from Walmart for sheet items that carry none, so rules keyed
  // on UPC (LATEST_TAB_COST_UPCS) still recognise those items.
  const resolvedUpcsById = new Map();

  const lookupErrors = [];
  let lookupsDeferred = 0;
  const tasks = [];
  const queue = (fn) => {
    if (tasks.length >= MAX_LOOKUPS_PER_REQUEST) {
      lookupsDeferred++;
      return;
    }
    tasks.push(async () => {
      try {
        await fn();
      } catch (err) {
        lookupErrors.push(String(err.message).slice(0, 200));
      }
    });
  };

  // (2) sheet items with no UPC anywhere -> this seller's SKU/UPC for that listing
  for (const item of payload.items) {
    if (item.upcs.length) continue;
    queue(async () => {
      const hit = await lookupItem(account.id, item.walmartId, "ITEM_ID");
      if (!hit) return;
      for (const raw of [hit.sku, hit.upc, hit.gtin]) addAlias(raw, item.walmartId);
      resolvedUpcsById.set(item.walmartId, [hit.upc, hit.gtin].filter(Boolean));
    });
  }
  await runLimited(tasks.splice(0), LOOKUP_CONCURRENCY);

  // (3) sold SKUs still unmatched -> their UPC/GTIN, matched against the sheet's UPCs
  const matches = (line) => [line.sku, line.upc].some((raw) => idsByKey.has(skuKey(raw)));
  const unmatchedSkus = new Set(soldLines.filter((l) => l.sku && !matches(l)).map((l) => String(l.sku).trim()));
  for (const sku of unmatchedSkus) {
    queue(async () => {
      const hit = await lookupItem(account.id, sku, "SKU");
      if (!hit) return;
      const ids = new Set();
      for (const raw of [hit.upc, hit.gtin]) for (const id of idsByKey.get(skuKey(raw)) || []) ids.add(id);
      for (const id of ids) addAlias(sku, id);
    });
  }
  await runLimited(tasks.splice(0), LOOKUP_CONCURRENCY);

  /**
   * Cost per unit for one order line, or null when the line matches no item
   * on the client's sheet.
   */
  function priceLine({ sku, upc }) {
    const ids = new Set();
    for (const raw of [sku, upc]) for (const id of idsByKey.get(skuKey(raw)) || []) ids.add(id);
    if (!ids.size) return null;
    const items = [...ids].map((id) => itemsById.get(id));

    const upcsOf = (i) => [...i.upcs, ...(resolvedUpcsById.get(i.walmartId) || [])];
    const latestTabRule =
      items.some((i) => upcsOf(i).some((u) => LATEST_TAB_COST_UPCS.has(normId(u)))) ||
      [sku, upc].some((r) => LATEST_TAB_COST_UPCS.has(normId(r)));
    if (latestTabRule) {
      const latest = items.reduce((a, b) => ((b.latestBatch ?? -1) > (a.latestBatch ?? -1) ? b : a));
      return { costPerUnit: latest.latestCost, basis: "latest", tab: latest.latestTab, walmartIds: [...ids], title: latest.title };
    }
    if (items.length === 1) {
      return { costPerUnit: items[0].avgCost, basis: "avg", walmartIds: [...ids], title: items[0].title };
    }
    // One UPC listed under several Walmart item IDs is the same product sold
    // under two listings, so the client's average is taken across both,
    // weighted by units bought - the same rule Overage uses within one item.
    const qty = items.reduce((s, i) => s + (i.totalQty || 0), 0);
    const costPerUnit =
      qty > 0
        ? Math.round((items.reduce((s, i) => s + (i.totalSpend || 0), 0) / qty) * 100) / 100
        : Math.round((items.reduce((s, i) => s + i.avgCost, 0) / items.length) * 100) / 100;
    return { costPerUnit, basis: "avg", walmartIds: [...ids], title: items[0].title };
  }

  return {
    priceLine,
    meta: {
      source: "overage",
      client: payload.name,
      sheetId: payload.sheetId,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${payload.sheetId}/edit`,
      itemCount: payload.items.length,
      generatedAt: payload.generatedAt,
      lookupErrors: lookupErrors.slice(0, 5),
      lookupErrorCount: lookupErrors.length,
      lookupsDeferred,
    },
  };
}
