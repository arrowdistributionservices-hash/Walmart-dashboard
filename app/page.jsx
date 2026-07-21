"use client";

import { useState, useEffect, useCallback } from "react";

function fmt(n) {
  return `$${(n ?? 0).toFixed(2)}`;
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
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [orderFilter, setOrderFilter] = useState("all");

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

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-csv", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setUploadMsg(`Uploaded "${json.filename}" — ${json.rowCount} rows parsed.`);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const totals = data?.totals;
  const totalDiffPct =
    totals && totals.sellerboardRev !== 0
      ? ((totals.walmartTotal - totals.sellerboardRev) / totals.sellerboardRev) * 100
      : null;

  const filteredOrders =
    data?.orderLevel?.filter((o) => (orderFilter === "all" ? true : o.presence === orderFilter)) || [];

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Walmart vs Sellerboard Reconciliation</h1>
          <p>
            Walmart data is live from the Marketplace API. Sellerboard data comes from the last CSV
            uploaded below.
          </p>
        </div>
        <label className="upload-label">
          {uploading ? "Uploading…" : "Upload Sellerboard CSV"}
          <input type="file" accept=".csv" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
        </label>
      </div>

      <div className="controls">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span style={{ color: "var(--text-dim)" }}>to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <button onClick={loadData} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh Walmart Data"}
        </button>
        {data?.sellerboardMeta && (
          <span className="meta-note">
            Sellerboard file: {data.sellerboardMeta.filename} (uploaded{" "}
            {new Date(data.sellerboardMeta.uploadedAt).toLocaleString()})
          </span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {uploadMsg && !error && <div className="error-banner" style={{ borderColor: "var(--good)", color: "var(--good)", background: "rgba(55,199,119,0.1)" }}>{uploadMsg}</div>}

      {!data?.sellerboardMeta && !loading && (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          No Sellerboard CSV uploaded yet — Walmart figures below are accurate, but there's nothing to
          compare them against. Upload a CSV using the button above.
        </div>
      )}

      {totals && (
        <div className="cards">
          <div className="card">
            <div className="label">Walmart Orders Revenue</div>
            <div className="value">{fmt(totals.ordersRev)}</div>
          </div>
          <div className="card">
            <div className="label">Walmart Incentives</div>
            <div className="value">{fmt(totals.incentive)}</div>
          </div>
          <div className="card">
            <div className="label">Walmart Total</div>
            <div className="value">{fmt(totals.walmartTotal)}</div>
          </div>
          <div className="card">
            <div className="label">Sellerboard Revenue</div>
            <div className="value">{fmt(totals.sellerboardRev)}</div>
          </div>
          <div className="card">
            <div className="label">Difference</div>
            <div className={`value ${Math.abs(totalDiffPct ?? 0) > 5 ? "bad" : "good"}`}>
              {fmt(totals.walmartTotal - totals.sellerboardRev)}
              {totalDiffPct !== null && ` (${totalDiffPct.toFixed(1)}%)`}
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
              <th>Sellerboard</th>
              <th>Diff</th>
            </tr>
          </thead>
          <tbody>
            {data?.daily?.map((d) => {
              const pct = d.sellerboardRev !== 0 ? (d.diff / d.sellerboardRev) * 100 : d.walmartTotal !== 0 ? 100 : 0;
              const flagged = Math.abs(pct) > 5;
              return (
                <tr key={d.date} className={flagged ? "flagged" : ""}>
                  <td>{d.date}</td>
                  <td>{fmt(d.ordersRev)}</td>
                  <td>{fmt(d.incentive)}</td>
                  <td>{fmt(d.walmartTotal)}</td>
                  <td>{fmt(d.sellerboardRev)}</td>
                  <td>{fmt(d.diff)}</td>
                </tr>
              );
            })}
            {!data?.daily?.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-dim)" }}>
                  {loading ? "Loading…" : "No data for this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">
        Order-by-order
        <span className="meta-note">({filteredOrders.length} orders)</span>
      </div>
      <div className="filter-row">
        {["all", "matched", "walmart_only", "sellerboard_only"].map((f) => (
          <button key={f} className={orderFilter === f ? "active" : ""} onClick={() => setOrderFilter(f)}>
            {f.replace("_", " ")}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Date</th>
              <th>Walmart Orders</th>
              <th>Incentive</th>
              <th>Walmart Total</th>
              <th>Sellerboard</th>
              <th>Diff</th>
              <th>Presence</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.slice(0, 300).map((o) => (
              <tr key={o.orderId} className={Math.abs(o.diff) > 0.01 ? "flagged" : ""}>
                <td>{o.orderId}</td>
                <td>{o.date || "—"}</td>
                <td>{fmt(o.walmartOrdersRev)}</td>
                <td>{fmt(o.incentive)}</td>
                <td>{fmt(o.walmartTotal)}</td>
                <td>{fmt(o.sellerboardRev)}</td>
                <td>{fmt(o.diff)}</td>
                <td>
                  <span className={`pill ${o.presence}`}>{o.presence.replace("_", " ")}</span>
                </td>
              </tr>
            ))}
            {!filteredOrders.length && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--text-dim)" }}>
                  {loading ? "Loading…" : "No orders match this filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredOrders.length > 300 && (
          <p className="meta-note" style={{ marginTop: 8 }}>
            Showing first 300 of {filteredOrders.length} orders. Narrow the date range to see fewer at once.
          </p>
        )}
      </div>
    </div>
  );
}
