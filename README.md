# SignalCore - Phase 1

A release interpreter for XAUUSD and USDJPY using deterministic, explainable macroeconomic rules. Experimental bias scores are logged for a forward test; this is analysis, not investment advice.

Run `npm test` for deterministic mechanics checks and `npm run example` for a JSON snapshot.

```
npm test                                     # build + deterministic core and workflow tests
npm run typecheck                            # src/ and scripts/
npm run format                               # prettier
npm run sample-data                          # synthetic smoke-test data in data/sample/
npm run backtest                             # reads data/, writes output/backtest-results.json
npm run backtest -- --data data/sample       # same, against the synthetic set
npm run prepare-prices                       # validate data/real/raw and write data/real/prices/
npm run fetch-fred-prices                    # optional public FRED market-series CSV download
npm run backtest -- --data data/real         # real-data run after adding events and required prices
FRED_API_KEY=... npm run fetch-fred          # revised actuals -> data/fred-actuals.csv
```

See [docs/data-guide.md](docs/data-guide.md) for the Phase 0 backtest formats and data criteria. Phase 1 seeds the app from the supplied event and price CSV files in `data/real/`.

## Design

`EconomicEvent → surprise → configurable event/factor rules → exponential decay → factor aggregation → regime and instrument bias`.

The engine takes only normalized `EconomicEvent` inputs. A future provider adapter must normalize data before calling `process`; the core has no API, persistence, scraping, UI, or clock dependency. `replay()` orders events by release timestamp and snapshots only after each event, preventing look-ahead from later releases. Optional observed subsequent movement is recorded but never read by calculations.

`rules.ts` is the knowledge layer. For each rule it exposes relationship text, affected factor/instrument, initial weight/confidence, half-life (through the indicator rule), regime-dependence, uncertainty, and invalidation hypothesis. These are initial hypotheses requiring versioned historical calibration—not facts or forecasts.

## Calculation assumptions

For numeric data, raw surprise is `actual - forecast`; normalized surprise is `clamp(raw / normalizationScale, -1, 1)`. The editable scale is a meaningful unit-specific surprise (for example, 0.2 percentage points for CPI), not an unsupported cross-provider z-score. Directional surprise multiplies that result by the indicator’s semantic direction, so a lower unemployment result is positive labor pressure. A structured policy signal is compared against structured expected stance. Qualitative classification must occur upstream; no LLM is a numerical decision maker.

Effective impact is `initialImpact × 0.5^(ageHours / halfLifeHours)`. Individual contributions are preserved.

Factor **strength** is a magnitude: `clamp(|sum of decayed contributions|, 0, 1)`. Surprise size and age both move it, so a single stale release fades toward zero. Factor **agreement** (`|net| / Σ|contributions|`) measures only how consistent the evidence is, and is folded into **confidence** — it is not a strength. The same split applies at instrument level: `netScore` is the signed magnitude that the direction threshold is applied to, and `agreement` is the consistency ratio. Thresholds live in `src/config.ts` (`BIAS_DIRECTION_THRESHOLD`, `REGIME_MIXED_THRESHOLD`), not scattered as literals.

Regime dimensions remain independent; the engine never forces one single regime.

`SAFE_HAVEN_PRESSURE` is currently disabled (see the `TODO(safe-haven)` notes in `rules.ts`). No input feeds it, so it scored a constant zero while still diluting every gold/yen bias and forcing `regime.mixed` true on every snapshot. The type is retained for when a real risk input exists.

Inflation-to-policy/real-yield/USD and factor-to-instrument paths are indirect and regime dependent. Gold can respond to safe-haven demand, real yields, and USD simultaneously; USDJPY also materially depends on BOJ policy and risk dynamics, which are outside the initial input scope. The output therefore describes rule-consistent fundamental pressure, never certain causality or a trade recommendation.

## Files

- `src/models.ts`: typed domain contract
- `src/rules.ts`: editable assumptions
- `src/config.ts`: direction and regime thresholds
- `src/surprise.ts`, `src/decay.ts`: reusable calculations
- `src/engine.ts`: explainable aggregation/bias
- `src/backtest.ts`: chronological replay
- `src/daily-backtest.ts`: pure historical scoring (daily + per-release passes, hit rates, baselines)
- `src/test-data.ts`, `src/tests.ts`, `src/example.ts`: fixtures, test suite, sample
- `scripts/backtest.ts` + `scripts/lib/`: CSV loading, validation, text report, JSON output
- `scripts/make-sample-data.ts`: synthetic smoke-test data
- `scripts/fetch-fred.ts`: FRED actuals (revised vintage — read the header warning)

## Backtest inputs

```
data/events.csv              id, indicator, timestamp, actual, forecast, previous,
                             unit, period, policySignal, expectedPolicySignal
data/prices/XAUUSD.csv       date (YYYY-MM-DD), close
data/prices/USDJPY.csv       date (YYYY-MM-DD), close
```

The engine is re-evaluated at **every** trading day's close (assumed 21:00 UTC, `--close-hour`), not only on release dates, so decay is actually exercised. Forward returns are measured over 5 and 20 trading days.

Daily rows overlap heavily, so the headline sample size is the count of **independent calls** — unbroken runs of one bias direction. Hit rates built on fewer than 30 of those are flagged loudly and should be read as noise. Every hit rate is reported next to an "always BULLISH" baseline, because beating 50% means nothing when the instrument drifted up.

## Phase 1 foundation

The Next.js App Router entry point lives in `src/app`. The deterministic engine and
existing scripts remain separate; scoring modules do not depend on Next.js or Prisma.
The Prisma datasource uses a local SQLite file at `prisma/dev.db` during development. Copy `.env.example` to `.env`, apply the schema, then run `npm run seed`
to upsert the real event and price CSV rows. The seed validates those files with the
same CSV loaders used by the backtest. Releases missing a forecast remain stored with
`forecast = null` and are skipped by the backtest scoring loader.

Persisted scores must be stamped with `RULES_VERSION` from `src/config.ts`. Any future
change to scoring assumptions requires a new version and a new forward test.

For the later Neon transition, the current SQLite migration cannot be applied to
PostgreSQL. Switch the Prisma provider and connection URLs, create a fresh PostgreSQL
migration history, and copy the current data into Neon (the CSV seed restores the
canonical CSV data; any later admin-entered data will need its own export/import).
PostgreSQL migrations should use `DIRECT_URL` for the direct connection.

## Phase 2 analysis

Release-day reaction calculations live in `src/lib/analysis/release-reaction.ts` and are shared by the backtest and app. Interpretation text is template based and uses relationship wording from `src/rules.ts`. Magnitude bands use the absolute normalized surprise: small is below 0.5, moderate is 0.5 to below 0.75, and large is 0.75 or more. These bands are display conventions, not calibrated thresholds.

## Phase 1 milestone 3: ingestion and snapshots

- `src/lib/prices/types.ts` defines the provider contract; `fred-provider.ts` fetches DGS10, DFII10, DEXJPUS and DTWEXBGS (broad dollar index proxy). XAUUSD remains manual upload only.
- Authenticated cron handlers are configured in `vercel.json`: price ingestion and reaction calculation, followed by daily snapshot recomputation. Both accept `Authorization: Bearer $CRON_SECRET`.
- Snapshots use `origin=dev` unless both `NODE_ENV=production` and `DATABASE_URL` is PostgreSQL. Backfill uses `origin=backfill`; the track-record forward-test query selects only `origin=live`.
- `/admin` accepts an `ADMIN_TOKEN` for release entry and manual XAUUSD CSV upload. Upload headers: `symbol,date,close`; invalid rows are reported individually.
- `npm.cmd run backfill-snapshots` writes historical replay snapshots idempotently. Changing scoring assumptions requires incrementing `RULES_VERSION` and beginning a new forward test.
- SQLite stores snapshot drivers as JSON text in a `String` column and enum-like fields as validated strings. See [the Neon/PostgreSQL switch checklist](docs/postgres-switch.md).

The configured Vercel jobs run once daily; this assumes the deployment plan supports daily crons. The current live snapshot evaluation time is 21:00 UTC.
