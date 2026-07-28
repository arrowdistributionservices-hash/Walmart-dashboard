// Estimates fees and Walmart-funded incentives for order lines whose
// settlement data hasn't posted yet (see settledThroughDate / feesPending
// in computeAccountData.js). Walmart's Recon Report lags real orders by up
// to ~2 weeks, so the most recent stretch of every date range would
// otherwise show $0 fees/incentive - which understates how big a bite fees
// take and overstates provisional profit.
//
// Approach: learn a fee-rate and incentive-rate (as a fraction of item
// revenue) from orders that HAVE already settled, at three levels of
// granularity, then apply whichever level has enough samples to trust:
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

function toRates(agg) {
  if (!agg || agg.revenue <= 0) return null;
  return { ...agg, feeRate: agg.fee / agg.revenue, incentiveRate: agg.incentive / agg.revenue };
}

/**
 * Builds the fee/incentive rate model from settled order lines.
 *
 * @param {Array} settledLines - line items ({sku, title, revenue, quantity,
 *   purchaseOrderId}) whose orders are NOT in the pending/unsettled window.
 * @param {Object} reconByOrder - orderId -> {revenue, incentive, fees}, real
 *   Walmart settlement totals (from aggregateReconByOrder).
 */
export function buildFeeModel(settledLines, reconByOrder) {
  const linesByOrder = {};
  for (const line of settledLines) {
    if (!line.purchaseOrderId || !reconByOrder[line.purchaseOrderId]) continue; // nothing real to learn from
    (linesByOrder[line.purchaseOrderId] ||= []).push(line);
  }

  const skuAgg = {};
  const bucketAgg = {};
  const globalAgg = { fee: 0, incentive: 0, revenue: 0, count: 0 };

  for (const [orderId, lines] of Object.entries(linesByOrder)) {
    const recon = reconByOrder[orderId];
    const orderRevenue = lines.reduce((s, l) => s + l.revenue, 0);
    if (orderRevenue <= 0) continue;

    // An order's real fee/incentive total is per-order, not per-line, so we
    // prorate it across the order's lines by each line's share of revenue.
    // For the common single-item order this is exact; for multi-item orders
    // it's a reasonable proportional split.
    for (const line of lines) {
      const share = line.revenue / orderRevenue;
      const impliedFee = recon.fees * share;
      const impliedIncentive = recon.incentive * share;
      const unitPrice = line.revenue / (line.quantity || 1);
      const bucket = priceBucket(unitPrice);
      const sku = skuKey(line);

      skuAgg[sku] ||= { fee: 0, incentive: 0, revenue: 0, count: 0 };
      skuAgg[sku].fee += impliedFee;
      skuAgg[sku].incentive += impliedIncentive;
      skuAgg[sku].revenue += line.revenue;
      skuAgg[sku].count += 1;

      bucketAgg[bucket] ||= { fee: 0, incentive: 0, revenue: 0, count: 0 };
      bucketAgg[bucket].fee += impliedFee;
      bucketAgg[bucket].incentive += impliedIncentive;
      bucketAgg[bucket].revenue += line.revenue;
      bucketAgg[bucket].count += 1;

      globalAgg.fee += impliedFee;
      globalAgg.incentive += impliedIncentive;
      globalAgg.revenue += line.revenue;
      globalAgg.count += 1;
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

  return {
    estimatedFee: rates.feeRate * line.revenue,
    estimatedIncentive: rates.incentiveRate * line.revenue,
    estimationSource: source,
  };
}
