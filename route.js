# Walmart vs Sellerboard Reconciliation Dashboard

A live web dashboard: Walmart data is pulled fresh from the Marketplace API
every time someone opens or refreshes the page. Sellerboard data comes from
whatever CSV was most recently uploaded — everyone who opens the link sees
the same shared data.

## What it does

- Pulls live Walmart orders (SellerFulfilled + WFSFulfilled) and payments/
  settlement data (including markdown/incentive amounts) for a chosen date
  range.
- Lets anyone with the link upload a fresh Sellerboard CSV export, which is
  then shared with everyone else who opens the dashboard.
- Shows a daily summary and a full order-by-order reconciliation table,
  flagging mismatches and whether an order is missing from one side or the
  other.

## Deploying (one-time setup, ~15 minutes)

This needs to run on a hosting platform since it's a live service, not a
file you open locally. **Vercel** is recommended — free tier is enough for
this.

### 1. Create a Vercel account
Go to https://vercel.com and sign up (GitHub login is easiest).

### 2. Push this project to GitHub
- Create a new, empty GitHub repository (e.g. `walmart-dashboard`)
- Upload all the files in this folder to that repository (GitHub's web
  interface lets you drag-and-drop files if you don't use git directly —
  look for "Add file > Upload files" on the repo page)

### 3. Import the project into Vercel
- In Vercel, click **Add New > Project**
- Select the GitHub repository you just created
- Framework preset should auto-detect as **Next.js** — leave defaults as-is
- Don't click Deploy yet — first add the environment variables below

### 4. Add your Walmart credentials
In the Vercel project's **Environment Variables** section (still on the
import screen, or later under Project Settings > Environment Variables),
add:

| Name | Value |
|---|---|
| `WALMART_CLIENT_ID` | (same value from your `.env` file in the CLI tool) |
| `WALMART_CLIENT_SECRET` | (same value from your `.env` file in the CLI tool) |
| `WALMART_ENV` | `production` |

### 5. Attach a KV database (for shared CSV storage)
This is what lets the whole team see the same uploaded Sellerboard file.
- In your Vercel project, go to the **Storage** tab
- Click **Create Database > KV** (powered by Upstash Redis, free tier)
- Follow the prompts to create it and connect it to this project
- Vercel automatically adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN`
  environment variables for you — no manual copying needed

### 6. Deploy
Click **Deploy**. After a minute or two, Vercel gives you a live URL like
`https://walmart-dashboard-yourname.vercel.app` — that's the link to share
with your team.

## Using it day to day

- Anyone with the link can open it and see live Walmart numbers immediately.
- To update the Sellerboard side: export a fresh CSV from Sellerboard, then
  click **Upload Sellerboard CSV** on the dashboard. It updates for everyone
  within seconds — no redeploy needed.
- The date range at the top controls both sides of the comparison.

## Rotating credentials

If you ever need to change your Walmart API key (e.g. after rotating it in
Seller Center), update `WALMART_CLIENT_ID` / `WALMART_CLIENT_SECRET` in
Vercel's Environment Variables and redeploy (Vercel will prompt you, or
trigger it from the Deployments tab).

## Local development (optional)

If you want to test changes on your own machine before deploying:

```bash
npm install
cp .env.example .env.local
# fill in .env.local with real values
npm run dev
```

Then open http://localhost:3000. Note: local KV storage requires either a
local Redis instance or linking to your Vercel project's KV via `vercel env
pull` — for most purposes, testing directly on Vercel after deploying is
simpler.
