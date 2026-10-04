// Estimates fees and Walmart-funded incentives for order lines whose
// settlement data hasn't posted yet (see orderIsSettled in
// computeAccountData.js). Walmart's Recon Report lags real orders by up to
// ~2 weeks, so without this the most recent stretch of every range would
// show $0 fees/incentive.
//
// The rules below were learned from Kyle's hand-corrected P&L (~2,350
// orders, Aug 2025 - Aug 2026) and backtested against it - each pending
// order was predicted using only orders that had settled 14+ days earlier:
//
//  - REFERRAL (commission) is charged on the LISTED price - what the
//    customer paid PLUS any Walmart-funded incentive - not on the customer
//    price alone. Standard is 15% (8% for some electronics; Cronus-type
//    accessories are tiered 15% up to $100 / 8% above). Walmart also runs
//    time-limited per-item discounts on it (seen as 90%, 75% and 0% of the
//    standard rate), so each SKU's rate is taken from its most recent
//    settlements rather than averaged over its whole history.
//  - WFS FULFILLMENT is a flat $ per unit set by the item's size/weight
//    tier ($3.45, $4.95, $6.15, ...) - stable per SKU, unrelated to price.
//  - INCENTIVE is Walmart funding the gap when it drops the customer price
//    below our listed price to match a competitor. It's SKU-specific: most
//    SKUs never get one, so an account-wide rate smeared over every order
//    (the previous approach) invented incentive on items that never earn
//    it. Estimated as a blend of (a) the gap between this order's price and
//    the SKU's recent listed price, if the SKU has recently been
//    incentivised, and (b) the SKU's recent incentive rate.
//
// Backtest, mean absolute error per order: fees $3.67 -> $1.79, incentive
// $2.42 -> $1.80 (total incentive within ~5% of actual).

const DEFAULT_REFERRAL_RATE = 0.15;
const DEFAULT_FLAT_FEE_PER_UNIT = 4.95;
const RATE_SAMPLES = 3; // most recent settlements used for a SKU's referral rate
const LISTED_SAMPLES = 5; // ... for its listed price
const INCENTIVE_SAMPLES = 10; // ... for its incentive history

function skuKey(line) {
  return line.sku || line.upc || (line.title ? `title:${line.title}` : "unknown");
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds the fee/incentive model from settled order lines.
 *
 * @param {Array} settledLines - line items ({sku, upc, title, revenue,
 *   quantity, orderDate, purchaseOrderId}) whose orders have settled. Pass
 *   as much history as is available (not just the displayed range) - the
 *   per-SKU rules need each SKU's recent settlements.
 * @param {Object} reconByOrder - orderId -> {incentive, commissionFees,
 *   flatFees, refundAmount}, real Walmart settlement totals (from
 *   aggregateReconByOrder).
 */
export function buildFeeModel(settledLines, reconByOrder) {
  const linesByOrder = {};
  for (const line of settledLines) {
    const recon = line.purchaseOrderId && reconByOrder[line.purchaseOrderId];
    if (!recon) continue; // nothing real to learn from
    // A refunded order's settlement carries reversed commission/incentive
    // rows, which would teach the model a wrong rate for that SKU.
    if (recon.refundAmount) continue;
    (linesByOrder[line.purchaseOrderId] ||= []).push(line);
  }

  const samples = [];
  for (const [orderId, lines] of Object.entries(linesByOrder)) {
    const recon = reconByOrder[orderId];
    const orderRevenue = lines.reduce((s, l) => s + l.revenue, 0);
    const orderQuantity = lines.reduce((s, l) => s + (l.quantity || 1), 0);
    if (orderRevenue <= 0 || orderQuantity <= 0) continue;

    // Commission/incentive scale with price, so prorate them across lines
    // by revenue share; the flat WFS fee scales with units, so prorate it
    // by quantity share. Single-line orders (the norm) get exact values.
    for (const line of lines) {
      const quantity = line.quantity || 1;
      const revenueShare = line.revenue / orderRevenue;
      const incentive = Math.max(0, (recon.incentive || 0) * revenueShare);
      const listed = line.revenue + incentive;
      if (listed <= 0) continue;
      samples.push({
        sku: skuKey(line),
        date: line.orderDate || "",
        revenue: line.revenue,
        quantity,
        incentive,
        listedPerUnit: listed / quantity,
        referralRate: Math.abs(recon.commissionFees || 0) * revenueShare / listed,
        flatFeePerUnit: (Math.abs(recon.flatFees || 0) * (quantity / orderQuantity)) / quantity,
      });
    }
  }
  samples.sort((a, b) => a.date.localeCompare(b.date));

  const bySku = {};
  for (const s of samples) (bySku[s.sku] ||= []).push(s);

  // Account-level fallbacks for SKUs with no settled history, from the
  // most recent 60 days of settlements so they track current Walmart
  // promos rather than last year's.
  const latestDate = samples.length ? samples[samples.length - 1].date : "";
  const cutoff = latestDate ? shiftDate(latestDate, -60) : "";
  const recent = samples.filter((s) => s.date >= cutoff);
  const recentRevenue = recent.reduce((sum, s) => sum + s.revenue, 0);

  return {
    bySku,
    account: {
      referralRate: median(recent.map((s) => s.referralRate)) ?? DEFAULT_REFERRAL_RATE,
      flatFeePerUnit: median(recent.map((s) => s.flatFeePerUnit)) ?? DEFAULT_FLAT_FEE_PER_UNIT,
      incentiveRate: recentRevenue > 0 ? recent.reduce((sum, s) => sum + s.incentive, 0) / recentRevenue : 0,
    },
    trainedOnLines: samples.length,
    trainedOnRevenue: samples.reduce((sum, s) => sum + s.revenue, 0),
  };
}

function shiftDate(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Estimates fee/incentive for one pending line item from its SKU's recent
 * settlements, falling back to account-level figures for a SKU that has
 * never settled. Returns fees as a negative amount (same sign convention
 * as real settlement fees) and incentive as a positive one.
 */
export function estimateLine(line, model) {
  if (!model) return { estimatedFee: 0, estimatedIncentive: 0, estimationSource: "none" };

  const quantity = line.quantity || 1;
  const history = model.bySku[skuKey(line)] || [];

  let incentive;
  let referralRate;
  let flatFeePerUnit;
  let source;

  if (history.length) {
    const forIncentive = history.slice(-INCENTIVE_SAMPLES);
    const incentiveRevenue = forIncentive.reduce((s, h) => s + h.revenue, 0);
    const incentiveRate = incentiveRevenue > 0 ? forIncentive.reduce((s, h) => s + h.incentive, 0) / incentiveRevenue : 0;
    const recentlyIncentivised = forIncentive.some((h) => h.incentive > 0.005);
    const listedPerUnit = median(history.slice(-LISTED_SAMPLES).map((h) => h.listedPerUnit));
    const priceGap = recentlyIncentivised ? Math.max(0, listedPerUnit * quantity - line.revenue) : 0;
    incentive = 0.5 * priceGap + 0.5 * incentiveRate * line.revenue;

    referralRate = median(history.slice(-RATE_SAMPLES).map((h) => h.referralRate));
    flatFeePerUnit = history[history.length - 1].flatFeePerUnit;
    source = "sku";
  } else {
    incentive = model.account.incentiveRate * line.revenue;
    referralRate = model.account.referralRate;
    flatFeePerUnit = model.account.flatFeePerUnit;
    source = "accountAverage";
  }

  const listed = line.revenue + incentive;
  return {
    estimatedFee: -(referralRate * listed + flatFeePerUnit * quantity),
    estimatedIncentive: incentive,
    estimationSource: source,
  };
}
