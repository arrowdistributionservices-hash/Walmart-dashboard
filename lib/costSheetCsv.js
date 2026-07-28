import { parse } from "csv-parse/sync";

// Header cells (case-insensitive, trimmed) that mark the start of a cost
// data block. A block must have BOTH a Title-ish column and a UPC-ish
// column, plus a cost column, or we don't treat it as a cost table (this
// lets us skip over unrelated tables in the same sheet, e.g. shipping /
// tracking logs that also start with "|").
const TITLE_HEADERS = ["title", "product", "item description", "description"];
const UPC_HEADERS = ["upc", "gtin", "ean", "barcode"];
const WALMART_ID_HEADERS = ["walmart id", "item id", "wpid"];
const COST_HEADERS = ["buycost", "buy cost", "unit cost", "cost", "cost per unit", "cogs"];
const SKU_HEADERS = ["sku", "seller sku", "walmart sku"];

function normalizeHeaderCell(cell) {
  return String(cell || "").trim().toLowerCase();
}

function findColIndex(headerRow, candidates) {
  const normalized = headerRow.map(normalizeHeaderCell);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

/** Strips everything but digits. */
function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

/** Returns every normalized key variant worth indexing for a given raw identifier. */
function keyVariants(raw) {
  const digits = digitsOnly(raw);
  if (!digits) return [];
  const variants = new Set([digits]);
  const stripped = digits.replace(/^0+/, "");
  if (stripped) variants.add(stripped);
  // Common GTIN/UPC paddings, in case the two sides of the match disagree
  // on leading zeros (UPC-A is 12 digits, GTIN-14 is 14 digits, EAN-13 is 13).
  for (const len of [12, 13, 14]) {
    if (stripped.length <= len) variants.add(stripped.padStart(len, "0"));
  }
  return [...variants];
}

/**
 * Parses a cost sheet CSV (possibly containing multiple stacked tables with
 * repeated header rows - this is how sourcing/arbitrage sheets like Kyle's
 * are typically exported from Google Sheets) into a flat cost lookup.
 *
 * Returns:
 *   costByKey: { [normalizedKey]: { costPerUnit, title, matchedOn } }
 *   entries: [{ title, upc, walmartId, costPerUnit }]   (raw, for debugging/preview)
 *   blocksFound: number of cost-data blocks detected
 */
export function parseCostSheetCsvText(csvText) {
  const rows = parse(csvText, {
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  const costByKey = {};
  const entries = [];
  let blocksFound = 0;
  let colMap = null; // { titleIdx, upcIdx, walmartIdIdx, costIdx, skuIdx }

  for (const row of rows) {
    const normalizedCells = row.map(normalizeHeaderCell);
    const looksLikeTitleUpcHeader =
      normalizedCells.some((c) => TITLE_HEADERS.includes(c)) &&
      (normalizedCells.some((c) => UPC_HEADERS.includes(c)) ||
        normalizedCells.some((c) => SKU_HEADERS.includes(c)) ||
        normalizedCells.some((c) => WALMART_ID_HEADERS.includes(c)));

    if (looksLikeTitleUpcHeader) {
      const costIdx = findColIndex(row, COST_HEADERS);
      if (costIdx === -1) {
        // A header row without any recognizable cost column - not a cost
        // table (e.g. a shipping log). Stop treating subsequent rows as data.
        colMap = null;
        continue;
      }
      colMap = {
        titleIdx: findColIndex(row, TITLE_HEADERS),
        upcIdx: findColIndex(row, UPC_HEADERS),
        walmartIdIdx: findColIndex(row, WALMART_ID_HEADERS),
        skuIdx: findColIndex(row, SKU_HEADERS),
        costIdx,
      };
      blocksFound++;
      continue;
    }

    if (!colMap) continue; // not currently inside a recognized cost block

    const title = colMap.titleIdx !== -1 ? row[colMap.titleIdx] : "";
    const upc = colMap.upcIdx !== -1 ? row[colMap.upcIdx] : "";
    const walmartId = colMap.walmartIdIdx !== -1 ? row[colMap.walmartIdIdx] : "";
    const sku = colMap.skuIdx !== -1 ? row[colMap.skuIdx] : "";
    const costPerUnit = toNumber(row[colMap.costIdx]);

    if (!title || !costPerUnit) continue; // skip totals rows / blank rows

    entries.push({ title, upc, walmartId, sku, costPerUnit });

    // Index this cost under every identifier + normalized variant we have,
    // so the order-matching step can look it up however the client's
    // Walmart SKU happens to be set (UPC, item ID, or a literal SKU).
    for (const raw of [upc, walmartId, sku]) {
      for (const key of keyVariants(raw)) {
        // Later rows win - sheets like Kyle's are appended to over time
        // ("Order 1", "Order 2", ...), so a later block reflects a more
        // recent purchase cost for the same item.
        costByKey[key] = { costPerUnit, title, matchedOn: raw };
      }
    }
  }

  return { costByKey, entries, blocksFound };
}

/** Looks up a unit cost for a Walmart order line, trying every identifier we have. */
export function lookupCost(costByKey, { sku, upc } = {}) {
  for (const raw of [sku, upc]) {
    for (const key of keyVariants(raw)) {
      if (costByKey[key]) return costByKey[key];
    }
  }
  return null;
}

/**
 * Merges multiple cost sheet CSV texts (e.g. several separately-uploaded
 * sheet tabs) into one combined lookup. Sheets are merged in the order
 * given - if the same UPC/SKU shows up in more than one sheet, the LAST
 * one in the list wins, so re-uploading an updated tab refreshes its
 * costs without needing to re-upload every other tab too.
 */
export function mergeCostSheets(csvTexts) {
  const costByKey = {};
  const entries = [];
  let blocksFound = 0;

  for (const csvText of csvTexts) {
    if (!csvText) continue;
    const parsed = parseCostSheetCsvText(csvText);
    blocksFound += parsed.blocksFound;
    entries.push(...parsed.entries);
    Object.assign(costByKey, parsed.costByKey);
  }

  return { costByKey, entries, blocksFound };
}

/**
 * Builds FIFO purchase queues from multiple cost sheet uploads, read in
 * upload order. Each tracked cost-sheet row is treated as ONE purchased
 * unit at that recorded cost - arbitrage sourcing sheets like these are
 * logged per purchase transaction, so the same item appearing on several
 * rows/sheets (e.g. "Order 1", "Order 2", or a later re-upload) means
 * separate units were bought, often at different prices. This builds a
 * chronological queue per item - oldest purchase first - instead of the
 * flat "last one wins" lookup `mergeCostSheets` produces.
 *
 * A single physical item can be indexed under several raw identifiers
 * (SKU, UPC, Walmart ID) at once. To avoid the same purchased unit being
 * consumed twice just because two different sold lines happened to match
 * it via different identifier types, every row is assigned ONE canonical
 * queue (preferring SKU, then UPC, then Walmart ID - the same priority
 * order lookups use), and every identifier variant it has resolves back
 * to that single canonical queue via `aliasToCanonical`.
 */
export function buildFifoQueues(csvTexts) {
  const queues = {}; // canonicalKey -> [entry, entry, ...] in purchase order
  const aliasToCanonical = {}; // any identifier variant -> canonicalKey
  const entries = [];
  let blocksFound = 0;

  for (const csvText of csvTexts) {
    if (!csvText) continue;
    const parsed = parseCostSheetCsvText(csvText);
    blocksFound += parsed.blocksFound;

    for (const entry of parsed.entries) {
      entries.push(entry);
      const canonicalRaw = entry.sku || entry.upc || entry.walmartId;
      const canonicalVariants = keyVariants(canonicalRaw);
      if (!canonicalVariants.length) continue;
      const canonicalKey = canonicalVariants[0];

      (queues[canonicalKey] ||= []).push(entry);

      for (const raw of [entry.sku, entry.upc, entry.walmartId]) {
        for (const key of keyVariants(raw)) {
          aliasToCanonical[key] = canonicalKey;
        }
      }
    }
  }

  return { queues, aliasToCanonical, entries, blocksFound };
}

/**
 * Creates a stateful FIFO cost allocator from `buildFifoQueues`'s output.
 * Call `consume({sku, upc, quantity})` once per sold line item, IN
 * CHRONOLOGICAL ORDER OF SALE (oldest order date first) - this is what
 * makes it FIFO: the earliest-purchased units get matched to the
 * earliest sales, draining each item's queue in purchase order.
 *
 * If a line's sold quantity exceeds what's left in its queue (more units
 * sold than were ever logged in a cost sheet - normal once inventory
 * "catches up" to sourcing, or if some purchases were never logged), the
 * shortfall is priced at the most recent known cost for that item rather
 * than left unmatched, and the result is flagged `usedFallback: true` so
 * the caller can note it's an estimate rather than an exact FIFO match.
 * Returns null only when the item has no cost-sheet history at all.
 */
export function createFifoAllocator({ queues, aliasToCanonical }) {
  // Copy queues so this allocator's consumption never mutates the caller's
  // original parsed data (relevant if the same parsed result is reused
  // across multiple requests/allocators).
  const liveQueues = {};
  const lastEntryByKey = {};
  for (const [key, list] of Object.entries(queues || {})) {
    liveQueues[key] = [...list];
    if (list.length) lastEntryByKey[key] = list[list.length - 1];
  }

  function resolveCanonicalKey(sku, upc) {
    for (const raw of [sku, upc]) {
      for (const key of keyVariants(raw)) {
        const canonical = aliasToCanonical?.[key];
        if (canonical) return canonical;
      }
    }
    return null;
  }

  return {
    consume({ sku, upc, quantity }) {
      const qty = quantity || 1;
      const canonicalKey = resolveCanonicalKey(sku, upc);
      if (!canonicalKey) return null; // never seen this item in any cost sheet

      const queue = liveQueues[canonicalKey];
      const lastEntry = lastEntryByKey[canonicalKey];
      let remaining = qty;
      let totalCost = 0;
      let title = lastEntry?.title;
      let usedFallback = false;

      while (remaining > 0 && queue.length > 0) {
        const unit = queue.shift();
        totalCost += unit.costPerUnit;
        title = unit.title;
        remaining--;
      }
      if (remaining > 0 && lastEntry) {
        totalCost += remaining * lastEntry.costPerUnit;
        usedFallback = true;
      }

      return { totalCost, costPerUnit: totalCost / qty, title, usedFallback };
    },
  };
}

