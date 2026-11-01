import type { EconomicEvent, EconomicIndicator, MarketInstrument } from "../../models";
import { spearmanRankCorrelation } from "../../daily-backtest";
import type { PricePoint, ReferenceTarget } from "../../daily-backtest";
import { calculateSurprise } from "../../surprise";

export type ReactionTarget = MarketInstrument | ReferenceTarget;
export type ReleaseChangeMeasure = "percent_return" | "percentage_point_change";

export interface ReactionObservation {
  eventId: string;
  indicator: EconomicIndicator;
  date: string;
  directionalSurprise: number;
  normalizedSurprise: number;
  target: ReactionTarget;
  change: number;
  expectedSign: 1 | -1;
  matchesExpectedSign: boolean;
}

export interface ReactionStats {
  n: number;
  expectedSignMatchesPct: number | null;
  averageChangeAfterHawkishSurprises: number | null;
  averageChangeAfterDovishSurprises: number | null;
  spearmanSurpriseChange: number | null;
}

export interface ReleaseReactionGroup {
  indicator: EconomicIndicator;
  target: ReactionTarget;
  measure: ReleaseChangeMeasure;
  expectedHawkishSign: 1 | -1;
  all: ReactionStats;
  byYear: Array<{ year: number; stats: ReactionStats }>;
  largeSurprises: ReactionStats;
  largeSurprisesByYear: Array<{ year: number; stats: ReactionStats }>;
}

export interface ReleaseReactionReport {
  zeroSurprisesExcluded: number;
  missingReleaseDateOrPriorCloseByTarget: Partial<Record<ReactionTarget, number>>;
  observations: ReactionObservation[];
  groups: ReleaseReactionGroup[];
  expectedSigns: Record<ReactionTarget, 1 | -1>;
  note: string;
}

export type ReleasePriceMap = Partial<Record<ReactionTarget, readonly PricePoint[]>>;

export const RELEASE_TARGET_EXPECTED_SIGNS: Record<ReactionTarget, 1 | -1> = {
  DXY: 1,
  USDJPY: 1,
  UST10Y: 1,
  REAL10Y: 1,
  XAUUSD: -1,
};

export function releaseChangeMeasure(target: ReactionTarget): ReleaseChangeMeasure {
  return target === "UST10Y" || target === "REAL10Y" ? "percentage_point_change" : "percent_return";
}

export function calculateReleaseChange(
  previousClose: number,
  releaseDateClose: number,
  measure: ReleaseChangeMeasure,
): number {
  return measure === "percent_return"
    ? (releaseDateClose / previousClose - 1) * 100
    : releaseDateClose - previousClose;
}

export function changeMatchesExpectedSign(
  directionalSurprise: number,
  change: number,
  expectedHawkishSign: 1 | -1,
): boolean {
  if (directionalSurprise === 0 || change === 0) return false;
  return Math.sign(change) === Math.sign(directionalSurprise) * expectedHawkishSign;
}

export function previousTradingDayChange(
  series: readonly PricePoint[],
  releaseDate: string,
  measure: ReleaseChangeMeasure,
): number | null {
  const index = series.findIndex((point) => point.date === releaseDate);
  if (index <= 0) return null;
  return calculateReleaseChange(series[index - 1].close, series[index].close, measure);
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function summarize(observations: readonly ReactionObservation[]): ReactionStats {
  return {
    n: observations.length,
    expectedSignMatchesPct:
      observations.length === 0
        ? null
        : (observations.filter((observation) => observation.matchesExpectedSign).length /
            observations.length) *
          100,
    averageChangeAfterHawkishSurprises: mean(
      observations
        .filter((observation) => observation.directionalSurprise > 0)
        .map((observation) => observation.change),
    ),
    averageChangeAfterDovishSurprises: mean(
      observations
        .filter((observation) => observation.directionalSurprise < 0)
        .map((observation) => observation.change),
    ),
    spearmanSurpriseChange: spearmanRankCorrelation(
      observations.map((observation) => observation.directionalSurprise),
      observations.map((observation) => observation.change),
    ),
  };
}

function byCalendarYear(observations: readonly ReactionObservation[]) {
  const years = new Map<number, ReactionObservation[]>();
  for (const observation of observations) {
    const year = Number(observation.date.slice(0, 4));
    const rows = years.get(year) ?? [];
    rows.push(observation);
    years.set(year, rows);
  }
  return [...years.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, rows]) => ({ year, stats: summarize(rows) }));
}

export function evaluateReleaseDayReactions(
  events: readonly EconomicEvent[],
  seriesByTarget: ReleasePriceMap,
): ReleaseReactionReport {
  const observations: ReactionObservation[] = [];
  const missingReleaseDateOrPriorCloseByTarget: Partial<Record<ReactionTarget, number>> = {};
  let zeroSurprisesExcluded = 0;
  const availableTargets = Object.keys(seriesByTarget) as ReactionTarget[];

  for (const event of events) {
    if (event.actual === undefined || event.forecast === undefined) continue;
    const surprise = calculateSurprise(event);
    if (surprise.directional === 0) {
      zeroSurprisesExcluded += 1;
      continue;
    }
    const date = event.timestamp.slice(0, 10);
    for (const target of availableTargets) {
      const series = seriesByTarget[target];
      if (series === undefined) continue;
      const measure = releaseChangeMeasure(target);
      const change = previousTradingDayChange(series, date, measure);
      if (change === null) {
        missingReleaseDateOrPriorCloseByTarget[target] =
          (missingReleaseDateOrPriorCloseByTarget[target] ?? 0) + 1;
        continue;
      }
      const expectedSign = RELEASE_TARGET_EXPECTED_SIGNS[target];
      observations.push({
        eventId: event.id,
        indicator: event.indicator,
        date,
        directionalSurprise: surprise.directional,
        normalizedSurprise: surprise.normalized,
        target,
        change,
        expectedSign,
        matchesExpectedSign: changeMatchesExpectedSign(surprise.directional, change, expectedSign),
      });
    }
  }

  const keys = new Map<string, { indicator: EconomicIndicator; target: ReactionTarget }>();
  for (const event of events) {
    if (event.actual === undefined || event.forecast === undefined) continue;
    for (const target of availableTargets) {
      keys.set(`${event.indicator}|${target}`, { indicator: event.indicator, target });
    }
  }
  const groups = [...keys.values()]
    .sort(
      (left, right) =>
        left.target.localeCompare(right.target) || left.indicator.localeCompare(right.indicator),
    )
    .map(({ indicator, target }): ReleaseReactionGroup => {
      const own = observations.filter(
        (observation) => observation.indicator === indicator && observation.target === target,
      );
      const largeSurprises = own.filter(
        (observation) => Math.abs(observation.normalizedSurprise) >= 0.5,
      );
      return {
        indicator,
        target,
        measure: releaseChangeMeasure(target),
        expectedHawkishSign: RELEASE_TARGET_EXPECTED_SIGNS[target],
        all: summarize(own),
        byYear: byCalendarYear(own),
        largeSurprises: summarize(largeSurprises),
        largeSurprisesByYear: byCalendarYear(largeSurprises),
      };
    });

  return {
    zeroSurprisesExcluded,
    missingReleaseDateOrPriorCloseByTarget,
    observations,
    groups,
    expectedSigns: RELEASE_TARGET_EXPECTED_SIGNS,
    note: "Daily series are end-of-day or noon values, so release-day changes can include moves unrelated to the release. Small samples are noise. No p-values are reported.",
  };
}
