import { parse } from "csv-parse/sync";

const DATE_HEADERS = ["date", "day", "order date"];
const REVENUE_HEADERS = ["sales", "sales, $", "revenue", "gross sales", "gross revenue"];
const PROFIT_HEADERS = ["net profit", "net profit, $", "profit", "gross profit", "estimated profit"];
const STATUS_HEADERS = ["status", "order status"];
const ORDER_NUMBER_HEADERS = ["order number", "order #", "order id", "order no"];
const EXCLUDED_STATUSES = /cancel|refund/i;

function findHeader(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  for (const candidate of candidates) {
    const idx = lower.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function toDateKey(value) {
  if (!value) return null;
  // "DD.MM.YYYY" dot format (common in Sellerboard exports) — JS's Date
  // constructor misreads this as MM.DD.YYYY, so handle it explicitly.
  const dotMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value).trim());
  if (dotMatch) {
    const [, dd, mm, yyyy] = dotMatch;
    const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Parses Sellerboard CSV text into row-level order records.
 * Returns { rows: [{ orderNumber, date, revenue, profit, status }], columnsUsed }
 */
export function parseSellerboardCsvText(csvText) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  if (records.length === 0) throw new Error("No rows found in the uploaded CSV.");

  const headers = Object.keys(records[0]);
  const dateCol = findHeader(headers, DATE_HEADERS);
  const revenueCol = findHeader(headers, REVENUE_HEADERS);
  const profitCol = findHeader(headers, PROFIT_HEADERS);
  const statusCol = findHeader(headers, STATUS_HEADERS);
  const orderNumberCol = findHeader(headers, ORDER_NUMBER_HEADERS);

  if (!dateCol || !revenueCol || !orderNumberCol) {
    throw new Error(
      `Couldn't auto-detect required columns (date/revenue/order number). Headers found: ${headers.join(", ")}`
    );
  }

  const rows = [];
  let skippedForStatus = 0;
  for (const row of records) {
    if (statusCol && EXCLUDED_STATUSES.test(row[statusCol] || "")) {
      skippedForStatus++;
      continue;
    }
    const key = toDateKey(row[dateCol]);
    if (!key) continue;
    rows.push({
      orderNumber: String(row[orderNumberCol] || "").trim(),
      date: key,
      revenue: toNumber(row[revenueCol]),
      profit: profitCol ? toNumber(row[profitCol]) : null,
      status: statusCol ? row[statusCol] : null,
    });
  }

  return { rows, columnsUsed: { dateCol, revenueCol, profitCol, statusCol, orderNumberCol }, skippedForStatus };
}
