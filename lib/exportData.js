import * as XLSX from "xlsx";

const DAILY_HEADERS = [
  "Date",
  "Orders Rev",
  "Incentive",
  "Walmart Total",
  "Fees",
  "Net After Fees",
  "Item Cost",
  "Profit",
  "Fees Pending",
];

const ORDER_HEADERS = [
  "Order ID",
  "Date",
  "Orders Rev",
  "Incentive",
  "Walmart Total",
  "Fees",
  "Net After Fees",
  "Item Cost",
  "Profit",
  "Cost Matched",
  "Fees Pending",
];

function dailyRow(d, accountName) {
  const row = [
    d.date,
    d.ordersRev,
    d.incentive,
    d.walmartTotal,
    d.fees,
    d.netAfterFees,
    d.itemCost,
    d.profit,
    d.feesPending ? "Yes" : "No",
  ];
  return accountName ? [accountName, ...row] : row;
}

function orderRow(o, accountName) {
  const row = [
    o.orderId,
    o.date || "",
    o.walmartOrdersRev,
    o.incentive,
    o.walmartTotal,
    o.fees,
    o.netAfterFees,
    o.itemCost,
    o.profit,
    o.costMatched ? "Yes" : "No",
    o.feesPending ? "Yes" : "No",
  ];
  return accountName ? [accountName, ...row] : row;
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

/** Builds a CSV of the daily breakdown for a single account. */
export function buildSingleAccountCsv(accountData) {
  const rows = [DAILY_HEADERS, ...(accountData.daily || []).map((d) => dailyRow(d))];
  return toCsv(rows);
}

/** Builds a CSV stacking every configured account's daily rows, with an Account column, plus a totals section. */
export function buildAllAccountsCsv(accountsData) {
  const rows = [["Account", ...DAILY_HEADERS]];
  for (const acct of accountsData) {
    if (!acct.daily) continue;
    for (const d of acct.daily) rows.push(dailyRow(d, acct.accountName));
  }
  rows.push([]);
  rows.push(["TOTALS BY ACCOUNT"]);
  rows.push(["Account", "Orders Rev", "Incentive", "Walmart Total", "Fees", "Net After Fees", "Item Cost", "Profit"]);
  let grand = { ordersRev: 0, incentive: 0, fees: 0, walmartTotal: 0, netAfterFees: 0, itemCost: 0, profit: 0 };
  for (const acct of accountsData) {
    const t = acct.totals;
    if (!t) continue;
    rows.push([acct.accountName, t.ordersRev, t.incentive, t.walmartTotal, t.fees, t.netAfterFees, t.itemCost, t.profit]);
    grand.ordersRev += t.ordersRev;
    grand.incentive += t.incentive;
    grand.fees += t.fees;
    grand.walmartTotal += t.walmartTotal;
    grand.netAfterFees += t.netAfterFees;
    grand.itemCost += t.itemCost;
    grand.profit += t.profit;
  }
  rows.push([
    "GRAND TOTAL",
    grand.ordersRev,
    grand.incentive,
    grand.walmartTotal,
    grand.fees,
    grand.netAfterFees,
    grand.itemCost,
    grand.profit,
  ]);
  return toCsv(rows);
}

// Excel sheet names are capped at 31 chars and can't contain: \ / ? * [ ]
function safeSheetName(name) {
  return name.replace(/[\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
}

/** Builds an .xlsx workbook (as a Buffer) for a single account: Totals, Daily, Orders sheets. */
export function buildSingleAccountXlsx(accountData) {
  const wb = XLSX.utils.book_new();

  const t = accountData.totals || {};
  const totalsSheet = XLSX.utils.aoa_to_sheet([
    ["Metric", "Value"],
    ["Orders Revenue", t.ordersRev || 0],
    ["Incentives", t.incentive || 0],
    ["Walmart Total", t.walmartTotal || 0],
    ["Walmart Fees", t.fees || 0],
    ["Net After Fees", t.netAfterFees || 0],
    ["Item Cost (COGS)", t.itemCost || 0],
    ["Profit", t.profit || 0],
  ]);
  XLSX.utils.book_append_sheet(wb, totalsSheet, "Totals");

  const dailySheet = XLSX.utils.aoa_to_sheet([
    DAILY_HEADERS,
    ...(accountData.daily || []).map((d) => dailyRow(d)),
  ]);
  XLSX.utils.book_append_sheet(wb, dailySheet, "Daily");

  const orderSheet = XLSX.utils.aoa_to_sheet([
    ORDER_HEADERS,
    ...(accountData.orderLevel || []).map((o) => orderRow(o)),
  ]);
  XLSX.utils.book_append_sheet(wb, orderSheet, "Orders");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** Builds an .xlsx workbook (as a Buffer) covering every configured account: a Totals sheet plus per-account Daily/Orders sheets. */
export function buildAllAccountsXlsx(accountsData) {
  const wb = XLSX.utils.book_new();

  const totalsRows = [
    ["Account", "Orders Rev", "Incentive", "Walmart Total", "Fees", "Net After Fees", "Item Cost", "Profit"],
  ];
  let grand = { ordersRev: 0, incentive: 0, fees: 0, walmartTotal: 0, netAfterFees: 0, itemCost: 0, profit: 0 };
  for (const acct of accountsData) {
    const t = acct.totals;
    if (!t) {
      totalsRows.push([acct.accountName, "not connected"]);
      continue;
    }
    totalsRows.push([acct.accountName, t.ordersRev, t.incentive, t.walmartTotal, t.fees, t.netAfterFees, t.itemCost, t.profit]);
    grand.ordersRev += t.ordersRev;
    grand.incentive += t.incentive;
    grand.fees += t.fees;
    grand.walmartTotal += t.walmartTotal;
    grand.netAfterFees += t.netAfterFees;
    grand.itemCost += t.itemCost;
    grand.profit += t.profit;
  }
  totalsRows.push([
    "GRAND TOTAL",
    grand.ordersRev,
    grand.incentive,
    grand.walmartTotal,
    grand.fees,
    grand.netAfterFees,
    grand.itemCost,
    grand.profit,
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(totalsRows), "Grand Totals");

  for (const acct of accountsData) {
    if (!acct.daily) continue;
    const dailySheet = XLSX.utils.aoa_to_sheet([DAILY_HEADERS, ...acct.daily.map((d) => dailyRow(d))]);
    XLSX.utils.book_append_sheet(wb, dailySheet, safeSheetName(`${acct.accountName} Daily`));

    const orderSheet = XLSX.utils.aoa_to_sheet([ORDER_HEADERS, ...(acct.orderLevel || []).map((o) => orderRow(o))]);
    XLSX.utils.book_append_sheet(wb, orderSheet, safeSheetName(`${acct.accountName} Orders`));
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
