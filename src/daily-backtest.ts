/**
 * Pure evaluation layer for the historical backtest.
 *
 * No file system, no network, no CSV: it takes already-validated events and
 * price series and returns numbers. `scripts/backtest.ts` owns the I/O.
 *
 * Two independent passes are produced:
 *   1. `evaluateDaily`    — the engine is snapshotted at EVERY trading day's
 *                           close, so time decay actually shows up.
 *   2. `evaluateReleases` — the engine is snapshotted at each release
 *                           timestamp, so results can be attributed per
 *                           indicator.
 */

import { MacroEngine } from "./engine";
import { BiasDirection, EconomicEvent, EconomicIndicator, MarketInstrument } from "./models";

export const INSTRUMENTS: MarketInstrument[] = ["XAUUSD", "USDJPY"];

const BIAS_DIRECTIONS: BiasDirection[] = ["BULLISH", "BEARISH", "NEUTRAL"];

/**
 * Below this many *independent* calls, a hit rate is noise. 30 is a convention,
 * not a significance test: even at 30 the confidence interval on a hit rate is
 * roughly +/- 18 percentage points.
 */
export const MIN_INDEPENDENT_CALLS = 30;

export interface PricePoint {
  date: string;
  close: number;
}

export type PriceSeriesMap = Record<MarketInstrument, PricePoint[]>;

export interface BacktestOptions {
  /**
   * UTC hour treated as "the close" of a dated price bar. Daily FX/metal bars
   * are conventionally stamped at the 17:00 New York close, which is 21:00 or
   * 22:00 UTC depending on daylight saving. 21:00 is used as a fixed default;
   * it only matters for same-day releases, which are all earlier than this.
   */
  dailyCloseHourUtc: number;
  /** Forward-return horizons, in trading days. */
  horizons: number[];
}

export const DEFAULT_OPTIONS: BacktestOptions = { dailyCloseHourUtc: 21, horizons: [5, 20] };

export interface DailyRow {
  date: string;
  asOf: string;
  instrument: MarketInstrument;
  close: number;
  direction: BiasDirection;
  score: number;
  netScore: number;
  agreement: number;
  confidence: number;
  /** How many releases the engine could see at this close. */
  eventsVisible: number;
  /** Horizon (trading days) -> forward return in percent. `null` = not enough forward data. */
  forwardReturnPct: Record<number, number | null>;
  /** True on the first day of each run of identical directions, including the very first day. */
  isDirectionChange: boolean;
}

export interface ReleaseRow {
  eventId: string;
  indicator: EconomicIndicator;
  timestamp: string;
  instrument: MarketInstrument;
  /** First trading day whose close falls at or after the release. */
  anchorDate: string;
  direction: BiasDirection;
  score: number;
  netScore: number;
  confidence: number;
  forwardReturnPct: Record<number, number | null>;
}

export interface GroupStats {
  samples: number;
  counts: Record<BiasDirection, number>;
  hitRateBullishPct: number | null;
  hitRateBearishPct: number | null;
  /** BULLISH and BEARISH combined; NEUTRAL excluded. */
  hitRateDirectionalPct: number | null;
  avgForwardReturnPct: Record<BiasDirection, number | null>;
}

export interface Baseline {
  label: string;
  samples: number;
  /** Share of all sampled days with a positive forward return: the "always BULLISH" hit rate. */
  alwaysBullishHitRatePct: number | null;
  avgForwardReturnPct: number | null;
}

export interface HorizonReport {
  horizonDays: number;
  everyDay: GroupStats;
  onDirectionChange: GroupStats;
  baseline: Baseline;
  independentCalls: {
    total: number;
    directional: number;
    note: string;
  };
  /** Directional hit rate minus the baseline. Positive means it beat "always bullish". */
  edgeVsBaselinePct: number | null;
  lowSampleWarning: string | null;
}

export interface InstrumentReport {
  instrument: MarketInstrument;
  evaluationDays: number;
  firstDate: string | null;
  lastDate: string | null;
  neutralSharePct: number | null;
  exactZeroScoreSharePct: number | null;
  horizons: HorizonReport[];
}

export interface IndicatorHorizonReport {
  horizonDays: number;
  releases: number;
  stats: GroupStats;
  baseline: Baseline;
  lowSampleWarning: string | null;
}

export interface IndicatorReport {
  indicator: EconomicIndicator;
  instrument: MarketInstrument;
  horizons: IndicatorHorizonReport[];
}

export interface ScoreBucket {
  label: string;
  minScore: number;
  maxScore: number;
  days: number;
  averageForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
  positiveForwardReturnPct: number | null;
}

export interface ScoreBucketReport {
  horizonDays: number;
  requestedBuckets: number;
  buckets: ScoreBucket[];
  distinctScores: number;
  bucketCountNote: string | null;
  neutralSharePct: number | null;
  exactZeroScoreSharePct: number | null;
  averageReturnMonotonicallyRises: boolean | null;
  topBottomAverageReturnSpreadPct: number | null;
  spearmanScoreForwardReturn: number | null;
  note: string;
}

export type ReferenceTarget = "DXY" | "REAL10Y" | "UST10Y";

export type ReferenceTargetMeasure =
  "forward_percent_return" | "forward_absolute_change_percentage_points";

export interface ReferenceTargetBucket {
  label: string;
  minScore: number;
  maxScore: number;
  days: number;
  averageForwardValue: number | null;
  medianForwardValue: number | null;
  positiveForwardValuePct: number | null;
}

export interface YearlySpearmanReport {
  year: number;
  days: number;
  spearmanScoreForwardValue: number | null;
}

export interface ReferenceTargetHorizonReport {
  horizonDays: number;
  buckets: ReferenceTargetBucket[];
  distinctScores: number;
  bucketCountNote: string | null;
  neutralSharePct: number | null;
  exactZeroScoreSharePct: number | null;
  averageValueMonotonicallyRises: boolean | null;
  topBottomAverageValueSpread: number | null;
  spearmanScoreForwardValue: number | null;
  yearlySpearman: YearlySpearmanReport[];
}

export interface ReferenceTargetReport {
  target: ReferenceTarget;
  measure: ReferenceTargetMeasure;
  evaluationDays: number;
  firstDate: string | null;
  lastDate: string | null;
  neutralSharePct: number | null;
  exactZeroScoreSharePct: number | null;
  horizons: ReferenceTargetHorizonReport[];
}

export interface MirrorReport {
  matchedDays: number;
  scoreCorrelation: number | null;
  exactOppositeBiasDays: number;
  exactOppositeBiasSharePct: number | null;
  note: string;
}

export interface BacktestReport {
  options: BacktestOptions;
  evaluationStartDate: string | null;
  excludedPriceDaysBeforeStart: number;
  excludedPriceDaysByInstrument: Record<MarketInstrument, number>;
  daily: InstrumentReport[];
  engineStateAtReleaseByIndicator: IndicatorReport[];
  isolatedByIndicator: IndicatorReport[];
  scoreBuckets: Record<MarketInstrument, ScoreBucketReport[]>;
  referenceTargets: ReferenceTargetReport[];
  mirror: MirrorReport;
  warnings: string[];
  dailyRows: DailyRow[];
  releaseRows: ReleaseRow[];
  isolatedReleaseRows: ReleaseRow[];
}

export type ReferenceTargetPriceMap = Partial<Record<ReferenceTarget, PricePoint[]>>;

export interface EvaluationDateBounds {
  startDate?: string;
  endDate?: string;
}

export const REFERENCE_TARGETS: ReferenceTarget[] = ["DXY", "REAL10Y", "UST10Y"];
export const REFERENCE_HORIZONS = [5, 20];

export function calculateTargetForwardValue(
  current: number,
  future: number,
  measure: ReferenceTargetMeasure,
): number {
  return measure === "forward_percent_return" ? (future / current - 1) * 100 : future - current;
}

interface TargetEvaluationPoint {
  date: string;
  score: number;
  direction: BiasDirection;
  forwardValue: number | null;
}

export function yearlySpearmanBreakdown(
  points: readonly TargetEvaluationPoint[],
): YearlySpearmanReport[] {
  const byYear = new Map<number, TargetEvaluationPoint[]>();
  for (const point of points) {
    if (point.forwardValue === null) continue;
    const year = Number(point.date.slice(0, 4));
    const rows = byYear.get(year) ?? [];
    rows.push(point);
    byYear.set(year, rows);
  }
  return [...byYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, rows]) => ({
      year,
      days: rows.length,
      spearmanScoreForwardValue: spearmanRankCorrelation(
        rows.map((row) => row.score),
        rows.map((row) => row.forwardValue!),
      ),
    }));
}

function referenceTargetHorizonReport(
  points: readonly TargetEvaluationPoint[],
  horizonDays: number,
): ReferenceTargetHorizonReport {
  const usable = points.filter((point) => point.forwardValue !== null);
  const distinctScores = new Set(usable.map((point) => point.score)).size;
  const requestedBuckets = 5;
  const bucketCount = Math.min(requestedBuckets, distinctScores);
  const groups: TargetEvaluationPoint[][] = [];
  for (const point of [...usable].sort((left, right) => left.score - right.score)) {
    const previous = groups[groups.length - 1];
    if (previous && previous[0].score === point.score) previous.push(point);
    else groups.push([point]);
  }

  const bucketRows: TargetEvaluationPoint[][] = Array.from({ length: bucketCount }, () => []);
  let seen = 0;
  for (const group of groups) {
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor(((seen + group.length / 2) / usable.length) * bucketCount),
    );
    bucketRows[bucket].push(...group);
    seen += group.length;
  }

  const meanValue = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const medianValue = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
  };
  const buckets = bucketRows
    .filter((bucket) => bucket.length > 0)
    .map((bucket, index, all): ReferenceTargetBucket => {
      const values = bucket.map((point) => point.forwardValue!);
      return {
        label:
          all.length === 1
            ? "all scores"
            : index === 0
              ? "lowest scores"
              : index === all.length - 1
                ? "highest scores"
                : `score bucket ${index + 1} of ${all.length}`,
        minScore: bucket[0].score,
        maxScore: bucket[bucket.length - 1].score,
        days: bucket.length,
        averageForwardValue: meanValue(values),
        medianForwardValue: medianValue(values),
        positiveForwardValuePct:
          values.length === 0
            ? null
            : (values.filter((value) => value > 0).length / values.length) * 100,
      };
    });
  const averages = buckets.map((bucket) => bucket.averageForwardValue);

  return {
    horizonDays,
    buckets,
    distinctScores,
    bucketCountNote:
      bucketCount < requestedBuckets
        ? `Only ${distinctScores} distinct score value(s), so ${bucketCount} bucket(s) are used.`
        : null,
    neutralSharePct:
      usable.length === 0
        ? null
        : (usable.filter((point) => point.direction === "NEUTRAL").length / usable.length) * 100,
    exactZeroScoreSharePct:
      usable.length === 0
        ? null
        : (usable.filter((point) => point.score === 0).length / usable.length) * 100,
    averageValueMonotonicallyRises:
      averages.length < 2 || averages.some((value) => value === null)
        ? null
        : averages.every((value, index) => index === 0 || value! >= averages[index - 1]!),
    topBottomAverageValueSpread:
      buckets.length < 2
        ? null
        : buckets[buckets.length - 1].averageForwardValue! - buckets[0].averageForwardValue!,
    spearmanScoreForwardValue: spearmanRankCorrelation(
      usable.map((point) => point.score),
      usable.map((point) => point.forwardValue!),
    ),
    yearlySpearman: yearlySpearmanBreakdown(usable),
  };
}

export function evaluateReferenceTargets(
  usdJpyRows: readonly DailyRow[],
  targetPrices: ReferenceTargetPriceMap,
  horizons: readonly number[] = REFERENCE_HORIZONS,
  bounds: EvaluationDateBounds = {},
): ReferenceTargetReport[] {
  const scoreByDate = new Map(
    usdJpyRows
      .filter(
        (row) =>
          row.instrument === "USDJPY" &&
          (bounds.startDate === undefined || row.date >= bounds.startDate) &&
          (bounds.endDate === undefined || row.date <= bounds.endDate),
      )
      .map((row) => [row.date, row]),
  );
  const reports: ReferenceTargetReport[] = [];

  for (const target of REFERENCE_TARGETS) {
    const series = targetPrices[target];
    if (series === undefined) continue;
    const measure: ReferenceTargetMeasure =
      target === "DXY" ? "forward_percent_return" : "forward_absolute_change_percentage_points";
    const points = series.flatMap((point, index) => {
      const score = scoreByDate.get(point.date);
      if (score === undefined) return [];
      return [
        {
          date: point.date,
          score: score.score,
          direction: score.direction,
          forwardValues: Object.fromEntries(
            horizons.map((horizon) => {
              const future = series[index + horizon];
              return [
                horizon,
                future === undefined ||
                (bounds.endDate !== undefined && future.date > bounds.endDate)
                  ? null
                  : calculateTargetForwardValue(point.close, future.close, measure),
              ];
            }),
          ) as Record<number, number | null>,
        },
      ];
    });

    reports.push({
      target,
      measure,
      evaluationDays: points.length,
      firstDate: points[0]?.date ?? null,
      lastDate: points[points.length - 1]?.date ?? null,
      neutralSharePct:
        points.length === 0
          ? null
          : (points.filter((point) => point.direction === "NEUTRAL").length / points.length) * 100,
      exactZeroScoreSharePct:
        points.length === 0
          ? null
          : (points.filter((point) => point.score === 0).length / points.length) * 100,
      horizons: horizons.map((horizon) =>
        referenceTargetHorizonReport(
          points.map((point) => ({
            date: point.date,
            score: point.score,
            direction: point.direction,
            forwardValue: point.forwardValues[horizon],
          })),
          horizon,
        ),
      ),
    });
  }

  return reports;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function closeTimestamp(date: string, hourUtc: number): string {
  return `${date}T${String(hourUtc).padStart(2, "0")}:00:00Z`;
}

const byTimestamp = (a: EconomicEvent, b: EconomicEvent) =>
  Date.parse(a.timestamp) - Date.parse(b.timestamp);

const percentOf = (hits: number, total: number): number | null =>
  total === 0 ? null : (hits / total) * 100;

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, v) => total + v, 0) / values.length;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

/** Average ranks preserve ties, as required by Spearman's rank correlation. */
function ranks(values: number[]): number[] {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  let start = 0;
  while (start < ordered.length) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) result[ordered[index].index] = averageRank;
    start = end;
  }
  return result;
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left)!;
  const rightMean = mean(right)!;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta * leftDelta;
    rightSquares += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator === 0 ? null : numerator / denominator;
}

export function spearmanRankCorrelation(left: number[], right: number[]): number | null {
  return pearson(ranks(left), ranks(right));
}

const forwardReturns = (
  series: PricePoint[],
  index: number,
  horizons: number[],
): Record<number, number | null> => {
  const result: Record<number, number | null> = {};
  for (const horizon of horizons) {
    const future = series[index + horizon];
    result[horizon] = future === undefined ? null : (future.close / series[index].close - 1) * 100;
  }
  return result;
};

interface Scored {
  direction: BiasDirection;
  forward: number;
}

function summarise(scored: Scored[]): GroupStats {
  const counts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 } as Record<BiasDirection, number>;
  for (const row of scored) counts[row.direction] += 1;

  const bullish = scored.filter((row) => row.direction === "BULLISH");
  const bearish = scored.filter((row) => row.direction === "BEARISH");
  const bullishHits = bullish.filter((row) => row.forward > 0).length;
  const bearishHits = bearish.filter((row) => row.forward < 0).length;
  const directional = bullish.length + bearish.length;

  const avgForwardReturnPct = {} as Record<BiasDirection, number | null>;
  for (const direction of BIAS_DIRECTIONS) {
    avgForwardReturnPct[direction] = mean(
      scored.filter((row) => row.direction === direction).map((row) => row.forward),
    );
  }

  return {
    samples: scored.length,
    counts,
    hitRateBullishPct: percentOf(bullishHits, bullish.length),
    hitRateBearishPct: percentOf(bearishHits, bearish.length),
    hitRateDirectionalPct: percentOf(bullishHits + bearishHits, directional),
    avgForwardReturnPct,
  };
}

function baselineOf(scored: Scored[], label: string): Baseline {
  return {
    label,
    samples: scored.length,
    alwaysBullishHitRatePct: percentOf(
      scored.filter((row) => row.forward > 0).length,
      scored.length,
    ),
    avgForwardReturnPct: mean(scored.map((row) => row.forward)),
  };
}

// ---------------------------------------------------------------------------
// pass 1: every trading day
// ---------------------------------------------------------------------------

export function evaluateDaily(
  events: EconomicEvent[],
  prices: PriceSeriesMap,
  options: BacktestOptions = DEFAULT_OPTIONS,
  evaluationStartDate?: string,
): DailyRow[] {
  const sortedEvents = [...events].sort(byTimestamp);
  const engine = new MacroEngine();
  let cursor = 0;

  const indexByDate = new Map<MarketInstrument, Map<string, number>>();
  const dates = new Set<string>();
  for (const instrument of INSTRUMENTS) {
    const lookup = new Map<string, number>();
    (prices[instrument] ?? []).forEach((point, index) => {
      lookup.set(point.date, index);
      dates.add(point.date);
    });
    indexByDate.set(instrument, lookup);
  }

  const previousDirection = new Map<MarketInstrument, BiasDirection>();
  const rows: DailyRow[] = [];

  for (const date of [...dates].sort()) {
    if (evaluationStartDate !== undefined && date < evaluationStartDate) continue;
    const asOf = closeTimestamp(date, options.dailyCloseHourUtc);
    const cutoff = Date.parse(asOf);

    // The only place events enter the engine. The cursor never rewinds and
    // never crosses `cutoff`, so a later release cannot reach an earlier day.
    while (cursor < sortedEvents.length && Date.parse(sortedEvents[cursor].timestamp) <= cutoff) {
      engine.process(sortedEvents[cursor]);
      cursor += 1;
    }

    const snapshot = engine.snapshot(asOf);

    for (const instrument of INSTRUMENTS) {
      const series = prices[instrument] ?? [];
      const index = indexByDate.get(instrument)!.get(date);
      if (index === undefined) continue;

      const bias = snapshot.biases[instrument];
      const prior = previousDirection.get(instrument);
      rows.push({
        date,
        asOf,
        instrument,
        close: series[index].close,
        direction: bias.direction,
        score: bias.score,
        netScore: bias.netScore,
        agreement: bias.agreement,
        confidence: bias.confidence,
        eventsVisible: cursor,
        forwardReturnPct: forwardReturns(series, index, options.horizons),
        isDirectionChange: prior === undefined || prior !== bias.direction,
      });
      previousDirection.set(instrument, bias.direction);
    }
  }

  return rows;
}

function instrumentReport(
  instrument: MarketInstrument,
  rows: DailyRow[],
  options: BacktestOptions,
): InstrumentReport {
  const own = rows.filter((row) => row.instrument === instrument);

  const horizons = options.horizons.map((horizon): HorizonReport => {
    const usable = own.filter((row) => row.forwardReturnPct[horizon] !== null);
    const scored = usable.map((row) => ({
      direction: row.direction,
      forward: row.forwardReturnPct[horizon] as number,
    }));
    const changes = usable.filter((row) => row.isDirectionChange);
    const changeScored = changes.map((row) => ({
      direction: row.direction,
      forward: row.forwardReturnPct[horizon] as number,
    }));

    const directionalCalls = changes.filter((row) => row.direction !== "NEUTRAL").length;
    const everyDay = summarise(scored);
    const baseline = baselineOf(scored, "always BULLISH (every evaluation day)");
    const edge =
      everyDay.hitRateDirectionalPct === null || baseline.alwaysBullishHitRatePct === null
        ? null
        : everyDay.hitRateDirectionalPct - baseline.alwaysBullishHitRatePct;

    return {
      horizonDays: horizon,
      everyDay,
      onDirectionChange: summarise(changeScored),
      baseline,
      independentCalls: {
        total: changes.length,
        directional: directionalCalls,
        note:
          "A 'call' is one unbroken run of the same bias direction. Daily rows inside a run " +
          "are the same call re-counted, and their forward windows overlap, so only these " +
          "runs are an honest sample size.",
      },
      edgeVsBaselinePct: edge,
      lowSampleWarning:
        directionalCalls < MIN_INDEPENDENT_CALLS
          ? `Only ${directionalCalls} independent directional call(s) at ${horizon}d ` +
            `(< ${MIN_INDEPENDENT_CALLS}). Treat every hit rate below as noise.`
          : null,
    };
  });

  return {
    instrument,
    evaluationDays: own.length,
    firstDate: own.length > 0 ? own[0].date : null,
    lastDate: own.length > 0 ? own[own.length - 1].date : null,
    neutralSharePct:
      own.length === 0
        ? null
        : (own.filter((row) => row.direction === "NEUTRAL").length / own.length) * 100,
    exactZeroScoreSharePct:
      own.length === 0 ? null : (own.filter((row) => row.score === 0).length / own.length) * 100,
    horizons,
  };
}

export interface IndependentRunCount {
  totalRuns: number;
  directionalRuns: number;
}

export function countIndependentScoreRuns(
  rows: readonly DailyRow[],
): Record<MarketInstrument, IndependentRunCount> {
  return Object.fromEntries(
    INSTRUMENTS.map((instrument) => {
      const own = rows
        .filter((row) => row.instrument === instrument)
        .sort((left, right) => left.date.localeCompare(right.date));
      let totalRuns = 0;
      let directionalRuns = 0;
      let previous: BiasDirection | undefined;
      for (const row of own) {
        if (previous === undefined || previous !== row.direction) {
          totalRuns += 1;
          if (row.direction !== "NEUTRAL") directionalRuns += 1;
        }
        previous = row.direction;
      }
      return [instrument, { totalRuns, directionalRuns }];
    }),
  ) as Record<MarketInstrument, IndependentRunCount>;
}

// ---------------------------------------------------------------------------
// pass 2: per release, attributed to the indicator
// ---------------------------------------------------------------------------

function closeTimestamps(series: PricePoint[], hourUtc: number): number[] {
  return series.map((point) => Date.parse(closeTimestamp(point.date, hourUtc)));
}

/** First index whose close lands at or after `eventTime`; `null` if the release is past the data. */
function anchorIndex(closes: number[], eventTime: number): number | null {
  let low = 0;
  let high = closes.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (closes[mid] >= eventTime) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return found;
}

export function evaluateReleases(
  events: EconomicEvent[],
  prices: PriceSeriesMap,
  options: BacktestOptions = DEFAULT_OPTIONS,
): ReleaseRow[] {
  const sortedEvents = [...events].sort(byTimestamp);
  const engine = new MacroEngine();
  let cursor = 0;

  const closes = new Map<MarketInstrument, number[]>();
  for (const instrument of INSTRUMENTS) {
    closes.set(instrument, closeTimestamps(prices[instrument] ?? [], options.dailyCloseHourUtc));
  }

  const rows: ReleaseRow[] = [];

  for (const event of sortedEvents) {
    const eventTime = Date.parse(event.timestamp);
    // Admit every release stamped at or before this one, so simultaneous
    // releases (CPI and core CPI) are both visible to the snapshot.
    while (
      cursor < sortedEvents.length &&
      Date.parse(sortedEvents[cursor].timestamp) <= eventTime
    ) {
      engine.process(sortedEvents[cursor]);
      cursor += 1;
    }
    const snapshot = engine.snapshot(event.timestamp);

    for (const instrument of INSTRUMENTS) {
      const series = prices[instrument] ?? [];
      const index = anchorIndex(closes.get(instrument)!, eventTime);
      if (index === null) continue;

      const bias = snapshot.biases[instrument];
      rows.push({
        eventId: event.id,
        indicator: event.indicator,
        timestamp: event.timestamp,
        instrument,
        anchorDate: series[index].date,
        direction: bias.direction,
        score: bias.score,
        netScore: bias.netScore,
        confidence: bias.confidence,
        forwardReturnPct: forwardReturns(series, index, options.horizons),
      });
    }
  }

  return rows;
}

/**
 * Replays one indicator at a time, deliberately excluding every other release
 * from each snapshot. This is distinct from `evaluateReleases`, which reports
 * the full engine state present when a release arrived.
 */
export function evaluateIsolatedReleases(
  events: EconomicEvent[],
  prices: PriceSeriesMap,
  options: BacktestOptions = DEFAULT_OPTIONS,
): ReleaseRow[] {
  const rows: ReleaseRow[] = [];
  const indicators = [...new Set(events.map((event) => event.indicator))].sort();
  const closes = new Map<MarketInstrument, number[]>();
  for (const instrument of INSTRUMENTS) {
    closes.set(instrument, closeTimestamps(prices[instrument] ?? [], options.dailyCloseHourUtc));
  }

  for (const indicator of indicators) {
    const engine = new MacroEngine();
    const ownEvents = events.filter((event) => event.indicator === indicator).sort(byTimestamp);
    for (const event of ownEvents) {
      engine.process(event);
      const snapshot = engine.snapshot(event.timestamp);
      for (const instrument of INSTRUMENTS) {
        const series = prices[instrument] ?? [];
        const index = anchorIndex(closes.get(instrument)!, Date.parse(event.timestamp));
        if (index === null) continue;
        const bias = snapshot.biases[instrument];
        rows.push({
          eventId: event.id,
          indicator: event.indicator,
          timestamp: event.timestamp,
          instrument,
          anchorDate: series[index].date,
          direction: bias.direction,
          score: bias.score,
          netScore: bias.netScore,
          confidence: bias.confidence,
          forwardReturnPct: forwardReturns(series, index, options.horizons),
        });
      }
    }
  }
  return rows;
}

function indicatorReports(rows: ReleaseRow[], options: BacktestOptions): IndicatorReport[] {
  const keys = new Map<string, { indicator: EconomicIndicator; instrument: MarketInstrument }>();
  for (const row of rows) {
    keys.set(`${row.indicator}|${row.instrument}`, {
      indicator: row.indicator,
      instrument: row.instrument,
    });
  }

  return [...keys.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, key]) => {
      const own = rows.filter(
        (row) => row.indicator === key.indicator && row.instrument === key.instrument,
      );
      return {
        indicator: key.indicator,
        instrument: key.instrument,
        horizons: options.horizons.map((horizon): IndicatorHorizonReport => {
          const scored = own
            .filter((row) => row.forwardReturnPct[horizon] !== null)
            .map((row) => ({
              direction: row.direction,
              forward: row.forwardReturnPct[horizon] as number,
            }));
          return {
            horizonDays: horizon,
            releases: scored.length,
            stats: summarise(scored),
            baseline: baselineOf(scored, "always BULLISH (every release of this indicator)"),
            lowSampleWarning:
              scored.length < MIN_INDEPENDENT_CALLS
                ? `Only ${scored.length} release(s) at ${horizon}d ` +
                  `(< ${MIN_INDEPENDENT_CALLS}).`
                : null,
          };
        }),
      };
    });
}

export function scoreBucketReport(
  rows: readonly DailyRow[],
  horizon: number,
  requestedBuckets = 5,
): ScoreBucketReport {
  const usable = rows
    .filter((row) => row.forwardReturnPct[horizon] !== null)
    .map((row) => ({
      score: row.score,
      forward: row.forwardReturnPct[horizon] as number,
      direction: row.direction,
    }))
    .sort((a, b) => a.score - b.score);
  const distinctScores = new Set(usable.map((row) => row.score)).size;
  const bucketCount = Math.min(requestedBuckets, distinctScores);
  const groups: Array<typeof usable> = [];
  for (const row of usable) {
    const previous = groups[groups.length - 1];
    if (previous && previous[0].score === row.score) previous.push(row);
    else groups.push([row]);
  }
  const bucketRows: Array<typeof usable> = Array.from({ length: bucketCount }, () => []);
  let seen = 0;
  for (const group of groups) {
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor(((seen + group.length / 2) / usable.length) * bucketCount),
    );
    bucketRows[bucket].push(...group);
    seen += group.length;
  }
  const buckets = bucketRows
    .filter((bucket) => bucket.length > 0)
    .map((bucket, index, all): ScoreBucket => ({
      label:
        all.length === 1
          ? "all scores"
          : index === 0
            ? "strongly bearish"
            : index === all.length - 1
              ? "strongly bullish"
              : `score bucket ${index + 1} of ${all.length}`,
      minScore: bucket[0].score,
      maxScore: bucket[bucket.length - 1].score,
      days: bucket.length,
      averageForwardReturnPct: mean(bucket.map((row) => row.forward)),
      medianForwardReturnPct: median(bucket.map((row) => row.forward)),
      positiveForwardReturnPct: percentOf(
        bucket.filter((row) => row.forward > 0).length,
        bucket.length,
      ),
    }));
  const averages = buckets.map((bucket) => bucket.averageForwardReturnPct);
  const monotonic =
    averages.length < 2 || averages.some((value) => value === null)
      ? null
      : averages.every((value, index) => index === 0 || value! >= averages[index - 1]!);
  return {
    horizonDays: horizon,
    requestedBuckets,
    buckets,
    distinctScores,
    bucketCountNote:
      bucketCount < requestedBuckets
        ? `Only ${distinctScores} distinct score value(s), so ${bucketCount} bucket(s) are used.`
        : null,
    neutralSharePct: percentOf(
      usable.filter((row) => row.direction === "NEUTRAL").length,
      usable.length,
    ),
    exactZeroScoreSharePct: percentOf(
      usable.filter((row) => row.score === 0).length,
      usable.length,
    ),
    averageReturnMonotonicallyRises: monotonic,
    topBottomAverageReturnSpreadPct:
      buckets.length < 2
        ? null
        : buckets[buckets.length - 1].averageForwardReturnPct! -
          buckets[0].averageForwardReturnPct!,
    spearmanScoreForwardReturn: spearmanRankCorrelation(
      usable.map((row) => row.score),
      usable.map((row) => row.forward),
    ),
    note: "Evaluation-day windows overlap, so days are non-independent and correlation precision is overstated. No p-values are reported.",
  };
}

function mirrorReport(rows: DailyRow[]): MirrorReport {
  const gold = new Map(
    rows.filter((row) => row.instrument === "XAUUSD").map((row) => [row.date, row]),
  );
  const pairs = rows
    .filter((row) => row.instrument === "USDJPY")
    .map((yen) => ({ gold: gold.get(yen.date), yen }))
    .filter((pair): pair is { gold: DailyRow; yen: DailyRow } => pair.gold !== undefined);
  const opposite = pairs.filter(
    ({ gold: goldRow, yen }) =>
      (goldRow.direction === "BULLISH" && yen.direction === "BEARISH") ||
      (goldRow.direction === "BEARISH" && yen.direction === "BULLISH"),
  ).length;
  return {
    matchedDays: pairs.length,
    scoreCorrelation: pearson(
      pairs.map((pair) => pair.gold.score),
      pairs.map((pair) => pair.yen.score),
    ),
    exactOppositeBiasDays: opposite,
    exactOppositeBiasSharePct: percentOf(opposite, pairs.length),
    note: "Exact opposite means one bias is BULLISH and the other is BEARISH; any NEUTRAL day is not opposite.",
  };
}

// ---------------------------------------------------------------------------
// top level
// ---------------------------------------------------------------------------

export function runBacktest(
  events: EconomicEvent[],
  prices: PriceSeriesMap,
  options: BacktestOptions = DEFAULT_OPTIONS,
  referenceTargetPrices: ReferenceTargetPriceMap = {},
  requestedEvaluationStartDate?: string,
): BacktestReport {
  const earliestEventTimestamp =
    events.length === 0 ? null : [...events].sort(byTimestamp)[0].timestamp;
  const evaluationStartDate =
    requestedEvaluationStartDate ?? earliestEventTimestamp?.slice(0, 10) ?? null;
  const allPriceDates = new Set(
    INSTRUMENTS.flatMap((instrument) => (prices[instrument] ?? []).map((point) => point.date)),
  );
  const excludedPriceDaysByInstrument = Object.fromEntries(
    INSTRUMENTS.map((instrument) => [
      instrument,
      (prices[instrument] ?? []).filter(
        (point) => evaluationStartDate !== null && point.date < evaluationStartDate,
      ).length,
    ]),
  ) as Record<MarketInstrument, number>;
  const excludedPriceDaysBeforeStart =
    evaluationStartDate === null
      ? 0
      : [...allPriceDates].filter((date) => date < evaluationStartDate).length;
  const dailyRows = evaluateDaily(events, prices, options, evaluationStartDate ?? undefined);
  const releaseRows = evaluateReleases(events, prices, options);
  const isolatedReleaseRows = evaluateIsolatedReleases(events, prices, options);
  const daily = INSTRUMENTS.map((instrument) => instrumentReport(instrument, dailyRows, options));
  const engineStateAtReleaseByIndicator = indicatorReports(releaseRows, options);
  const isolatedByIndicator = indicatorReports(isolatedReleaseRows, options);
  const scoreBuckets = Object.fromEntries(
    INSTRUMENTS.map((instrument) => [
      instrument,
      options.horizons.map((horizon) =>
        scoreBucketReport(
          dailyRows.filter((row) => row.instrument === instrument),
          horizon,
        ),
      ),
    ]),
  ) as Record<MarketInstrument, ScoreBucketReport[]>;
  const referenceTargets = evaluateReferenceTargets(
    dailyRows,
    referenceTargetPrices,
    REFERENCE_HORIZONS,
  );
  const mirror = mirrorReport(dailyRows);

  const warnings: string[] = [];
  for (const report of daily) {
    for (const horizon of report.horizons) {
      if (horizon.lowSampleWarning) {
        warnings.push(`${report.instrument} ${horizon.horizonDays}d: ${horizon.lowSampleWarning}`);
      }
    }
  }
  for (const report of [...engineStateAtReleaseByIndicator, ...isolatedByIndicator]) {
    for (const horizon of report.horizons) {
      if (horizon.lowSampleWarning) {
        warnings.push(
          `${report.indicator} / ${report.instrument} ${horizon.horizonDays}d: ${horizon.lowSampleWarning}`,
        );
      }
    }
  }

  return {
    options,
    evaluationStartDate,
    excludedPriceDaysBeforeStart,
    excludedPriceDaysByInstrument,
    daily,
    engineStateAtReleaseByIndicator,
    isolatedByIndicator,
    scoreBuckets,
    referenceTargets,
    mirror,
    warnings,
    dailyRows,
    releaseRows,
    isolatedReleaseRows,
  };
}
