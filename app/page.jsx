"use client";

import { useState, useEffect, useCallback } from "react";

function fmt(n) {
  return `$${(n ?? 0).toFixed(2)}`;
}

function pct(n) {
  return `${(n ?? 0).toFixed(1)}%`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [startDate, setStartDate] = useState(daysAgoIso(21));
  const [endDate, setEndDate] = useState(todayIso());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [costUploading, setCostUploading] = useState(false);
  const [costUploadMsg, setCostUploadMsg] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/walmart-data?start=${startDate}&end=${endDate}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load data");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCostUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCostUploading(true);
    setCostUploadMsg(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-costsheet", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setCostUploadMsg(
        `Uploaded "${json.filename}" - ${json.entryCount} cost entries found. This is upload #${json.totalUploads}; ${json.totalTrackedItems} items are now tracked in total across all uploads. Upload more tabs any time - they add to this, they don't replace it.`
      );
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCostUploading(false);
      e.target.value = "";
    }
  }

  const totals = data?.totals;
  const totalMarginPct = totals && totals.netAfterFees !== 0 ? (totals.profit / totals.netAfterFees) * 100 : null;

  const coverage = data?.costCoverage;
  const coverageRevenueTotal = coverage ? coverage.matchedRevenue + coverage.unmatchedRevenue : 0;
  const coveragePct = coverage && coverageRevenueTotal !== 0 ? (coverage.matchedRevenue / coverageRevenueTotal) * 100 : null;

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Walmart Sales &amp; Profit</h1>
          <p>
            Live from the Walmart Marketplace API. Profit is calculated from item costs in the
            uploaded cost sheet, after Walmart's fees and commission.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <label className="upload-label">
            {costUploading ? "Uploading..." : "Upload Cost Sheet"}
            <input
              type="file"
              accept=".csv"
              onChange={handleCostUpload}
              disabled={costUploading}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </div>

      <div className="controls">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span style={{ color: "var(--text-dim)" }}>to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <button onClick={loadData} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh Walmart Data"}
        </button>
        {data?.costSheetMeta && (
          <span className="meta-note">
            Cost sheet: {data.costSheetMeta.totalUploads} file(s) uploaded so far (
            {data.costSheetMeta.uploadedFiles.join(", ")}) - last one "{data.costSheetMeta.filename}" on{" "}
            {new Date(data.costSheetMeta.uploadedAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {costUploadMsg && !error && (
        <div className="error-banner" style={{ borderColor: "var(--good)", color: "var(--good)", background: "rgba(55,199,119,0.1)" }}>
          {costUploadMsg}
        </div>
      )}

      {!data?.costSheetMeta && !loading && (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          No cost sheet uploaded yet - profit can't be calculated without item costs. Upload a cost
          sheet (Title / UPC / Walmart ID / BuyCost columns) using the button above. If your costs
          are spread across multiple Google Sheets tabs, export and upload each tab's CSV one at a
          time - each upload adds to the total, it won't erase earlier ones.
        </div>
      )}

      {coverage && !loading && coveragePct !== null && coveragePct < 90 && (
        <div className="empty-state" style={{ marginBottom: 24, borderColor: "var(--bad, #e5484d)" }}>
          Cost data only covers {pct(coveragePct)} of revenue in this range ({coverage.unmatchedLines} of{" "}
          {coverage.totalLines} order line items have no matching cost - {fmt(coverage.unmatchedRevenue)} in
          unmatched revenue). Profit figures below are understated until these are added to the cost sheet.
          {coverage.topUnmatchedSkus?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: "0.85em" }}>
              Top unmatched items:{" "}
              {coverage.topUnmatchedSkus
                .slice(0, 5)
                .map((s) => `${s.title || s.sku} (${fmt(s.revenue)})`)
                .join(", ")}
            </div>
          )}
        </div>
      )}

      {totals && (
        <div className="cards">
          <div className="card">
            <div className="label">Orders Revenue</div>
            <div className="value">{fmt(totals.ordersRev)}</div>
          </div>
          <div className="card">
            <div className="label">Incentives</div>
            <div className="value">{fmt(totals.incentive)}</div>
          </div>
          <div className="card">
            <div className="label">Walmart Total</div>
            <div className="value">{fmt(totals.walmartTotal)}</div>
          </div>
          <div className="card">
            <div className="label">Walmart Fees</div>
            <div className={`value ${totals.fees < 0 ? "bad" : "good"}`}>{fmt(totals.fees)}</div>
          </div>
          <div className="card">
            <div className="label">Net After Fees</div>
            <div className="value">{fmt(totals.netAfterFees)}</div>
          </div>
          <div className="card">
            <div className="label">Item Cost (COGS)</div>
            <div className="value">{fmt(totals.itemCost)}</div>
          </div>
          <div className="card">
            <div className="label">Profit (net of fees + COGS)</div>
            <div className={`value ${totals.profit < 0 ? "bad" : "good"}`}>{fmt(totals.profit)}</div>
          </div>
          <div className="card">
            <div className="label">Margin</div>
            <div className={`value ${(totalMarginPct ?? 0) < 0 ? "bad" : "good"}`}>
              {totalMarginPct !== null ? pct(totalMarginPct) : "-"}
            </div>
          </div>
        </div>
      )}

      <div className="section-title">Daily breakdown</div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Orders Rev</th>
              <th>Incentive</th>
              <th>Walmart Total</th>
              <th>Fees</th>
              <th>Net After Fees</th>
              <th>Item Cost</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {data?.daily?.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{fmt(d.ordersRev)}</td>
                <td>{fmt(d.incentive)}</td>
                <td>{fmt(d.walmartTotal)}</td>
                <td className={d.fees < 0 ? "bad" : ""}>{fmt(d.fees)}</td>
                <td>{fmt(d.netAfterFees)}</td>
                <td>{fmt(d.itemCost)}</td>
                <td className={d.profit < 0 ? "bad" : ""}>{fmt(d.profit)}</td>
              </tr>
            ))}
            {!data?.daily?.length && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--text-dim)" }}>
                  {loading ? "Loading..." : "No data for this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">
        Order-by-order
        <span className="meta-note">({data?.orderLevel?.length || 0} orders)</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Date</th>
              <th>Orders Rev</th>
              <th>Incentive</th>
              <th>Walmart Total</th>
              <th>Fees</th>
              <th>Net After Fees</th>
              <th>Item Cost</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {data?.orderLevel?.slice(0, 300).map((o) => (
              <tr key={o.orderId}>
                <td>{o.orderId}</td>
                <td>{o.date || "-"}</td>
                <td>{fmt(o.walmartOrdersRev)}</td>
                <td>{fmt(o.incentive)}</td>
                <td>{fmt(o.walmartTotal)}</td>
                <td className={o.fees < 0 ? "bad" : ""}>{fmt(o.fees)}</td>
                <td>{fmt(o.netAfterFees)}</td>
                <td>
                  {fmt(o.itemCost)}
                  {!o.costMatched && o.unmatchedLineItems > 0 && (
                    <span className="meta-note" style={{ marginLeft: 4 }}>
                      (partial)
                    </span>
                  )}
                </td>
                <td className={o.profit < 0 ? "bad" : ""}>{fmt(o.profit)}</td>
              </tr>
            ))}
            {!data?.orderLevel?.length && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--text-dim)" }}>
                  {loading ? "Loading..." : "No orders for this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data?.orderLevel?.length > 300 && (
          <p className="meta-note" style={{ marginTop: 8 }}>
            Showing first 300 of {data.orderLevel.length} orders. Narrow the date range to see fewer at once.
          </p>
        )}
      </div>
    </div>
  );
}

