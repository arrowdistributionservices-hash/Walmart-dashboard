// Server-side only. Reads credentials from environment variables set in
// your hosting platform (e.g. Vercel Project Settings > Environment
// Variables). NEVER exposed to the browser.

const BASE_URLS = {
  sandbox: "https://sandbox.walmartapis.com",
  production: "https://marketplace.walmartapis.com",
};

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getConfig() {
  const clientId = process.env.WALMART_CLIENT_ID;
  const clientSecret = process.env.WALMART_CLIENT_SECRET;
  const env = process.env.WALMART_ENV || "production";
  if (!clientId || !clientSecret) {
    throw new Error("Missing WALMART_CLIENT_ID or WALMART_CLIENT_SECRET environment variables.");
  }
  const baseUrl = BASE_URLS[env];
  if (!baseUrl) throw new Error(`Unknown WALMART_ENV "${env}".`);
  return { clientId, clientSecret, baseUrl };
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt - 60_000) return cachedToken;

  const { clientId, clientSecret, baseUrl } = getConfig();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${baseUrl}/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Walmart token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

async function walmartRequest(path, query = {}) {
  const { baseUrl } = getConfig();
  const token = await getAccessToken();
  const url = new URL(`${baseUrl}${path}`);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.set(k, v);
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "WM_SVC.NAME": "Walmart Marketplace",
        "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
        "WM_SEC.ACCESS_TOKEN": token,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Walmart API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function parseWalmartDate(raw) {
  if (!raw) return null;
  const isNumeric = typeof raw === "string" && /^\d+$/.test(raw);
  const d = isNumeric ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractOrderRevenue(order) {
  const orderDate = parseWalmartDate(order?.orderDate);
  let revenue = 0;
  const lines = order?.orderLines?.orderLine || [];
  for (const line of lines) {
    const charges = line?.charges?.charge || [];
    for (const charge of charges) {
      if (charge?.chargeType === "PRODUCT") revenue += Number(charge?.chargeAmount?.amount || 0);
    }
  }
  return { orderDate, revenue, purchaseOrderId: order?.purchaseOrderId };
}

/**
 * Extracts per-line-item detail from a single order: sku, title, quantity,
 * and the PRODUCT revenue attributed to that line. Used for cost-of-goods
 * matching (see lib/costSheetCsv.js) since aggregate order totals alone
 * can't be tied back to a per-SKU cost.
 */
function extractOrderLineItems(order) {
  const orderDate = parseWalmartDate(order?.orderDate);
  const purchaseOrderId = order?.purchaseOrderId;
  const lines = order?.orderLines?.orderLine || [];
  const items = [];
  for (const line of lines) {
    const charges = line?.charges?.charge || [];
    let lineRevenue = 0;
    for (const charge of charges) {
      if (charge?.chargeType === "PRODUCT") lineRevenue += Number(charge?.chargeAmount?.amount || 0);
    }
    const quantity = Number(line?.orderLineQuantity?.amount || line?.orderLineQuantity || 0) || 1;
    items.push({
      purchaseOrderId,
      orderDate: orderDate ? orderDate.toISOString().slice(0, 10) : null,
      lineNumber: line?.lineNumber || null,
      sku: line?.item?.sku || null,
      upc: line?.item?.upc || line?.item?.gtin || null,
      title: line?.item?.productName || null,
      quantity,
      revenue: lineRevenue,
    });
  }
  return items;
}

/**
 * Flattens every order line across a list of orders - one entry per SKU per
 * order - for cost-of-goods matching against an uploaded cost sheet.
 */
export function extractAllOrderLineItems(orders) {
  const all = [];
  for (const order of orders) {
    all.push(...extractOrderLineItems(order));
  }
  return all;
}

async function getAllOrders({ createdStartDate, createdEndDate, shipNodeType, limit = 200 }) {
  const allOrders = [];
  let query = { createdStartDate, createdEndDate, limit, shipNodeType };
  let nextCursor = null;
  const MAX_PAGES = 50;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = nextCursor
      ? await walmartRequest(`/v3/orders${nextCursor}`, {})
      : await walmartRequest("/v3/orders", query);
    const list = data?.list;
    if (list?.elements?.order) allOrders.push(...list.elements.order);
    nextCursor = list?.meta?.nextCursor;
    if (!nextCursor) break;
  }
  return allOrders;
}

export async function getAllOrdersAllFulfillmentTypes({ createdStartDate, createdEndDate }) {
  const seen = new Map();
  for (const shipNodeType of ["SellerFulfilled", "WFSFulfilled"]) {
    const orders = await getAllOrders({ createdStartDate, createdEndDate, shipNodeType });
    for (const order of orders) {
      const key = order?.purchaseOrderId || JSON.stringify(order).slice(0, 100);
      if (!seen.has(key)) seen.set(key, order);
    }
  }
  return [...seen.values()];
}

export function aggregateRevenueByOrderId(orders) {
  const byOrderId = {};
  for (const order of orders) {
    const { orderDate, revenue, purchaseOrderId } = extractOrderRevenue(order);
    if (!purchaseOrderId) continue;
    byOrderId[purchaseOrderId] = {
      orderDate: orderDate ? orderDate.toISOString().slice(0, 10) : null,
      revenue: (byOrderId[purchaseOrderId]?.revenue || 0) + revenue,
    };
  }
  return byOrderId;
}

export function aggregateRevenueByDay(orders) {
  const byDay = {};
  for (const order of orders) {
    const { orderDate, revenue } = extractOrderRevenue(order);
    if (!orderDate) continue;
    const key = orderDate.toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + revenue;
  }
  return byDay;
}

// --- Recon (payments/settlement) data ---

function parseReconSettlementDate(mmddyyyy) {
  if (!mmddyyyy || mmddyyyy.length !== 8) return null;
  const mm = mmddyyyy.slice(0, 2);
  const dd = mmddyyyy.slice(2, 4);
  const yyyy = mmddyyyy.slice(4, 8);
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getAllReconReportJson(reportDate) {
  const allRows = [];
  let offset = 0;
  const noOfRecords = 200;
  const MAX_PAGES = 100;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let data;
    try {
      data = await walmartRequest("/v3/report/reconreport/reconFileJson", {
        reportVersion: "v1",
        reportDate,
        offset,
        noOfRecords,
      });
    } catch (err) {
      if (page === 1) throw err;
      break; // later pages failing usually just means end of data
    }
    const rows = data?.reportData || [];
    allRows.push(...rows);
    if (rows.length < noOfRecords) break;
    offset += noOfRecords;
  }
  return allRows;
}

export async function getAvailableReconReportDates() {
  const available = await walmartRequest("/v3/report/reconreport/availableReconFiles", {
    reportVersion: "v1",
  });
  return available?.availableApReportDates || [];
}

export async function getReconDataForDateRange({ startDate, endDate }) {
  const available = await walmartRequest("/v3/report/reconreport/availableReconFiles", {
    reportVersion: "v1",
  });
  const allDates = available?.availableApReportDates || [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const inRange = allDates.filter((d) => {
    const parsed = parseReconSettlementDate(d);
    return parsed && parsed >= start && parsed <= end;
  });

  const allRows = [];
  for (const reportDate of inRange) {
    const rows = await getAllReconReportJson(reportDate);
    allRows.push(...rows);
  }
  return allRows;
}

const REVENUE_AMOUNT_TYPES = new Set(["Product Price", "Total Walmart Funded Savings", "Promo Code"]);
const INCENTIVE_AMOUNT_TYPES = new Set(["Total Walmart Funded Savings", "Promo Code"]);
// Real category names confirmed against this account's actual settlement
// report (see app/api/debug-recon). "Product tax" / "Product tax withheld"
// are deliberately excluded - they net to $0 (collected then remitted) and
// aren't part of the seller's revenue or cost.
const FEE_AMOUNT_TYPES = new Set(["Commission on Product", "Fee/Reimbursement", "WFS Inventory Fee/Reimbursement"]);

function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

export function aggregateReconByDay(rows) {
  const byDay = {};
  for (const row of rows) {
    const d = new Date(row["Transaction Posted Timestamp"]);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    const amountType = row["Amount Type"];
    const amount = toNumber(row["Amount"]);
    if (!byDay[key]) byDay[key] = { revenue: 0, incentive: 0, fees: 0 };
    if (REVENUE_AMOUNT_TYPES.has(amountType)) byDay[key].revenue += amount;
    if (INCENTIVE_AMOUNT_TYPES.has(amountType)) byDay[key].incentive += amount;
    if (FEE_AMOUNT_TYPES.has(amountType)) byDay[key].fees += amount;
  }
  return byDay;
}

export function aggregateReconByOrder(rows) {
  const byOrder = {};
  for (const row of rows) {
    const orderId = row["Purchase Order #"] || row["Customer Order #"];
    if (!orderId) continue;
    const amountType = row["Amount Type"];
    const amount = toNumber(row["Amount"]);
    if (!byOrder[orderId]) byOrder[orderId] = { revenue: 0, incentive: 0, fees: 0 };
    if (REVENUE_AMOUNT_TYPES.has(amountType)) byOrder[orderId].revenue += amount;
    if (INCENTIVE_AMOUNT_TYPES.has(amountType)) byOrder[orderId].incentive += amount;
    if (FEE_AMOUNT_TYPES.has(amountType)) byOrder[orderId].fees += amount;
  }
  return byOrder;
}

