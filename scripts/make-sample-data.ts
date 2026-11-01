/**
 * Writes SYNTHETIC sample data to data/sample/ so the backtest pipeline can be
 * run and reviewed before real CSVs exist.
 *
 *   npx tsx scripts/make-sample-data.ts
 *
 * The prices are a seeded random walk and the releases are seeded noise around
 * a flat base. There is no relationship between them by construction, so any
 * "edge" this produces is pure sampling noise — that is the point: it shows
 * what the report looks like when there is nothing there.
 *
 * It never touches data/events.csv or data/prices/.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "data", "sample");
const START = "2023-01-02";
const END = "2024-12-31";
const DAY_MS = 86_400_000;

// Deterministic LCG (numerical recipes constants) so reruns are reproducible.
let seed = 20240101;
const next = (): number => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
/** Box-Muller, one draw per call. */
const gauss = (): number =>
  Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const round = (value: number, digits: number): number => Number(value.toFixed(digits));

function tradingDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (
    let ms = Date.parse(`${start}T00:00:00Z`);
    ms <= Date.parse(`${end}T00:00:00Z`);
    ms += DAY_MS
  ) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(iso(ms));
  }
  return days;
}

function randomWalk(days: string[], start: number, dailyVol: number, drift: number): string[] {
  let level = start;
  return days.map((date) => {
    level *= 1 + drift + dailyVol * gauss();
    return `${date},${round(level, 4)}`;
  });
}

/** Nth weekday (0=Sun) of a month, e.g. the first Friday for payrolls. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  let found = 0;
  for (let day = 1; day <= 31; day += 1) {
    const ms = Date.UTC(year, month, day);
    if (new Date(ms).getUTCMonth() !== month) break;
    if (new Date(ms).getUTCDay() === weekday) {
      found += 1;
      if (found === nth) return iso(ms);
    }
  }
  throw new Error(`no weekday ${weekday} #${nth} in ${year}-${month + 1}`);
}

function dayOfMonth(year: number, month: number, day: number): string {
  return iso(Date.UTC(year, month, day));
}

interface EventRow {
  id: string;
  indicator: string;
  timestamp: string;
  actual: string;
  forecast: string;
  previous: string;
  unit: string;
  period: string;
  policySignal: string;
  expectedPolicySignal: string;
}

const numeric = (
  id: string,
  indicator: string,
  timestamp: string,
  base: number,
  spread: number,
  unit: string,
  period: string,
  digits = 1,
): EventRow => {
  const forecast = round(base, digits);
  const actual = round(base + spread * gauss(), digits);
  return {
    id,
    indicator,
    timestamp,
    actual: String(actual),
    forecast: String(forecast),
    previous: String(round(base - spread * 0.3, digits)),
    unit,
    period,
    policySignal: "",
    expectedPolicySignal: "",
  };
};

const STANCES = ["HAWKISH", "NEUTRAL", "NEUTRAL", "DOVISH"];

function buildEvents(): EventRow[] {
  const rows: EventRow[] = [];
  const startYear = Number(START.slice(0, 4));
  const endYear = Number(END.slice(0, 4));

  for (let year = startYear; year <= endYear; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const period = `${year}-${String(month + 1).padStart(2, "0")}`;
      const payrollDay = nthWeekday(year, month, 5, 1);

      rows.push(
        numeric(
          `sample-nfp-${period}`,
          "US_NFP",
          `${payrollDay}T13:30:00Z`,
          180,
          85,
          "thousands",
          period,
          0,
        ),
        numeric(
          `sample-unrate-${period}`,
          "US_UNEMPLOYMENT_RATE",
          `${payrollDay}T13:30:00Z`,
          3.8,
          0.12,
          "percent",
          period,
          1,
        ),
        numeric(
          `sample-ahe-${period}`,
          "US_AVERAGE_HOURLY_EARNINGS",
          `${payrollDay}T13:30:00Z`,
          0.3,
          0.12,
          "percent",
          period,
          1,
        ),
        numeric(
          `sample-cpi-${period}`,
          "US_CPI",
          `${dayOfMonth(year, month, 12)}T13:30:00Z`,
          3.1,
          0.22,
          "percent",
          period,
          1,
        ),
        numeric(
          `sample-corecpi-${period}`,
          "US_CORE_CPI",
          `${dayOfMonth(year, month, 12)}T13:30:00Z`,
          3.6,
          0.18,
          "percent",
          period,
          1,
        ),
        numeric(
          `sample-pce-${period}`,
          "US_PCE",
          `${dayOfMonth(year, month, 27)}T13:30:00Z`,
          2.9,
          0.18,
          "percent",
          period,
          1,
        ),
        numeric(
          `sample-corepce-${period}`,
          "US_CORE_PCE",
          `${dayOfMonth(year, month, 27)}T13:30:00Z`,
          3.2,
          0.15,
          "percent",
          period,
          1,
        ),
        numeric(
          `sample-ismman-${period}`,
          "US_ISM_MANUFACTURING_PMI",
          `${dayOfMonth(year, month, 2)}T15:00:00Z`,
          48.5,
          1.6,
          "index",
          period,
          1,
        ),
        numeric(
          `sample-ismsvc-${period}`,
          "US_ISM_SERVICES_PMI",
          `${dayOfMonth(year, month, 4)}T15:00:00Z`,
          52.5,
          1.8,
          "index",
          period,
          1,
        ),
      );

      if (month % 3 === 0) {
        const quarter = `${year}-Q${Math.floor(month / 3) + 1}`;
        rows.push(
          numeric(
            `sample-gdp-${quarter}`,
            "US_GDP",
            `${dayOfMonth(year, month, 26)}T13:30:00Z`,
            2.4,
            0.5,
            "percent",
            quarter,
            1,
          ),
        );
      }

      // Eight FOMC meetings a year: skip four months.
      if (![0, 3, 7, 9].includes(month)) {
        const stance = STANCES[Math.floor(next() * STANCES.length)];
        rows.push({
          id: `sample-fomc-${period}`,
          indicator: "FOMC_RATE_DECISION",
          timestamp: `${dayOfMonth(year, month, 20)}T19:00:00Z`,
          actual: "",
          forecast: "",
          previous: "",
          unit: "text",
          period,
          policySignal: stance,
          expectedPolicySignal: "NEUTRAL",
        });
      }
    }
  }

  // Two deliberately incomplete rows, so the "skipped" path is exercised.
  rows.push({
    id: "sample-cpi-missing-actual",
    indicator: "US_CPI",
    timestamp: "2024-06-12T13:30:00Z",
    actual: "",
    forecast: "3.1",
    previous: "3.0",
    unit: "percent",
    period: "2024-06",
    policySignal: "",
    expectedPolicySignal: "",
  });
  rows.push({
    id: "sample-nfp-missing-forecast",
    indicator: "US_NFP",
    timestamp: "2024-07-05T13:30:00Z",
    actual: "206",
    forecast: "",
    previous: "218",
    unit: "thousands",
    period: "2024-07",
    policySignal: "",
    expectedPolicySignal: "",
  });

  return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

const EVENT_COLUMNS: (keyof EventRow)[] = [
  "id",
  "indicator",
  "timestamp",
  "actual",
  "forecast",
  "previous",
  "unit",
  "period",
  "policySignal",
  "expectedPolicySignal",
];

const README = `# SYNTHETIC SAMPLE DATA — NOT REAL MARKET DATA

Generated by \`scripts/make-sample-data.ts\`. Prices are a seeded random walk and
releases are seeded noise around a flat base, with no relationship between them.

It exists only to prove the loader, the daily evaluation loop and the report run
end to end. Any hit rate produced from it is noise and must never be read as
evidence about the rules.

Replace it with real data in \`data/\` (same column layout) before drawing any
conclusion.
`;

function main(): void {
  const days = tradingDays(START, END);
  mkdirSync(resolve(OUT_DIR, "prices"), { recursive: true });

  writeFileSync(
    resolve(OUT_DIR, "prices", "XAUUSD.csv"),
    `date,close\n${randomWalk(days, 1850, 0.009, 0.0003).join("\n")}\n`,
    "utf8",
  );
  writeFileSync(
    resolve(OUT_DIR, "prices", "USDJPY.csv"),
    `date,close\n${randomWalk(days, 132, 0.005, 0.0002).join("\n")}\n`,
    "utf8",
  );

  const events = buildEvents();
  const lines = events.map((row) => EVENT_COLUMNS.map((column) => row[column]).join(","));
  writeFileSync(
    resolve(OUT_DIR, "events.csv"),
    `${EVENT_COLUMNS.join(",")}\n${lines.join("\n")}\n`,
    "utf8",
  );
  writeFileSync(resolve(OUT_DIR, "README.md"), README, "utf8");

  console.log(`wrote ${days.length} trading days and ${events.length} event rows to ${OUT_DIR}`);
  console.log("SYNTHETIC DATA — results from it are noise by construction.");
}

main();
