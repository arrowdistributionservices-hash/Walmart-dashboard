// Central registry of every client account this dashboard tracks.
//
// Each account maps to a Walmart Seller API credential pair stored in
// Vercel environment variables. Kyle keeps the original, un-suffixed
// variable names (WALMART_CLIENT_ID / WALMART_CLIENT_SECRET) so his
// existing setup keeps working untouched. Every other account uses a
// suffixed pair: WALMART_CLIENT_ID_<ENV_SUFFIX> / WALMART_CLIENT_SECRET_<ENV_SUFFIX>.
//
// `overageClient` is the client key in the Overage dashboard, which serves
// item costs (see lib/avgCosts.js), and `profitSheetId` is the Profit
// Analysis sheet those costs must come from. Both were checked against the
// sheet titles on 2026-10-04; Brian (Shore) and Bryan (Hinostroza) are
// different clients with different sheets.
export const ACCOUNTS = [
  { id: "kyle", name: "Kyle", envSuffix: "", sheetName: "Kyle's Profit Analysis Sheet (Walmart)",
    overageClient: "kyle", profitSheetId: "1hIy9JazWcqmz2aekuLGPAG6k-OfQOQNEIm0b3Wt0rGc" },
  { id: "brian_shore", name: "Brian Shore", envSuffix: "BRIAN_SHORE", sheetName: "Brian's Profit Analysis Sheet (Walmart)",
    overageClient: "brian", profitSheetId: "1Edore6UKF5hYTM0aTr2RSw_RfP9w7kqbJxL3EVlGiwY" },
  { id: "kevin", name: "Kevin", envSuffix: "KEVIN", sheetName: "Kevin's Profit Analysis Sheet (Walmart)",
    overageClient: "kevin", profitSheetId: "1R72VcwxNjHF1P9MEA3EJbjpH1SCw9UhKIBgKOBcNUaQ" },
  { id: "david_tinseth", name: "David Tinseth", envSuffix: "DAVID_TINSETH", sheetName: "David Tinseth's Profit Analysis Sheet (Walmart)",
    overageClient: "david-tinseth", profitSheetId: "1hk4S1YZUwUkZy5MbUDxT3VljiBCwrHn-85I2FZdgCNM" },
  { id: "laurie", name: "Laurie", envSuffix: "LAURIE", sheetName: "Laurie's Profit Analysis Sheet (Walmart)",
    overageClient: "laurie", profitSheetId: "10lQvpU38Ei3DTD0x_jTlYHbwdYF4TW8DoXQZA_8iaIg" },
  { id: "raul_leckie", name: "Raul Leckie", envSuffix: "RAUL_LECKIE", sheetName: "Raul's Profit Analysis Sheet (Walmart)",
    overageClient: "raul", profitSheetId: "1bl2BuXdnZxMVXI13HzSXGpLDBoRpN9jV6cUBdZa0KdQ" },
  { id: "saheel", name: "Saheel", envSuffix: "SAHEEL", sheetName: "Saheel's Profit Analysis Sheet (Walmart)",
    overageClient: "saheel", profitSheetId: "1F4D-J8hvUr67-qEEzR0uHqGu_3P7NmqCJrBH62VVx-Q" },
  { id: "bryan_hinostroza", name: "Bryan Hinostroza", envSuffix: "BRYAN_HINOSTROZA", sheetName: "Bryan's Profit Analysis sheet (Walmart)",
    overageClient: "bryan", profitSheetId: "1x1z5dz-SIxH3IgjE5cS99I0lflvWFftz6L5CdKDN800" },
];

export function getAccount(accountId) {
  const acct = ACCOUNTS.find((a) => a.id === accountId);
  if (!acct) throw new Error(`Unknown account "${accountId}".`);
  return acct;
}

/** Reads {clientId, clientSecret} for an account from env vars, plus whether both are present. */
export function getAccountCredentials(accountId) {
  const acct = getAccount(accountId);
  const suffix = acct.envSuffix ? `_${acct.envSuffix}` : "";
  const clientId = process.env[`WALMART_CLIENT_ID${suffix}`];
  const clientSecret = process.env[`WALMART_CLIENT_SECRET${suffix}`];
  return {
    clientId,
    clientSecret,
    configured: Boolean(clientId && clientSecret),
  };
}

/** All accounts, annotated with whether Walmart credentials are set up yet. */
export function listAccountsWithStatus() {
  return ACCOUNTS.map((acct) => ({
    ...acct,
    configured: getAccountCredentials(acct.id).configured,
  }));
}
