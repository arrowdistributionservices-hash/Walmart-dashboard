import { NextResponse } from "next/server";
import { getAccountCredentials } from "../../../lib/accounts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Probe route only - tries several candidate Walmart Fulfillment Services
// API paths for inbound shipments / WFS inventory against a real account,
// and reports back status + a snippet of each response, so the correct
// endpoint/shape can be confirmed before building the real feature on top
// of a guess. Not wired into any UI.
const BASE_URLS = {
  sandbox: "https://sandbox.walmartapis.com",
  production: "https://marketplace.walmartapis.com",
};

const CANDIDATE_PATHS = [
  "/v3/fulfillment/inbound-shipment",
  "/v3/fulfillment/inbound-shipments",
  "/v3/fulfillment/inventory",
  "/v3/fulfillment/inbound/shipments",
  "/v3/inventory",
  "/v3/inventories",
  "/v3/fulfillment/dsvinventory",
];

async function getAccessToken(clientId, clientSecret, baseUrl) {
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
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account") || "kyle";

  const { clientId, clientSecret, configured } = getAccountCredentials(accountId);
  if (!configured) {
    return NextResponse.json({ error: `Account "${accountId}" not configured` }, { status: 400 });
  }

  const env = process.env.WALMART_ENV || "production";
  const baseUrl = BASE_URLS[env];

  let token;
  try {
    token = await getAccessToken(clientId, clientSecret, baseUrl);
  } catch (e) {
    return NextResponse.json({ error: "token fetch failed", detail: String(e) }, { status: 502 });
  }

  const results = [];
  for (const path of CANDIDATE_PATHS) {
    try {
      const url = `${baseUrl}${path}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "WM_SVC.NAME": "Walmart Marketplace",
          "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
          "WM_SEC.ACCESS_TOKEN": token,
          Accept: "application/json",
        },
      });
      const text = await res.text();
      results.push({
        path,
        status: res.status,
        ok: res.ok,
        bodySnippet: text.slice(0, 800),
      });
    } catch (e) {
      results.push({ path, error: String(e) });
    }
  }

  // Probe: does a real inbound shipment have a per-SKU item breakdown? Grab a
  // real shipmentId from the list above and test candidate item-detail paths
  // against it, so we know whether "Inbound to WFS" dollar value is even
  // computable before building anything on top of a guess.
  const shipmentListResult = results.find((r) => r.path === "/v3/fulfillment/inbound-shipments" && r.ok);
  let itemDetailResults = null;
  if (shipmentListResult) {
    try {
      const fullRes = await fetch(`${baseUrl}/v3/fulfillment/inbound-shipments`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "WM_SVC.NAME": "Walmart Marketplace",
          "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
          "WM_SEC.ACCESS_TOKEN": token,
          Accept: "application/json",
        },
      });
      const fullData = await fullRes.json();
      const list = fullData?.payload?.shipments || fullData?.payload || [];
      const sample = Array.isArray(list) ? list.find((s) => s.shipmentId) : null;
      if (sample?.shipmentId) {
        const itemCandidatePaths = [
          `/v3/fulfillment/inbound-shipments/${sample.shipmentId}/items`,
          `/v3/fulfillment/inbound-shipment/${sample.shipmentId}/items`,
          `/v3/fulfillment/inbound-shipments/${sample.shipmentId}`,
        ];
        itemDetailResults = { sampleShipmentId: sample.shipmentId, tests: [] };
        for (const p of itemCandidatePaths) {
          try {
            const r = await fetch(`${baseUrl}${p}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                "WM_SVC.NAME": "Walmart Marketplace",
                "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
                "WM_SEC.ACCESS_TOKEN": token,
                Accept: "application/json",
              },
            });
            const t = await r.text();
            itemDetailResults.tests.push({ path: p, status: r.status, ok: r.ok, bodySnippet: t.slice(0, 1000) });
          } catch (e) {
            itemDetailResults.tests.push({ path: p, error: String(e) });
          }
        }
      }
    } catch (e) {
      itemDetailResults = { error: String(e) };
    }
  }

  return NextResponse.json({ accountId, env, baseUrl, results, itemDetailResults });
}
