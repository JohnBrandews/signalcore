# Real-data guide

All real input values must come from source files you place in `data/real/`.
The backtest does not estimate or fill missing values. Malformed required data
stops the run with the file and row identified; optional reference-target price
files may be omitted.

## Event rows

`data/real/events.csv` uses this header:

```csv
id,indicator,timestamp,actual,forecast,previous,unit,period,policySignal,expectedPolicySignal
```

- `id`: unique ID for the release row.
- `indicator`: one of the indicator names defined in `src/models.ts`.
- `timestamp`: ISO 8601 release timestamp in UTC, including `Z` (for example,
  `2024-01-11T13:30:00Z`).
- `actual`, `forecast`, `previous`: numeric release values in the same
  convention and unit. Leave a value empty only when the source did not provide
  it; rows without a scoreable actual/forecast are reported as skipped.
- `unit`: `percent`, `index`, `thousands`, `basis_points`, or `text`.
- `period`: period the release describes, conventionally `YYYY-MM`.
- `policySignal`, `expectedPolicySignal`: optional structured policy stances
  (`HAWKISH`, `NEUTRAL`, `DOVISH`).

Enter CPI as year-over-year percent, not as an index level. Enter NFP as the
monthly change in nonfarm payrolls, in thousands (for example, the source's
headline change, not the payrolls level). Use each release's first-published
actual value rather than a subsequently revised value. Keep one chosen source
per event series and record source/provenance alongside your own data notes.

The `data/real/events.csv` shipped with this project contains only the header.
No event values are supplied.

## Raw price files

Place user-downloaded files in `data/real/raw/<SYMBOL>.csv`, using one of:
`XAUUSD`, `USDJPY`, `DXY`, `REAL10Y`, or `UST10Y`. The preparation script
detects Yahoo Finance history CSV (`Date` and `Close`; `Adj Close` is ignored),
Stooq CSV (`Date` and `Close`), and two-column FRED CSV (`observation_date`
plus its series column). FRED blank and `.` observations are omitted from the
prepared output. Other invalid values are errors.

Run `npm run prepare-prices` to write ascending `date,close` files to
`data/real/prices/`. XAUUSD and USDJPY raw files are required for the existing
instrument backtest; reference targets are optional. Gaps over five calendar
days and adjacent-observation moves over 8% are reported, and flagged rows are
retained for manual review.

The optional `npm run fetch-fred-prices` downloads DEXJPUS, DFII10, and DGS10
from FRED's public CSV endpoint without an API key. DEXJPUS is a noon-New-York
rate series and differs slightly from a 21:00 UTC close. The downloader will
not overwrite an existing raw file. Standard FRED series are revised; for
release-event actuals, use first-release values rather than revised data.

## Backtest and criteria

Run `npm run backtest -- --data data/real`. XAUUSD and USDJPY remain the
existing instrument reports. Optional DXY, REAL10Y, and UST10Y targets use the
USDJPY bias score as the assumed US-hawkishness score. DXY is evaluated by
forward percent return; REAL10Y and UST10Y are evaluated by absolute forward
change in percentage points. Target statistics are aligned by date and include
5- and 20-trading-day score buckets, Spearman correlations, and per-calendar-
year Spearman correlations with paired-day counts.

Fill every non-null field in `data/real/criteria.json` before the report emits
any target PASS/FAIL. Configure the expected Spearman sign, minimum absolute
Spearman, horizons (`5`, `20`, or both), and whether a higher-score bucket must
have a greater average target value than the lower-score bucket. An unfilled
criterion allows metrics to print, but no PASS/FAIL is printed.
