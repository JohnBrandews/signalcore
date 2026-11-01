import {
  assertCriteriaComplete,
  emptyCriteria,
  evaluateCriteria,
  parseCriteria,
} from "./lib/criteria";
import { buildDataQualityReport } from "./lib/data-quality";
import { isUtcTimestamp, loadEvents, loadReferencePrices } from "./lib/load-data";
import { parseRawPrices, priceFlags } from "./lib/price-data";
import {
  calculateTargetForwardValue,
  DailyRow,
  evaluateDaily,
  evaluateReferenceTargets,
  PricePoint,
  ReferenceTargetMeasure,
  yearlySpearmanBreakdown,
} from "../src/daily-backtest";
import { resolve } from "node:path";
import { EconomicEvent } from "../src/models";
import { generateReleaseInterpretation } from "../src/lib/analysis/interpretation";
import {
  calculateReleaseChange,
  changeMatchesExpectedSign,
  evaluateReleaseDayReactions,
  previousTradingDayChange,
  releaseChangeMeasure,
} from "../src/lib/analysis/release-reaction";

let passed = 0;

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ok(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

test("Yahoo CSV uses Close rather than Adj Close", () => {
  const parsed = parseRawPrices(
    "Date,Open,High,Low,Close,Adj Close,Volume\n2024-01-02,10,12,9,11,10.5,100",
    "XAUUSD",
  );
  ok(parsed.format === "yahoo", `expected yahoo, got ${parsed.format}`);
  ok(parsed.points[0].close === 11, `expected Close 11, got ${parsed.points[0].close}`);
});

test("Stooq CSV reads Date and Close and sorts ascending", () => {
  const parsed = parseRawPrices(
    "Date,Open,High,Low,Close,Volume\n2024-01-03,10,12,9,11,100\n2024-01-02,9,11,8,10,90",
    "XAUUSD",
  );
  ok(parsed.format === "stooq", `expected stooq, got ${parsed.format}`);
  ok(parsed.points[0].date === "2024-01-02", "Stooq output should be ascending");
});

test("FRED CSV drops only empty and dot observations", () => {
  const parsed = parseRawPrices(
    "observation_date,DFII10\n2024-01-02,.\n2024-01-03,\n2024-01-04,-0.25",
    "REAL10Y",
  );
  ok(parsed.format === "fred", `expected fred, got ${parsed.format}`);
  ok(parsed.points.length === 1, `expected one usable row, got ${parsed.points.length}`);
  ok(parsed.points[0].close === -0.25, "yield series must allow negative values");
});

test("event timestamp validation accepts UTC but rejects non-UTC offsets", () => {
  ok(isUtcTimestamp("2024-01-11T13:30:00Z"), "Z timestamp should be accepted");
  ok(isUtcTimestamp("2024-01-11T13:30:00+00:00"), "zero offset should be accepted");
  ok(!isUtcTimestamp("2024-01-11T16:30:00+03:00"), "non-UTC offset should be rejected");
});

test("price flagging reports gaps and large adjacent-observation moves", () => {
  const flags = priceFlags(
    [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-07", close: 109 },
      { date: "2024-01-08", close: 120 },
    ],
    "DXY",
  );
  ok(
    flags.some((flag) => flag.type === "gap" && flag.date === "2024-01-07"),
    "expected gap flag",
  );
  ok(
    flags.some((flag) => flag.type === "large_move" && flag.date === "2024-01-07"),
    "expected >8% move flag",
  );
  ok(
    flags.some((flag) => flag.type === "large_move" && flag.date === "2024-01-08"),
    "expected second adjacent-observation move flag",
  );
});

test("reference forward targets distinguish percent returns from percentage-point changes", () => {
  const percentMeasure: ReferenceTargetMeasure = "forward_percent_return";
  const yieldMeasure: ReferenceTargetMeasure = "forward_absolute_change_percentage_points";
  ok(
    Math.abs(calculateTargetForwardValue(90, 99, percentMeasure) - 10) < 1e-9,
    "DXY forward value should be a percent return",
  );
  ok(
    Math.abs(calculateTargetForwardValue(3.8, 4.05, yieldMeasure) - 0.25) < 1e-9,
    "yield forward value should be an absolute percentage-point change",
  );
});

test("yearly Spearman breakdown reports paired-day counts per calendar year", () => {
  const report = yearlySpearmanBreakdown([
    { date: "2021-01-01", score: 1, direction: "BULLISH", forwardValue: 10 },
    { date: "2021-01-02", score: 2, direction: "BULLISH", forwardValue: 20 },
    { date: "2021-01-03", score: 3, direction: "BULLISH", forwardValue: 30 },
    { date: "2022-01-01", score: 1, direction: "BEARISH", forwardValue: 30 },
    { date: "2022-01-02", score: 2, direction: "BEARISH", forwardValue: 20 },
  ]);
  ok(report.length === 2, `expected two years, got ${report.length}`);
  ok(report[0].year === 2021 && report[0].days === 3, "2021 count should be three paired days");
  ok(report[1].year === 2022 && report[1].days === 2, "2022 count should be two paired days");
  ok(report[0].spearmanScoreForwardValue === 1, "2021 Spearman should be +1");
  ok(report[1].spearmanScoreForwardValue === -1, "2022 Spearman should be -1");
});

test("daily evaluation excludes price days before the first event", () => {
  const event: EconomicEvent = {
    id: "cpi-2024-01",
    indicator: "US_CPI",
    timestamp: "2024-01-10T13:30:00Z",
    actual: 3.2,
    forecast: 3.0,
    unit: "percent",
    period: "2024-01",
  };
  const series: PricePoint[] = ["08", "09", "10", "11", "12"].map((day, index) => ({
    date: `2024-01-${day}`,
    close: 100 + index,
  }));
  const rows = evaluateDaily(
    [event],
    { XAUUSD: series, USDJPY: series },
    { dailyCloseHourUtc: 21, horizons: [1] },
    "2024-01-10",
  );
  ok(
    rows.every((row) => row.date >= "2024-01-10"),
    "pre-event dates must not be evaluated",
  );
  ok(rows.length === 6, `expected three dates per instrument, got ${rows.length}`);
});

test("release-day expected sign matches hawkish/dovish surprises per target", () => {
  ok(changeMatchesExpectedSign(1, 1, 1), "hawkish rise should match positive expected sign");
  ok(
    changeMatchesExpectedSign(-1, -1, 1),
    "dovish fall should match positive hawkish sign inversion",
  );
  ok(changeMatchesExpectedSign(1, -1, -1), "hawkish fall should match XAUUSD inverse sign");
  ok(!changeMatchesExpectedSign(1, 0, 1), "a flat move does not match a directional sign");
});

test("release change uses percent returns for prices and absolute points for yields", () => {
  ok(releaseChangeMeasure("DXY") === "percent_return", "DXY should use percent returns");
  ok(releaseChangeMeasure("USDJPY") === "percent_return", "USDJPY should use percent returns");
  ok(releaseChangeMeasure("XAUUSD") === "percent_return", "XAUUSD should use percent returns");
  ok(
    releaseChangeMeasure("REAL10Y") === "percentage_point_change",
    "REAL10Y should use point change",
  );
  ok(
    releaseChangeMeasure("UST10Y") === "percentage_point_change",
    "UST10Y should use point change",
  );
  ok(
    Math.abs(calculateReleaseChange(100, 102, "percent_return") - 2) < 1e-9,
    "price return mismatch",
  );
  ok(
    Math.abs(calculateReleaseChange(3.8, 4.05, "percentage_point_change") - 0.25) < 1e-9,
    "yield point change mismatch",
  );
});

test("previous trading day lookup uses the preceding available date", () => {
  const series = [
    { date: "2024-01-04", close: 100 },
    { date: "2024-01-08", close: 102 },
  ];
  ok(
    Math.abs(previousTradingDayChange(series, "2024-01-08", "percent_return")! - 2) < 1e-9,
    "previous observation should be used across weekend",
  );
  ok(
    previousTradingDayChange(series, "2024-01-04", "percent_return") === null,
    "first row has no prior close",
  );
  ok(
    previousTradingDayChange(series, "2024-01-05", "percent_return") === null,
    "missing release date must be skipped",
  );
});

test("release reaction excludes zero directional surprises", () => {
  const event: EconomicEvent = {
    id: "zero-cpi",
    indicator: "US_CPI",
    timestamp: "2024-01-08T13:30:00Z",
    actual: 3,
    forecast: 3,
    unit: "percent",
    period: "2024-01",
  };
  const report = evaluateReleaseDayReactions([event], {
    DXY: [
      { date: "2024-01-05", close: 100 },
      { date: "2024-01-08", close: 101 },
    ],
  });
  ok(report.zeroSurprisesExcluded === 1, "zero surprise count should be one");
  ok(report.observations.length === 0, "zero surprise must not create observations");
});

test("reference targets bucket the USDJPY score and criteria evaluate configured horizons", () => {
  const dates = Array.from({ length: 30 }, (_, index) =>
    new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  );
  const usdJpyRows = dates.map((date, index): DailyRow => ({
    date,
    asOf: `${date}T21:00:00Z`,
    instrument: "USDJPY",
    close: 100,
    direction: "BULLISH",
    score: index,
    netScore: index,
    agreement: 1,
    confidence: 1,
    eventsVisible: index,
    forwardReturnPct: { 5: null, 20: null },
    isDirectionChange: true,
  }));
  const dxy = dates.map((date, index) => ({
    date,
    close: 100 * Math.exp(0.001 * index * index),
  }));
  const target = evaluateReferenceTargets(usdJpyRows, { DXY: dxy })[0];
  ok(
    target.target === "DXY" && target.measure === "forward_percent_return",
    "DXY measure mismatch",
  );
  ok(target.horizons.length === 2, "target should report 5d and 20d");
  ok(target.horizons[0].buckets.length === 5, "target should use score buckets");
  ok(target.horizons[0].spearmanScoreForwardValue === 1, "expected increasing score/return rank");
  ok(
    target.horizons[0].yearlySpearman[0].days === 25,
    "5d yearly count should exclude forward tail",
  );

  const criteria = emptyCriteria();
  criteria.inSampleEnd = "2023-12-31";
  for (const item of Object.values(criteria.targets)) {
    item.expectedSpearmanSign = 1;
    item.minimumAbsoluteSpearman = 0.8;
    item.horizonsToCheck = [5];
    item.topBucketMustBeatBottom = true;
  }
  const evaluation = evaluateCriteria([target], criteria);
  ok(evaluation.length === 1 && evaluation[0].passed, "configured DXY criteria should pass");
});

test("data quality report counts missing event months and forecasts", () => {
  const report = buildDataQualityReport(
    [
      {
        id: "cpi-jan",
        indicator: "US_CPI",
        timestamp: "2024-01-11T13:30:00Z",
        hasForecast: true,
        skipped: false,
        skippedForMissingForecast: false,
      },
      {
        id: "cpi-mar",
        indicator: "US_CPI",
        timestamp: "2024-03-28T12:30:00Z",
        hasForecast: false,
        skipped: true,
        skippedForMissingForecast: true,
      },
      {
        id: "nfp-jan",
        indicator: "US_NFP",
        timestamp: "2024-01-05T13:30:00Z",
        hasForecast: true,
        skipped: false,
        skippedForMissingForecast: false,
      },
      {
        id: "nfp-mar",
        indicator: "US_NFP",
        timestamp: "2024-03-28T12:30:00Z",
        hasForecast: false,
        skipped: true,
        skippedForMissingForecast: true,
      },
    ],
    [{ symbol: "USDJPY", firstDate: "2024-01-05", lastDate: "2024-03-28" }],
  );
  const cpiGaps = report.indicatorMonthGaps.find((gap) => gap.indicator === "US_CPI");
  const nfpGaps = report.indicatorMonthGaps.find((gap) => gap.indicator === "US_NFP");
  ok(cpiGaps?.missingMonths.join(",") === "2024-02,2024-03", "CPI month gaps mismatch");
  ok(
    cpiGaps?.skippedMissingForecastMonths.join(",") === "2024-03",
    "CPI skipped month annotation mismatch",
  );
  ok(nfpGaps?.missingMonths.join(",") === "2024-02,2024-03", "NFP month gaps mismatch");
  ok(
    nfpGaps?.skippedMissingForecastMonths.join(",") === "2024-03",
    "NFP skipped month annotation mismatch",
  );
  ok(
    report.eventsMissingForecast === 2 &&
      report.missingForecastPct !== null &&
      Math.abs(report.missingForecastPct - 50) < 1e-9,
    "forecast count mismatch",
  );
});

test("criteria gate refuses PASS/FAIL while any target criteria are null", () => {
  const criteria = parseCriteria(JSON.stringify(emptyCriteria()), "inline criteria");
  let refused = false;
  try {
    assertCriteriaComplete(criteria);
  } catch (error) {
    refused = error instanceof Error && error.message.includes("refusing PASS/FAIL output");
  }
  ok(refused, "incomplete criteria must reject evaluation");
});

test("release interpretation uses directional surprise, magnitude bands, and rule relationships", () => {
  const base: EconomicEvent = {
    id: "core-cpi-interpretation",
    indicator: "US_CORE_CPI",
    timestamp: "2024-01-10T13:30:00Z",
    unit: "percent",
    period: "2024-01",
    forecast: 0.1,
  };
  const inLine = generateReleaseInterpretation({ ...base, actual: 0.1 });
  const small = generateReleaseInterpretation({ ...base, actual: 0.14 });
  const hawkish = generateReleaseInterpretation({ ...base, actual: 0.21 });
  const dovish = generateReleaseInterpretation({ ...base, actual: 0.04 });
  const large = generateReleaseInterpretation({ ...base, actual: 0.26 });
  ok(inLine?.label === "In line", "zero surprise should be In line");
  ok(inLine?.magnitude === "small (<0.5 normalized)", "zero surprise should be small");
  ok(
    hawkish?.label === "Hawkish" && hawkish.magnitude === "moderate",
    "positive directional surprise should be moderate Hawkish",
  );
  ok(dovish?.label === "Dovish", "negative directional surprise should be Dovish");
  ok(large?.magnitude === "large", "normalized magnitude at or above 0.75 should be large");
  ok(
    hawkish !== null && hawkish.text.includes("Inflation release updates price pressure."),
    "text should include relationship wording from rules.ts",
  );
  ok(
    hawkish !== null &&
      hawkish.text.includes("This is a rule-based reading of surprise versus consensus."),
    "text must explicitly describe its rule-based basis",
  );
  ok(
    generateReleaseInterpretation({ ...base, actual: undefined }) === null,
    "unscorable release should have no interpretation",
  );
});

test("release-day reaction parity reproduces Phase 0 DXY statistics", () => {
  const root = process.cwd();
  const events = loadEvents(resolve(root, "data/real/events.csv")).events;
  const prices = {
    DXY: loadReferencePrices(resolve(root, "data/real/prices/DXY.csv"), "DXY"),
  };
  const report = evaluateReleaseDayReactions(events, prices);
  const core = report.groups.find(
    (group) => group.indicator === "US_CORE_CPI" && group.target === "DXY",
  );
  const nfp = report.groups.find((group) => group.indicator === "US_NFP" && group.target === "DXY");
  if (core === undefined || nfp === undefined)
    throw new Error("expected both DXY indicator groups");
  ok(core.all.n === 46, `US_CORE_CPI/DXY n expected 46, got ${core.all.n}`);
  ok(core.all.expectedSignMatchesPct?.toFixed(1) === "71.7", "core CPI match rate should be 71.7%");
  ok(
    core.all.averageChangeAfterHawkishSurprises?.toFixed(3) === "0.122",
    "core CPI hawkish average should be +0.122%",
  );
  ok(
    core.all.averageChangeAfterDovishSurprises?.toFixed(3) === "-0.350",
    "core CPI dovish average should be -0.350%",
  );
  ok(core.all.spearmanSurpriseChange?.toFixed(3) === "0.521", "core CPI Spearman should be 0.521");
  ok(nfp.all.n === 69, `US_NFP/DXY n expected 69, got ${nfp.all.n}`);
  ok(nfp.all.expectedSignMatchesPct?.toFixed(1) === "60.9", "NFP match rate should be 60.9%");
  ok(nfp.all.spearmanSurpriseChange?.toFixed(3) === "0.398", "NFP Spearman should be 0.398");
});

test("live snapshot origin requires Vercel production and explicit opt-in", () => {
  const { snapshotOrigin } = require("../src/lib/snapshot-origin") as typeof import("../src/lib/snapshot-origin");
  ok(snapshotOrigin({ vercelEnv: "production", forwardTestEnabled: "true" }) === "live", "both opt-in conditions should permit live");
  ok(snapshotOrigin({ vercelEnv: "production", forwardTestEnabled: "false" }) === "dev", "false opt-in must remain dev");
  ok(snapshotOrigin({ vercelEnv: "preview", forwardTestEnabled: "true" }) === "dev", "preview must remain dev");
  ok(snapshotOrigin({ vercelEnv: "", forwardTestEnabled: "true" }) === "dev", "local must remain dev");
});
console.log(`${passed} real-data workflow tests passed`);

