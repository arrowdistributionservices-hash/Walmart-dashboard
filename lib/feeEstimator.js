// Estimates fees and Walmart-funded incentives for order lines whose
// settlement data hasn't posted yet (see settledThroughDate / feesPending
// in computeAccountData.js). Walmart's Recon Report lags real orders by up
// to ~2 weeks, so the most recent stretch of every date range would
// otherwise show $0 fees/incentive - which understates how big a bite fees
// take and overstates provisional profit.
//
// Fees are modeled as TWO separate components rather than one blended rate,
// because they behave differently as price changes (confirmed via a live
// diagnostic against real settlement rows):
//  - COMMISSION: a percentage of item price (e.g. ~13.5% for Toys & Games)
//    - scales with revenue, so it's learned and applied as a rate.
//  - FLAT FEE: WFS fulfillment fees, driven by package weight/size tier,
//    not price (e.g. a flat $5.75 "WFS Fulfillment fee" line item that
//    doesn't change whether the item sells for $12 or $25) - learned and
//    applied as a $-per-unit amount instead of a rate. Modeling this as a
//    percentage of revenue would badly overstate fees on any unit priced
//    above the SKU's typical average and understate them below it.
//
// Both components (plus incentive, still modeled as a revenue rate - it's
// typically a promo/savings amount that does scale with price) are learned
// from orders that HAVE already settled, at three levels of granularity,
// then applied at whichever level has enough samples to trust:
//   1. Per-SKU        - most specific, used when a SKU has enough settled history
//   2. Per price band - falls back to "how do items around this price point
//                        usually get charged" when a SKU is new/thin
//   3. Account-wide    - last-resort average across every settled line
//
// Every estimate is tagged with its source so callers can expose that if
// useful; the caller (computeAccountData.js) already marks anything in the
// unsettled window with a "*" via feesPending, so estimates inherit that
// same provisional marker instead of showing as a bare $0.

const PRICE_BUCKET_EDGES = [0, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, Infinity];

// Minimum settled samples required before trusting a level of the model.
// Below these thresholds we fall back to the next broader level - a rate
// learned from 1-2 orders is noise, not a trend.
const SKU_MIN_SAMPLES = 3;
const SKU_MIN_REVENUE = 15; // guards against a couple of near-free lines producing a wild rate
const BUCKET_MIN_SAMPLES = 5;

export function priceBucket(unitPrice) {
  for (let i = 0; i < PRICE_BUCKET_EDGES.length - 1; i++) {
    if (unitPrice >= PRICE_BUCKET_EDGES[i] && unitPrice < PRICE_BUCKET_EDGES[i + 1]) {
      const hi = PRICE_BUCKET_EDGES[i + 1];
      return `$${PRICE_BUCKET_EDGES[i]}-${hi === Infinity ? "up" : hi}`;
    }
  }
  return "unknown";
}

function skuKey(line) {
  return line.sku || (line.title ? `title:${line.title}` : "unknown");
}

function newAgg() {
  return { commission: 0, flatFee: 0, incentive: 0, revenue: 0, quantity: 0, count: 0 };
}

function toRates(agg) {
  if (!agg || agg.revenue <= 0 || agg.quantity <= 0) return null;
  return {
    ...agg,
    commissionRate: agg.commission / agg.revenue,
    flatFeePerUnit: agg.flatFee / agg.quantity,
    incentiveRate: agg.incentive / agg.revenue,
  };
}

/**
 * Builds the fee/incentive model from settled order lines.
 *
 * @param {Array} settledLines - line items ({sku, title, revenue, quantity,
 *   purchaseOrderId}) whose orders are NOT in the pending/unsettled window.
 * @param {Object} reconByOrder - orderId -> {revenue, incentive, fees,
 *   commissionFees, flatFees}, real Walmart settlement totals (from
 *   aggregateReconByOrder).
 */
export function buildFeeModel(settledLines, reconByOrder) {
  const linesByOrder = {};
  for (const line of settledLines) {
    if (!line.purchaseOrderId || !reconByOrder[line.purchaseOrderId]) continue; // nothing real to learn from
    (linesByOrder[line.purchaseOrderId] ||= []).push(line);
  }

  const skuAgg = {};
  const bucketAgg = {};
  const globalAgg = newAgg();

  for (const [orderId, lines] of Object.entries(linesByOrder)) {
    const recon = reconByOrder[orderId];
    const orderRevenue = lines.reduce((s, l) => s + l.revenue, 0);
    const orderQuantity = lines.reduce((s, l) => s + (l.quantity || 1), 0);
    if (orderRevenue <= 0 || orderQuantity <= 0) continue;

    // An order's real commission/incentive scales with price, so prorate it
    // across lines by revenue share. Its flat WFS fee scales with units
    // shipped, not price, so prorate that by quantity share instead. For
    // the common single-line order both give the same (exact) answer; for
    // multi-line orders each is proportioned the way that component
    // actually accrues.
    for (const line of lines) {
      const revenueShare = line.revenue / orderRevenue;
      const quantityShare = (line.quantity || 1) / orderQuantity;
      const impliedCommission = (recon.commissionFees ?? 0) * revenueShare;
      const impliedFlatFee = (recon.flatFees ?? 0) * quantityShare;
      const impliedIncentive = recon.incentive * revenueShare;
      const unitPrice = line.revenue / (line.quantity || 1);
      const bucket = priceBucket(unitPrice);
      const sku = skuKey(line);

      for (const agg of [(skuAgg[sku] ||= newAgg()), (bucketAgg[bucket] ||= newAgg()), globalAgg]) {
        agg.commission += impliedCommission;
        agg.flatFee += impliedFlatFee;
        agg.incentive += impliedIncentive;
        agg.revenue += line.revenue;
        agg.quantity += line.quantity || 1;
        agg.count += 1;
      }
    }
  }

  const skuModel = {};
  for (const [sku, agg] of Object.entries(skuAgg)) skuModel[sku] = toRates(agg);

  const bucketModel = {};
  for (const [bucket, agg] of Object.entries(bucketAgg)) bucketModel[bucket] = toRates(agg);

  return {
    skuModel,
    bucketModel,
    globalModel: toRates(globalAgg),
    trainedOnLines: globalAgg.count,
    trainedOnRevenue: globalAgg.revenue,
  };
}

/**
 * Estimates fee/incentive for one pending line item, walking
 * SKU -> price bucket -> account-wide average until it finds a level with
 * enough settled samples to trust.
 */
export function estimateLine(line, model) {
  if (!model) return { estimatedFee: 0, estimatedIncentive: 0, estimationSource: "none" };

  const sku = skuKey(line);
  const unitPrice = line.revenue / (line.quantity || 1);
  const bucket = priceBucket(unitPrice);

  const skuStats = model.skuModel[sku];
  const bucketStats = model.bucketModel[bucket];

  let rates = null;
  let source = "none";
  if (skuStats && skuStats.count >= SKU_MIN_SAMPLES && skuStats.revenue >= SKU_MIN_REVENUE) {
    rates = skuStats;
    source = "sku";
  } else if (bucketStats && bucketStats.count >= BUCKET_MIN_SAMPLES) {
    rates = bucketStats;
    source = "priceBucket";
  } else if (model.globalModel) {
    rates = model.globalModel;
    source = "accountAverage";
  }

  if (!rates) return { estimatedFee: 0, estimatedIncentive: 0, estimationSource: "none" };

  const quantity = line.quantity || 1;
  return {
    estimatedFee: rates.commissionRate * line.revenue + rates.flatFeePerUnit * quantity,
    estimatedIncentive: rates.incentiveRate * line.revenue,
    estimationSource: source,
  };
}
