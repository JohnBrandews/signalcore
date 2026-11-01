/**
 * Historical backtest driver.
 *
 *   npx tsx scripts/backtest.ts [--data <dir>] [--out <file>]
 *                               [--horizons 5,20] [--close-hour 21]
 *
 * Reads:  <dir>/events.csv, <dir>/prices/XAUUSD.csv, <dir>/prices/USDJPY.csv
 * Writes: output/backtest-results.json  (+ a plain-text summary on stdout)
 *
 * All scoring logic lives in src/daily-backtest.ts. This file only does I/O,
 * argument handling and printing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  BacktestOptions,
  DEFAULT_OPTIONS,
  INSTRUMENTS,
  PriceSeriesMap,
  REFERENCE_TARGETS,
  ReferenceTargetPriceMap,
  runBacktest,
} from "../src/daily-backtest";
import { BIAS_DIRECTION_THRESHOLD, REGIME_MIXED_THRESHOLD } from "../src/config";
import { CsvError } from "./lib/csv";
import { criteriaMissingFields, emptyCriteria, parseCriteria } from "./lib/criteria";
import { buildDataQualityReport } from "./lib/data-quality";
import { loadEvents, loadPrices, loadReferencePrices } from "./lib/load-data";
import { buildPeriodAnalysis, PeriodAnalysis } from "./lib/period-analysis";
import { evaluateReleaseDayReactions, ReleasePriceMap } from "../src/lib/analysis/release-reaction";
import { renderDataQualitySection, renderSummary } from "./lib/report";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument "${token}"`);
    const [name, inlineValue] = token.slice(2).split("=");
    const value = inlineValue ?? argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${name}`);
    args[name] = value;
  }
  return args;
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Keeps floating-point noise (0.30000000000000004) out of the JSON. */
function roundDeep<T>(value: T, digits = 6): T {
  if (typeof value === "number") {
    return (Number.isFinite(value) ? Number(value.toFixed(digits)) : value) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => roundDeep(item, digits)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = roundDeep(item, digits);
    return out as T;
  }
  return value;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolve(process.cwd(), args.data ?? "data");
  const outputPath = resolve(process.cwd(), args.out ?? "output/backtest-results.json");

  const horizons = (args.horizons ?? DEFAULT_OPTIONS.horizons.join(","))
    .split(",")
    .map((token) => Number(token.trim()));
  if (horizons.some((h) => !Number.isInteger(h) || h <= 0)) {
    throw new Error(
      `--horizons must be positive whole numbers of trading days, got "${args.horizons}"`,
    );
  }

  const dailyCloseHourUtc = Number(args["close-hour"] ?? DEFAULT_OPTIONS.dailyCloseHourUtc);
  if (!Number.isInteger(dailyCloseHourUtc) || dailyCloseHourUtc < 0 || dailyCloseHourUtc > 23) {
    throw new Error(`--close-hour must be a whole hour 0-23, got "${args["close-hour"]}"`);
  }

  const options: BacktestOptions = { dailyCloseHourUtc, horizons };

  const loaded = loadEvents(resolve(dataDir, "events.csv"));
  const prices = {} as PriceSeriesMap;
  for (const instrument of INSTRUMENTS) {
    prices[instrument] = loadPrices(resolve(dataDir, "prices", `${instrument}.csv`), instrument);
  }

  const referencePrices: ReferenceTargetPriceMap = {};
  const missingReferenceTargets: string[] = [];
  for (const target of REFERENCE_TARGETS) {
    const targetPath = resolve(dataDir, "prices", `${target}.csv`);
    if (!existsSync(targetPath)) {
      missingReferenceTargets.push(target);
      continue;
    }
    referencePrices[target] = loadReferencePrices(targetPath, target);
  }

  const criteriaPath = resolve(dataDir, "criteria.json");
  const criteria = existsSync(criteriaPath)
    ? parseCriteria(readFileSync(criteriaPath, "utf8"), criteriaPath)
    : emptyCriteria();
  const quality = buildDataQualityReport(
    loaded.qualityRecords,
    INSTRUMENTS.map((instrument) => ({
      symbol: instrument,
      firstDate: prices[instrument][0]?.date ?? null,
      lastDate: prices[instrument][prices[instrument].length - 1]?.date ?? null,
    })),
  );

  if (loaded.events.length === 0) {
    console.log(renderDataQualitySection(quality));
    throw new Error(
      `No usable events in ${dataDir}/events.csv (${loaded.skipped.length} rows skipped).`,
    );
  }

  const firstEventDate = loaded.qualityRecords
    .map((record) => record.timestamp)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0]
    .slice(0, 10);
  const report = runBacktest(loaded.events, prices, options, referencePrices, firstEventDate);
  const missingCriteria = criteriaMissingFields(criteria);
  if (
    criteria.inSampleEnd !== null &&
    report.evaluationStartDate !== null &&
    criteria.inSampleEnd < report.evaluationStartDate
  ) {
    throw new CsvError(
      `${criteriaPath}: inSampleEnd (${criteria.inSampleEnd}) is before evaluation start (${report.evaluationStartDate})`,
    );
  }
  const inSample = buildPeriodAnalysis(
    "in-sample",
    report.dailyRows,
    prices,
    referencePrices,
    criteria,
    report.evaluationStartDate,
    criteria.inSampleEnd,
    options.horizons,
  );
  const holdout: PeriodAnalysis | null =
    criteria.inSampleEnd === null
      ? null
      : buildPeriodAnalysis(
          "holdout",
          report.dailyRows,
          prices,
          referencePrices,
          criteria,
          nextDate(criteria.inSampleEnd),
          null,
          options.horizons,
        );
  const releasePrices: ReleasePriceMap = { ...prices, ...referencePrices };
  const releaseDayReaction = evaluateReleaseDayReactions(loaded.events, releasePrices);
  const inSampleCriteriaEvaluations = inSample.criteriaEvaluations;
  const holdoutCriteriaEvaluations = holdout?.criteriaEvaluations ?? [];
  const payload = roundDeep({
    generatedAt: new Date().toISOString(),
    dataDir,
    thresholds: {
      biasDirectionThreshold: BIAS_DIRECTION_THRESHOLD,
      regimeMixedThreshold: REGIME_MIXED_THRESHOLD,
    },
    options: report.options,
    inputs: {
      eventRowsRead: loaded.rowsRead,
      eventsUsed: loaded.events.length,
      eventsSkipped: loaded.skipped.length,
      skipped: loaded.skipped,
      firstEvent: loaded.events[0].timestamp,
      lastEvent: loaded.events[loaded.events.length - 1].timestamp,
      evaluationStartDate: report.evaluationStartDate,
      excludedPriceDaysBeforeStart: report.excludedPriceDaysBeforeStart,
      excludedPriceDaysByInstrument: report.excludedPriceDaysByInstrument,
      prices: Object.fromEntries(
        INSTRUMENTS.map((instrument) => [
          instrument,
          {
            days: prices[instrument].length,
            first: prices[instrument][0]?.date ?? null,
            last: prices[instrument][prices[instrument].length - 1]?.date ?? null,
          },
        ]),
      ),
      referenceTargets: Object.fromEntries(
        REFERENCE_TARGETS.map((target) => {
          const series = referencePrices[target];
          return [
            target,
            {
              days: series?.length ?? null,
              first: series?.[0]?.date ?? null,
              last: series?.[series.length - 1]?.date ?? null,
              missing: series === undefined,
            },
          ];
        }),
      ),
    },
    dataQuality: quality,
    referenceTargetAssumption:
      "The existing USDJPY bias score is used as the US-hawkishness score.",
    referenceTargets: report.referenceTargets,
    criteria: {
      config: criteria,
      missingFields: missingCriteria,
      inSampleEvaluations: inSampleCriteriaEvaluations,
      holdoutEvaluations: holdoutCriteriaEvaluations,
      evaluations: holdoutCriteriaEvaluations,
    },
    periodAnalysis: { inSample, holdout },
    releaseDayReaction,
    warnings: report.warnings,
    daily: report.daily,
    engineStateAtReleaseByIndicator: report.engineStateAtReleaseByIndicator,
    isolatedByIndicator: report.isolatedByIndicator,
    scoreBuckets: report.scoreBuckets,
    mirror: report.mirror,
    dailyRows: report.dailyRows,
    releaseRows: report.releaseRows,
    isolatedReleaseRows: report.isolatedReleaseRows,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    renderSummary({
      report,
      prices,
      dataQuality: quality,
      missingReferenceTargets,
      criteria,
      periodAnalysis: { inSample, holdout },
      releaseDayReaction,
      eventsLoaded: loaded.events.length,
      skipped: loaded.skipped,
      rowsRead: loaded.rowsRead,
      outputPath,
    }),
  );

  if (loaded.skipped.length > 0) {
    console.log("");
    console.log(`skipped ${loaded.skipped.length} event row(s) for missing actual/forecast:`);
    for (const skip of loaded.skipped.slice(0, 10)) {
      console.log(`  line ${skip.lineNumber}  ${skip.id}  (${skip.reason})`);
    }
    if (loaded.skipped.length > 10) console.log(`  ... and ${loaded.skipped.length - 10} more`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n${error instanceof CsvError ? "Data error" : "Backtest failed"}: ${message}\n`);
  if (message.includes("not found")) {
    console.error("Expected layout:");
    console.error("  data/events.csv");
    console.error("  data/prices/XAUUSD.csv");
    console.error("  data/prices/USDJPY.csv");
    console.error("Use --data <dir> to point elsewhere, or run");
    console.error("  npm run sample-data");
    console.error("  npm run backtest -- --data data/sample");
    console.error("to smoke-test the pipeline on clearly-labelled synthetic data.\n");
  }
  process.exitCode = 1;
}
