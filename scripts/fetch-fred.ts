/**
 * Pulls indicator ACTUALS from FRED into data/fred-actuals.csv.
 *
 *   FRED_API_KEY=... npx tsx scripts/fetch-fred.ts [--start 2015-01-01] [--out <file>]
 *
 * ---------------------------------------------------------------------------
 * WARNING — FRED SERVES REVISED DATA, NOT FIRST-RELEASE DATA.
 *
 * A backtest compares a forecast made before the release against the number
 * printed at the release. FRED's standard series return the CURRENT vintage:
 * payrolls are revised twice and benchmarked annually, GDP has advance /
 * second / third estimates, CPI seasonal factors are restated every year.
 * Feeding revised actuals into a surprise calculation leaks information that
 * nobody had on the day, and it biases results OPTIMISTIC — the "surprise" is
 * measured against a number that was partly corrected after the fact.
 *
 * Use this for sanity-checking levels and for building out the shape of a
 * dataset. For a backtest you can defend, source first-release values (FRED's
 * ALFRED vintage API, or a calendar provider that stores the printed number).
 * ---------------------------------------------------------------------------
 *
 * This script never writes data/events.csv. Forecasts and release timestamps
 * are not on FRED, so the output is actuals only and has to be joined to a
 * calendar by hand.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { EconomicIndicator, EventUnit } from "../src/models";

type Transform = "yoy_percent" | "mom_percent" | "mom_change" | "level";

interface SeriesSpec {
  indicator: EconomicIndicator;
  seriesId: string;
  unit: EventUnit;
  transform: Transform;
  /** What the raw FRED series is, and why this transform matches the forecast convention. */
  conversion: string;
}

/**
 * Each entry converts the raw FRED series into the SAME measure the consensus
 * forecast is quoted in. Getting this wrong silently produces a huge, constant
 * "surprise" (for example comparing a CPI index level of 315 against a 3.1%
 * forecast), so the mapping is spelled out rather than inferred.
 */
const SERIES: SeriesSpec[] = [
  {
    indicator: "US_CPI",
    seriesId: "CPIAUCNS",
    unit: "percent",
    transform: "yoy_percent",
    conversion:
      "CPI-U index, all items, NOT seasonally adjusted -> year-over-year % = (v[t]/v[t-12]-1)*100. " +
      "Headline 'CPI y/y' is quoted from the NSA index.",
  },
  {
    indicator: "US_CORE_CPI",
    seriesId: "CPILFENS",
    unit: "percent",
    transform: "yoy_percent",
    conversion:
      "CPI less food and energy, NSA index -> year-over-year %. Same convention as headline CPI y/y.",
  },
  {
    indicator: "US_PCE",
    seriesId: "PCEPI",
    unit: "percent",
    transform: "yoy_percent",
    conversion:
      "PCE price index, seasonally adjusted -> year-over-year %. Twelve-month ratios are near " +
      "identical on SA and NSA, and BEA headlines the SA series.",
  },
  {
    indicator: "US_CORE_PCE",
    seriesId: "PCEPILFE",
    unit: "percent",
    transform: "yoy_percent",
    conversion: "PCE price index less food and energy, SA -> year-over-year %.",
  },
  {
    indicator: "US_NFP",
    seriesId: "PAYEMS",
    unit: "thousands",
    transform: "mom_change",
    conversion:
      "Total nonfarm payrolls, SA, reported as a LEVEL in thousands -> monthly change = v[t]-v[t-1], " +
      "which is the '+180k' headline.",
  },
  {
    indicator: "US_UNEMPLOYMENT_RATE",
    seriesId: "UNRATE",
    unit: "percent",
    transform: "level",
    conversion: "Unemployment rate, SA, already a percent level. No conversion.",
  },
  {
    indicator: "US_AVERAGE_HOURLY_EARNINGS",
    seriesId: "CES0500000003",
    unit: "percent",
    transform: "mom_percent",
    conversion:
      "Average hourly earnings, total private, SA, in dollars -> month-over-month % = " +
      "(v[t]/v[t-1]-1)*100, the headline AHE m/m.",
  },
  {
    indicator: "US_GDP",
    seriesId: "A191RL1Q225SBEA",
    unit: "percent",
    transform: "level",
    conversion:
      "Real GDP, percent change from preceding quarter at an annual rate. Already the headline " +
      "measure. Quarterly, so periods are labelled YYYY-Qn.",
  },
];

/**
 * ISM manufacturing and services PMIs are intentionally absent: ISM withdrew
 * them from FRED in 2019 and they are licensed, not public. They have to come
 * from the calendar provider.
 */
const UNAVAILABLE: EconomicIndicator[] = ["US_ISM_MANUFACTURING_PMI", "US_ISM_SERVICES_PMI"];

interface Observation {
  date: string;
  value: string;
}

async function fetchSeries(
  seriesId: string,
  apiKey: string,
  start: string,
): Promise<Observation[]> {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", start);

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`FRED ${seriesId}: HTTP ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as { observations?: Observation[] };
  if (!body.observations) throw new Error(`FRED ${seriesId}: response had no observations`);
  return body.observations;
}

function periodLabel(date: string, seriesId: string): string {
  if (seriesId === "A191RL1Q225SBEA") {
    const month = Number(date.slice(5, 7));
    return `${date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
  }
  return date.slice(0, 7);
}

function convert(spec: SeriesSpec, observations: Observation[]): { date: string; value: number }[] {
  const points = observations
    .map((observation) => ({ date: observation.date, value: Number(observation.value) }))
    .filter((point) => Number.isFinite(point.value));

  const lag = spec.transform === "yoy_percent" ? 12 : spec.transform === "level" ? 0 : 1;
  const out: { date: string; value: number }[] = [];

  for (let i = lag; i < points.length; i += 1) {
    const current = points[i].value;
    const previous = points[i - lag]?.value;
    let value: number;
    switch (spec.transform) {
      case "level":
        value = current;
        break;
      case "mom_change":
        value = current - previous;
        break;
      case "mom_percent":
        value = (current / previous - 1) * 100;
        break;
      case "yoy_percent":
        value = (current / previous - 1) * 100;
        break;
    }
    out.push({ date: points[i].date, value: Number(value.toFixed(4)) });
  }
  return out;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = argv[i].replace(/^--/, "").split("=");
    args[name] = inline ?? argv[++i];
  }
  return args;
}

const COLUMNS = [
  "indicator",
  "period",
  "periodDate",
  "actual",
  "unit",
  "fredSeriesId",
  "transform",
  "vintage",
];

async function main(): Promise<void> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FRED_API_KEY is not set. Get a free key at https://fredaccount.stlouisfed.org/apikeys",
    );
  }

  const args = parseArgs(process.argv.slice(2));
  const start = args.start ?? "2015-01-01";
  const outputPath = resolve(process.cwd(), args.out ?? "data/fred-actuals.csv");

  if (outputPath.endsWith("events.csv")) {
    throw new Error(
      "Refusing to write to events.csv — FRED actuals are a separate, revised-vintage file.",
    );
  }

  console.log("WARNING: FRED returns REVISED values, not first-release values.");
  console.log("         Surprises computed from these are optimistic. See the header comment.\n");

  const lines: string[] = [COLUMNS.join(",")];

  for (const spec of SERIES) {
    // Twelve extra months of history so the first YoY point is still inside the
    // requested window.
    const lookback = new Date(Date.parse(`${start}T00:00:00Z`));
    lookback.setUTCFullYear(lookback.getUTCFullYear() - 2);

    const observations = await fetchSeries(
      spec.seriesId,
      apiKey,
      lookback.toISOString().slice(0, 10),
    );
    const converted = convert(spec, observations).filter((point) => point.date >= start);

    for (const point of converted) {
      lines.push(
        [
          spec.indicator,
          periodLabel(point.date, spec.seriesId),
          point.date,
          String(point.value),
          spec.unit,
          spec.seriesId,
          spec.transform,
          "revised",
        ].join(","),
      );
    }
    console.log(
      `${spec.indicator.padEnd(28)} ${spec.seriesId.padEnd(16)} ${converted.length} points`,
    );
    console.log(`  ${spec.conversion}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`\nwrote ${lines.length - 1} rows to ${outputPath}`);
  console.log(`not available on FRED (licensed): ${UNAVAILABLE.join(", ")}`);
  console.log(
    "\nThis file has NO forecasts and NO release timestamps — both are required before the\n" +
      "engine can score a surprise. Join it to a calendar and write data/events.csv yourself.",
  );
}

main().catch((error: unknown) => {
  console.error(`\nfetch-fred failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
