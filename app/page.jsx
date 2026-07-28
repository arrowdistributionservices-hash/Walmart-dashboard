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

  const [accounts, setAccounts] = useState([]); // [{id, name, configured}]
  const [activeAccount, setActiveAccount] = useState(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [allData, setAllData] = useState(null); // /api/walmart-data-all response
  const [allLoading, setAllLoading] = useState(false);

  const [costUploading, setCostUploading] = useState(false);
  const [costUploadMsg, setCostUploadMsg] = useState(null);

  const [orderSearch, setOrderSearch] = useState("");

  // Load the account list once, then default to the first one.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/accounts", { cache: "no-store" });
        const json = await res.json();
        setAccounts(json.accounts || []);
        if (json.accounts?.length) setActiveAccount(json.accounts[0].id);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  const loadData = useCallback(async () => {
    if (!activeAccount) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/walmart-data?account=${activeAccount}&start=${startDate}&end=${endDate}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load data");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeAccount, startDate, endDate]);

  const loadAllData = useCallback(async () => {
    setAllLoading(true);
    try {
      const res = await fetch(`/api/walmart-data-all?start=${startDate}&end=${endDate}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok) setAllData(json);
    } catch {
      // Global tile just stays empty on failure - the per-account view still works.
    } finally {
      setAllLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  async function handleCostUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCostUploading(true);
    setCostUploadMsg(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("account", activeAccount);
      const res = await fetch("/api/upload-costsheet", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setCostUploadMsg(
        `Uploaded "${json.filename}" - ${json.entryCount} cost entries found. This is upload #${json.totalUploads}; ${json.totalTrackedItems} items are now tracked in total across all uploads. Upload more tabs any time - they add to this, they don't replace it.`
      );
      await loadData();
      await loadAllData();
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

  const activeAccountMeta = accounts.find((a) => a.id === activeAccount);

  const orderSearchNormalized = orderSearch.trim().toLowerCase();
  const filteredOrderLevel = !orderSearchNormalized
    ? data?.orderLevel
    : data?.orderLevel?.filter((o) => {
        if (o.orderId && String(o.orderId).toLowerCase().includes(orderSearchNormalized)) return true;
        if (o.itemTitle && o.itemTitle.toLowerCase().includes(orderSearchNormalized)) return true;
        const amountFields = [o.walmartOrdersRev, o.incentive, o.fees, o.walmartTotal, o.netAfterFees, o.itemCost, o.profit];
        return amountFields.some((amt) => {
          if (amt === undefined || amt === null) return false;
          const plain = Math.abs(amt).toFixed(2);
          const withDollar = fmt(amt).toLowerCase();
          return plain.includes(orderSearchNormalized) || withDollar.includes(orderSearchNormalized);
        });
      });

  return (
    <div className="page">
      <div className="header">
        <div>
          <h1>Walmart Sales &amp; Profit</h1>
          <p>
            Live from the Walmart Marketplace API. Profit is calculated from item costs in the
            uploaded cost sheet, after Walmart's fees and commission.
          </p>
          {data?.settledThroughDate !== undefined && (
            <p className="meta-note" style={{ marginTop: 4 }}>
              Note: Walmart publishes fee/commission data roughly every 2 weeks.
              {data?.settledThroughDate
                ? ` Fee data is settled through ${data.settledThroughDate} - rows/orders marked with * are
                after that; their fees/incentives are estimated from historical per-SKU and per-price-point trends
                until Walmart's real numbers post.`
                : " Rows/orders marked with * have fee data that isn't published yet - fees/incentives shown are estimated from historical trends, not final."}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label className="upload-label">
            {costUploading ? "Uploading..." : "Upload Cost Sheet"}
            <input
              type="file"
              accept=".csv"
              onChange={handleCostUpload}
              disabled={costUploading || !activeAccount}
              style={{ display: "none" }}
            />
          </label>
        </div>
      </div>

      {/* --- Global overview: total across every account --- */}
      <div className="section-title">
        Global Overview
        {allLoading && <span className="meta-note">refreshing...</span>}
      </div>
      <div className="cards" style={{ marginBottom: 8 }}>
        <div className="card" style={{ gridColumn: "span 2", borderColor: "var(--accent)" }}>
          <div className="label">Total Profit - All Accounts</div>
          <div className={`value ${(allData?.grandTotals?.profit ?? 0) < 0 ? "bad" : "good"}`} style={{ fontSize: 28 }}>
            {allData ? fmt(allData.grandTotals.profit) : "-"}
          </div>
        </div>
        <div className="card">
          <div className="label">Total Revenue - All Accounts</div>
          <div className="value">{allData ? fmt(allData.grandTotals.walmartTotal) : "-"}</div>
        </div>
        <div className="card">
          <div className="label">Total Item Cost - All Accounts</div>
          <div className="value">{allData ? fmt(allData.grandTotals.itemCost) : "-"}</div>
        </div>
      </div>

      {/* --- Account selector, one tile per client, doubles as net-profit-per-client view --- */}
      <div className="account-grid">
        {accounts.map((acct) => {
          const acctData = allData?.accounts?.find((a) => a.accountId === acct.id);
          const profit = acctData?.totals?.profit;
          return (
            <button
              key={acct.id}
              className={`account-tile ${activeAccount === acct.id ? "active" : ""} ${!acct.configured ? "not-configured" : ""}`}
              onClick={() => {
                setActiveAccount(acct.id);
                setOrderSearch("");
              }}
              title={!acct.configured ? "Walmart API credentials not yet added for this account" : ""}
            >
              <div className="account-tile-name">{acct.name}</div>
              {!acct.configured ? (
                <div className="account-tile-status">Not connected</div>
              ) : (
                <div className={`account-tile-profit ${profit < 0 ? "bad" : "good"}`}>
                  {profit !== undefined && profit !== null ? fmt(profit) : "..."}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="section-title" style={{ marginTop: 32 }}>
        {activeAccountMeta?.name || "Account"} - Detail
      </div>

      <div className="controls">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span style={{ color: "var(--text-dim)" }}>to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <button onClick={loadData} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh Walmart Data"}
        </button>

        <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />

        <a className="secondary-link" href={`/api/export?account=${activeAccount}&format=csv&start=${startDate}&end=${endDate}`}>
          Download CSV
        </a>
        <a className="secondary-link" href={`/api/export?account=${activeAccount}&format=xlsx&start=${startDate}&end=${endDate}`}>
          Download Excel
        </a>
        <a className="secondary-link" href={`/api/export?account=all&format=csv&start=${startDate}&end=${endDate}`}>
          Download CSV (all accounts)
        </a>
        <a className="secondary-link" href={`/api/export?account=all&format=xlsx&start=${startDate}&end=${endDate}`}>
          Download Excel (all accounts)
        </a>

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

      {activeAccountMeta && !activeAccountMeta.configured && (
        <div className="empty-state" style={{ marginBottom: 24, borderColor: "var(--warn)" }}>
          {activeAccountMeta.name}'s Walmart API credentials haven't been added to Vercel yet. Add
          them as environment variables, then refresh.
        </div>
      )}

      {!data?.costSheetMeta && !loading && activeAccountMeta?.configured && (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          No cost sheet uploaded yet for {activeAccountMeta?.name} - profit can't be calculated
          without item costs. Upload a cost sheet (Title / UPC / Walmart ID / BuyCost columns)
          using the button above. If your costs are spread across multiple Google Sheets tabs,
          export and upload each tab's CSV one at a time - each upload adds to the total, it won't
          erase earlier ones.
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
            <div className="label">Net Profit</div>
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
              <tr key={d.date} className={d.feesPending ? "pending-row" : ""}>
                <td>{d.date}</td>
                <td>{fmt(d.ordersRev)}</td>
                <td>{fmt(d.incentive)}</td>
                <td>{fmt(d.walmartTotal)}</td>
                <td className={d.fees < 0 ? "bad" : ""}>
                  {fmt(d.fees)}
                  {d.feesPending && <span title="Estimated from historical trends - not yet settled by Walmart">*</span>}
                </td>
                <td>{fmt(d.netAfterFees)}</td>
                <td>{fmt(d.itemCost)}</td>
                <td className={d.profit < 0 ? "bad" : ""}>
                  {fmt(d.profit)}
                  {d.feesPending && <span title="Provisional - based on estimated fees, not yet settled">*</span>}
                </td>
              </tr>
            ))}
            {!data?.daily?.length && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--text-dim)" }}>
                  {loading ? "Loading..." : "No data for this range."}
                </td>
              </tr>
            )}
            {data?.daily?.some((d) => d.feesPending) && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--text-dim)", fontSize: "0.85em" }}>
                  * Fees not yet published by Walmart for this day - shown values are estimated from historical per-SKU/price
                  trends and will be replaced once settled.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">
        Order-by-order
        <span className="meta-note">
          ({filteredOrderLevel?.length || 0}{orderSearchNormalized ? ` of ${data?.orderLevel?.length || 0}` : ""} orders)
        </span>
      </div>
      <div className="controls" style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Search by Order ID, item name, or amount (e.g. 45.20)"
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
          style={{
            flex: "1 1 320px",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            padding: "8px 10px",
            borderRadius: 6,
            fontSize: 13,
          }}
        />
        {orderSearch && (
          <button className="secondary" onClick={() => setOrderSearch("")}>
            Clear
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Item</th>
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
            {filteredOrderLevel?.slice(0, 300).map((o) => (
              <tr key={o.orderId} className={o.feesPending ? "pending-row" : ""}>
                <td>{o.orderId}</td>
                <td
                  style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={o.items?.map((it) => `${it.quantity > 1 ? `${it.quantity}x ` : ""}${it.title || it.sku || "(unknown item)"} @ ${fmt(it.unitPrice)}`).join("\n") || ""}
                >
                  {o.itemTitle || <span className="meta-note">(no line items)</span>}
                </td>
                <td>{o.date || "-"}</td>
                <td>{fmt(o.walmartOrdersRev)}</td>
                <td>{fmt(o.incentive)}</td>
                <td>{fmt(o.walmartTotal)}</td>
                <td className={o.fees < 0 ? "bad" : ""}>
                  {fmt(o.fees)}
                  {o.feesPending && <span title="Estimated from historical trends - not yet settled by Walmart">*</span>}
                </td>
                <td>{fmt(o.netAfterFees)}</td>
                <td>
                  {fmt(o.itemCost)}
                  {!o.costMatched && o.unmatchedLineItems > 0 && (
                    <span className="meta-note" style={{ marginLeft: 4 }}>
                      (partial)
                    </span>
                  )}
                </td>
                <td className={o.profit < 0 ? "bad" : ""}>
                  {fmt(o.profit)}
                  {o.feesPending && <span title="Provisional - based on estimated fees, not yet settled">*</span>}
                </td>
              </tr>
            ))}
            {!filteredOrderLevel?.length && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "var(--text-dim)" }}>
                  {loading
                    ? "Loading..."
                    : orderSearchNormalized
                    ? `No orders match "${orderSearch}".`
                    : "No orders for this range."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filteredOrderLevel?.length > 300 && (
          <p className="meta-note" style={{ marginTop: 8 }}>
            Showing first 300 of {filteredOrderLevel.length} orders. Narrow the date range or search to see fewer at once.
          </p>
        )}
      </div>
    </div>
  );
}
