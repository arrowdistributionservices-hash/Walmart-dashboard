:root {
  --bg: #0b0f14;
  --panel: #131a22;
  --panel-2: #182029;
  --border: #253039;
  --text: #e7edf3;
  --text-dim: #93a3b1;
  --accent: #4fc3f7;
  --good: #37c777;
  --bad: #ff6b6b;
  --warn: #ffb84f;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 24px 80px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 22px;
  margin: 0 0 4px;
}

.header p {
  margin: 0;
  color: var(--text-dim);
  font-size: 14px;
}

.controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 20px;
}

.controls input[type="date"] {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}

button {
  background: var(--accent);
  color: #04141c;
  border: none;
  padding: 9px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

button.secondary {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
}

.upload-label {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 9px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  display: inline-block;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 28px;
}

.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.card .label {
  color: var(--text-dim);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.card .value {
  font-size: 22px;
  font-weight: 700;
}

.card .value.good { color: var(--good); }
.card .value.bad { color: var(--bad); }

.section-title {
  font-size: 15px;
  font-weight: 600;
  margin: 28px 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta-note {
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 400;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
}

th, td {
  padding: 9px 12px;
  text-align: right;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

th:first-child, td:first-child {
  text-align: left;
}

th {
  background: var(--panel-2);
  color: var(--text-dim);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

tr:last-child td {
  border-bottom: none;
}

tr.flagged td {
  background: rgba(255, 107, 107, 0.08);
}

.pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.pill.matched { background: rgba(147, 163, 177, 0.15); color: var(--text-dim); }
.pill.walmart_only { background: rgba(255, 184, 79, 0.15); color: var(--warn); }
.pill.sellerboard_only { background: rgba(255, 107, 107, 0.15); color: var(--bad); }

.filter-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.filter-row button {
  background: var(--panel-2);
  color: var(--text-dim);
  border: 1px solid var(--border);
  padding: 6px 12px;
  font-weight: 500;
}

.filter-row button.active {
  background: var(--accent);
  color: #04141c;
  border-color: var(--accent);
}

.empty-state {
  color: var(--text-dim);
  font-size: 13px;
  padding: 24px;
  text-align: center;
  background: var(--panel);
  border: 1px dashed var(--border);
  border-radius: 10px;
}

.error-banner {
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid var(--bad);
  color: var(--bad);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 20px;
}

.table-scroll {
  overflow-x: auto;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
