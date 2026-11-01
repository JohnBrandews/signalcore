import {
  countIndependentScoreRuns,
  DailyRow,
  evaluateReferenceTargets,
  INSTRUMENTS,
  PriceSeriesMap,
  REFERENCE_HORIZONS,
  ReferenceTargetPriceMap,
  scoreBucketReport,
} from "../../src/daily-backtest";
import { MarketInstrument } from "../../src/models";
import {
  CriteriaEvaluation,
  CriteriaFile,
  criteriaMissingFields,
  evaluateCriteria,
} from "./criteria";

export interface PeriodAnalysis {
  label: "in-sample" | "holdout";
  startDate: string | null;
  endDate: string | null;
  evaluationDays: number;
  independentRuns: ReturnType<typeof countIndependentScoreRuns>;
  scoreBuckets: Record<MarketInstrument, ReturnType<typeof scoreBucketReport>[]>;
  referenceTargets: ReturnType<typeof evaluateReferenceTargets>;
  criteriaEvaluations: CriteriaEvaluation[];
}

function periodRows(
  rows: readonly DailyRow[],
  prices: PriceSeriesMap,
  startDate: string | null,
  endDate: string | null,
  horizons: readonly number[],
): DailyRow[] {
  const indexes = new Map(
    INSTRUMENTS.map((instrument) => [
      instrument,
      new Map((prices[instrument] ?? []).map((point, index) => [point.date, index])),
    ]),
  );
  return rows
    .filter(
      (row) =>
        (startDate === null || row.date >= startDate) && (endDate === null || row.date <= endDate),
    )
    .map((row) => {
      const series = prices[row.instrument] ?? [];
      const index = indexes.get(row.instrument)?.get(row.date);
      const forwardReturnPct = { ...row.forwardReturnPct };
      if (index !== undefined && endDate !== null) {
        for (const horizon of horizons) {
          const future = series[index + horizon];
          if (future !== undefined && future.date > endDate) forwardReturnPct[horizon] = null;
        }
      }
      return { ...row, forwardReturnPct };
    });
}

export function buildPeriodAnalysis(
  label: PeriodAnalysis["label"],
  rows: readonly DailyRow[],
  prices: PriceSeriesMap,
  referencePrices: ReferenceTargetPriceMap,
  criteria: CriteriaFile,
  startDate: string | null,
  endDate: string | null,
  horizons: readonly number[],
): PeriodAnalysis {
  const ownRows = periodRows(rows, prices, startDate, endDate, horizons);
  const scoreBuckets = Object.fromEntries(
    INSTRUMENTS.map((instrument) => [
      instrument,
      horizons.map((horizon) =>
        scoreBucketReport(
          ownRows.filter((row) => row.instrument === instrument),
          horizon,
        ),
      ),
    ]),
  ) as PeriodAnalysis["scoreBuckets"];
  const referenceTargets = evaluateReferenceTargets(ownRows, referencePrices, REFERENCE_HORIZONS, {
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
  });
  const criteriaEvaluations =
    criteriaMissingFields(criteria).length === 0
      ? evaluateCriteria(referenceTargets, criteria)
      : [];

  return {
    label,
    startDate,
    endDate,
    evaluationDays: ownRows.filter((row) => row.instrument === "USDJPY").length,
    independentRuns: countIndependentScoreRuns(ownRows),
    scoreBuckets,
    referenceTargets,
    criteriaEvaluations,
  };
}
