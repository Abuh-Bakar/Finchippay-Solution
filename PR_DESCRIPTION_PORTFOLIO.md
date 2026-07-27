## PR Title
feat(portfolio): Add interactive token portfolio dashboard with price charts (#362)

## PR Description

### Summary
Implements issue #362: a new `/portfolio` page showing total portfolio value, per-token 24h change, an allocation donut chart, per-token price history (7d/30d/90d), and the ability to add custom tokens by Soroban contract ID. Adds a new cached backend endpoint to serve that price history.

### Problem
Users could only see individual token balances (`TokenCard.tsx`) with no consolidated view of total holdings, allocation, or price performance — `AnalyticsCharts.tsx` covers transaction analytics but not portfolio-level data.

### Solution

#### Backend
- **`backend/src/services/tokenPriceService.js`** (NEW) — maps known assets (native XLM, USDC) to their Soroban contract IDs (via `Asset.contractId()`) and to CoinGecko ids; fetches price history from CoinGecko's `market_chart` endpoint; caches results for 5 minutes via the existing shared `cacheService.js`. Contract IDs with no known price source return an empty `prices` array instead of erroring.
- **`backend/src/routes/tokens.js`** (NEW) — `GET /api/v1/tokens/:contractId/price-history?range=7d|30d|90d`, Zod-validated, registered in `server.js`.
- **`backend/src/validation/schemas.js`** — added `tokenContractIdParamSchema`, `tokenPriceHistoryQuerySchema`.

> Note: every other backend route mounts at `/api/<name>` (no `v1`); this endpoint follows the issue's literal spec (`/api/v1/tokens/...`) instead, so it's the one inconsistent route in the API today.

#### Frontend
- **`lib/portfolio.ts`** (NEW) — `getPortfolioHoldings()` (wraps `getBalances()`, derives each holding's contract ID), custom-token and fiat-currency preferences (`localStorage`, mirrors `lib/addressBook.ts`'s pattern), `fetchTokenPrices()` (one CoinGecko call covering USD/EUR/GBP + 24h change).
- **`components/PortfolioOverview.tsx`** (NEW) — total value, 24h change (green/red), per-token rows.
- **`components/PortfolioAllocation.tsx`** (NEW) — donut chart (recharts), clickable legend that filters the price chart.
- **`components/TokenPriceChart.tsx`** (NEW) — line chart with a 7d/30d/90d range selector, fetches from the new backend endpoint.
- **`pages/portfolio.tsx`** — this page already existed as a scaffold behind the `new_portfolio` feature flag (issue #103, 0% rollout), showing a "Coming Soon" fallback. Replaced the placeholder content inside the existing `<FeatureGate>` with the real implementation; kept the fallback intact. Added a "connect your wallet" state (was missing — previously showed a misleading empty-holdings message when disconnected).
- **`components/Navbar.tsx`** — added a "Portfolio" link.
- i18n: new `portfolio.*` keys (and `nav.portfolio`) in all 5 locales (en/es/fr/ar/he).
- Chart tooltips (`PortfolioAllocation`, `TokenPriceChart`) styled with the app's existing `--color-surface`/`--color-text`/`--color-border` CSS variables so they respect dark/light mode (recharts' default tooltip is a fixed white box).

### Files Changed
```
backend/
├── src/routes/tokens.js                      (NEW)
├── src/services/tokenPriceService.js          (NEW)
├── src/validation/schemas.js
├── src/server.js
└── __tests__/tokens.test.js                   (NEW)

frontend/
├── pages/portfolio.tsx
├── components/PortfolioOverview.tsx           (NEW)
├── components/PortfolioAllocation.tsx         (NEW)
├── components/TokenPriceChart.tsx             (NEW)
├── components/Navbar.tsx
├── lib/portfolio.ts                           (NEW)
├── public/locales/{en,es,fr,ar,he}/common.json
├── e2e/portfolio.spec.ts                      (NEW)
└── __tests__/{portfolio,PortfolioOverview,PortfolioAllocation,TokenPriceChart}.test.{ts,tsx}  (NEW)
```

### Related fixes (pre-existing bugs found while building/testing this feature)
These were blocking either the build or manual testing of this feature and were fixed as isolated, minimal changes — none are part of issue #362's scope:

1. **`frontend/lib/stellar.ts`** — `CreatorTipsDashboard.tsx` imported `getContractTipCount`, which didn't exist (the underlying contract client method `getTipCount()` did; only the wrapper was missing, same pattern as the existing `getContractTipTotal`). Was breaking `npm run build` for the whole app.
2. **`frontend/pages/settings.tsx`** — duplicate import of `signTransactionWithWallet` from `@/lib/wallet`, breaking compilation of `/settings`.
3. **`backend/src/server.js`** — CORS `allowedHeaders` didn't include `traceparent`/`tracestate` (W3C Trace Context headers the frontend's OpenTelemetry instrumentation attaches to every `fetch()`), blocking `/api/features` and very likely the original SEP-10 auth flow in the browser.

### Known limitations / out of scope
- **Custom tokens have no price source.** Adding a token by contract ID that isn't one of the known assets (XLM, USDC) shows "Price unavailable" — there's no way in this codebase to resolve an arbitrary Soroban contract to a price feed. Documented as a decision during planning, not a bug.
- **Custom token metadata isn't resolved.** Added tokens display a truncated contract ID rather than a symbol/name (no SEP-41 `symbol()` RPC lookup in this pass).
- **`npm run build` still fails** for the repo as a whole, due to a chain of ~75 pre-existing TypeScript errors unrelated to this PR (e.g. `components/HighlightedTransactionRow.tsx`). This PR's own files type-check and lint cleanly, but the full build — and therefore the E2E CI job, which serves a production build — cannot currently complete. Not addressed here; out of scope.
- **`npm run i18n:check` cannot run locally** — `i18next-scanner` was never added as a dependency despite the script referencing it (pre-existing gap, unrelated). Locale JSON was validated manually (`JSON.parse` on all 5 files).
- Found but **not fixed**: `components/RecurringPayments.tsx` calls a nonexistent `listStreamsByPayer` (needs a real implementation, not a one-line fix — only affects `/dashboard`, not this feature).

### Testing
- **Backend**: `backend/__tests__/tokens.test.js` — 7/7 passing (valid/invalid range, unknown contract ID, caching, provider failure).
- **Frontend unit**: `portfolio.test.ts`, `PortfolioOverview.test.tsx`, `PortfolioAllocation.test.tsx`, `TokenPriceChart.test.tsx` — 27/27 passing.
- **Frontend E2E**: `e2e/portfolio.spec.ts` — 4/4 passing locally (not-connected prompt, overview/allocation/chart render, invalid contract ID rejected, custom token added). Verified stable across 3 consecutive runs.
- **Manual**: full flow verified in-browser against a funded Stellar testnet account (Freighter) — real Horizon balance, real CoinGecko price data, working range selector and currency switcher, donut → price-chart selection.
- `type-check` and `lint` clean on every file touched in this PR.
- Full existing Jest suite run: 431/473 passing; the 42 pre-existing failures were confirmed (via `git stash`) to already fail on `master` before this branch, unrelated to this change.

### Notes
- The E2E test uncovered a pre-existing, app-wide dev-mode hydration warning (also reproducible on `master` via the existing `wallet-connect.spec.ts`) that renders a `next dev`-only error overlay capable of intercepting clicks. Not fixed here (out of scope, doesn't affect production builds); the new E2E test works around it defensively.
