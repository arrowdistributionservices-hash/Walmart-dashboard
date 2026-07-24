// Central registry of every client account this dashboard tracks.
//
// Each account maps to a Walmart Seller API credential pair stored in
// Vercel environment variables. Kyle keeps the original, un-suffixed
// variable names (WALMART_CLIENT_ID / WALMART_CLIENT_SECRET) so his
// existing setup keeps working untouched. Every other account uses a
// suffixed pair: WALMART_CLIENT_ID_<ENV_SUFFIX> / WALMART_CLIENT_SECRET_<ENV_SUFFIX>.
export const ACCOUNTS = [
  { id: "kyle", name: "Kyle", envSuffix: "", sheetName: "Kyle's Profit Analysis Sheet (Walmart)" },
  { id: "brian_shore", name: "Brian Shore", envSuffix: "BRIAN_SHORE", sheetName: "Brian's Profit Analysis Sheet (Walmart)" },
  { id: "kevin", name: "Kevin", envSuffix: "KEVIN", sheetName: "Kevin's Profit Analysis Sheet (Walmart)" },
  { id: "david_tinseth", name: "David Tinseth", envSuffix: "DAVID_TINSETH", sheetName: "David Tinseth's Profit Analysis Sheet (Walmart)" },
  { id: "laurie", name: "Laurie", envSuffix: "LAURIE", sheetName: "Laurie's Profit Analysis Sheet (Walmart)" },
  { id: "raul_leckie", name: "Raul Leckie", envSuffix: "RAUL_LECKIE", sheetName: "Raul's Profit Analysis Sheet (Walmart)" },
  { id: "saheel", name: "Saheel", envSuffix: "SAHEEL", sheetName: "Saheel's Profit Analysis Sheet (Walmart)" },
  { id: "bryan_hinostroza", name: "Bryan Hinostroza", envSuffix: "BRYAN_HINOSTROZA", sheetName: "Bryan's Profit Analysis sheet (Walmart)" },
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
