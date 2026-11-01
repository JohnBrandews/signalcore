import {
  BacktestReport,
  Baseline,
  GroupStats,
  MIN_INDEPENDENT_CALLS,
  PriceSeriesMap,
} from "../../src/daily-backtest";
import { INSTRUMENTS } from "../../src/daily-backtest";
import { BIAS_DIRECTION_THRESHOLD } from "../../src/config";
import { CriteriaFile, criteriaMissingFields } from "./criteria";
import { DataQualityReport } from "./data-quality";
import { SkippedEvent } from "./load-data";
import { PeriodAnalysis } from "./period-analysis";
import { ReactionStats, ReleaseReactionReport } from "../../src/lib/analysis/release-reaction";

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);
const pct = (value: number | null, digits = 1): string =>
  value === null ? "   n/a" : `${value.toFixed(digits)}%`.padStart(6);
const signedPct = (value: number | null, digits = 2): string =>
  value === null ? "    n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`.padStart(7);
const signedPts = (value: number | null, digits = 1): string =>
  value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)} pts`;
const decimal = (value: number | null, digits = 3): string =>
  value === null ? "n/a" : value.toFixed(digits);

function statsBlock(stats: GroupStats, indent: string): string[] {
  return [
    `${indent}days       BULLISH ${String(stats.counts.BULLISH).padStart(5)}   ` +
      `BEARISH ${String(stats.counts.BEARISH).padStart(5)}   NEUTRAL ${String(stats.counts.NEUTRAL).padStart(5)}`,
    `${indent}hit rate   BULLISH ${pct(stats.hitRateBullishPct)}   BEARISH ${pct(stats.hitRateBearishPct)}   directional ${pct(stats.hitRateDirectionalPct)}`,
    `${indent}avg fwd    BULLISH ${signedPct(stats.avgForwardReturnPct.BULLISH)}  BEARISH ${signedPct(stats.avgForwardReturnPct.BEARISH)}  NEUTRAL ${signedPct(stats.avgForwardReturnPct.NEUTRAL)}`,
  ];
}

function baselineBlock(baseline: Baseline, indent: string): string {
  return `${indent}baseline   always-BULLISH hit rate ${pct(baseline.alwaysBullishHitRatePct)}   avg fwd ${signedPct(baseline.avgForwardReturnPct)}   (n=${baseline.samples})`;
}

function targetValue(value: number | null, unit: string): string {
  return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}${unit}`;
}

function renderCriteria(lines: string[], period: PeriodAnalysis, criteria: CriteriaFile): void {
  const missing = criteriaMissingFields(criteria);
  lines.push("", `  ${period.label.toUpperCase()} CRITERIA`);
  if (missing.length > 0) {
    lines.push(`    not evaluated: criteria incomplete; fill in ${missing.join(", ")}.`);
    return;
  }
  if (period.criteriaEvaluations.length === 0) {
    lines.push("    no configured target/horizon was available to evaluate.");
    return;
  }
  for (const result of period.criteriaEvaluations) {
    const signName = result.expectedSpearmanSign > 0 ? "+1" : "-1";
    const magnitudeMet = result.magnitudeMet ? "MET" : "NOT MET";
    const signMet = result.signMet ? "MET" : "NOT MET";
    const topBottom = result.topBucketMustBeatBottom
      ? `${result.topBottomMet ? "MET" : "NOT MET"} (observed ${targetValue(result.topBottomSpread, result.target === "DXY" ? "%" : " pp")}; required > 0)`
      : "not required";
    lines.push(
      `    ${result.target} ${result.horizonDays}d: Spearman ${decimal(result.observedSpearman)}; expected sign ${signName} ${signMet}; |Spearman| ${decimal(result.observedSpearman)} >= ${result.minimumAbsoluteSpearman.toFixed(3)} ${magnitudeMet}; top-minus-bottom ${topBottom}; overall ${result.passed ? "MET" : "NOT MET"}.`,
    );
  }
}

function renderPeriodAnalysis(
  lines: string[],
  period: PeriodAnalysis,
  criteria: CriteriaFile,
  missingReferenceTargets: string[],
): void {
  const endDate = period.endDate ?? "end of available data";
  lines.push(
    "",
    RULE,
    ` ${period.label.toUpperCase()} ANALYSIS - ${period.startDate ?? "start unavailable"} .. ${endDate}`,
    RULE,
    `  evaluation days: ${period.evaluationDays}; all independent bias-direction runs: USDJPY ${period.independentRuns.USDJPY.totalRuns} total / ${period.independentRuns.USDJPY.directionalRuns} directional.`,
  );

  lines.push("", THIN, ` ${period.label.toUpperCase()} SCORE BUCKETS`, THIN);
  for (const instrument of INSTRUMENTS) {
    const runs = period.independentRuns[instrument];
    lines.push(
      "",
      `${instrument}: ${runs.totalRuns} independent bias-direction run(s), ${runs.directionalRuns} directional`,
    );
    for (const horizon of period.scoreBuckets[instrument]) {
      lines.push(
        `  ${horizon.horizonDays}d; ${horizon.buckets.length} bucket(s), ${horizon.distinctScores} distinct scores; NEUTRAL ${pct(horizon.neutralSharePct)}; exactly-zero score ${pct(horizon.exactZeroScoreSharePct)}`,
      );
      if (horizon.bucketCountNote) lines.push(`    ${horizon.bucketCountNote}`);
      lines.push(
        "    bucket                 score range             n    avg fwd   median   positive",
      );
      for (const bucket of horizon.buckets) {
        lines.push(
          `    ${bucket.label.padEnd(22)} ${bucket.minScore.toFixed(3).padStart(8)} .. ${bucket.maxScore.toFixed(3).padEnd(8)} ${String(bucket.days).padStart(4)}  ${signedPct(bucket.averageForwardReturnPct)}  ${signedPct(bucket.medianForwardReturnPct)}  ${pct(bucket.positiveForwardReturnPct)}`,
        );
      }
      const rises =
        horizon.averageReturnMonotonicallyRises === null
          ? "n/a"
          : horizon.averageReturnMonotonicallyRises
            ? "yes"
            : "no";
      lines.push(
        `    average return rises lowest-to-highest: ${rises}; top-minus-bottom spread ${signedPct(horizon.topBottomAverageReturnSpreadPct)}; Spearman(score, forward return) ${decimal(horizon.spearmanScoreForwardReturn)}`,
      );
    }
  }

  lines.push(
    "",
    THIN,
    ` ${period.label.toUpperCase()} REFERENCE TARGETS - USDJPY bias score used as US-hawkishness proxy`,
    THIN,
    "Assumption: use the existing USDJPY score as the US-hawkishness score; it is a proxy, not a separate score.",
  );
  for (const target of missingReferenceTargets) {
    lines.push(`  SKIP ${target}: optional series file missing.`);
  }
  for (const target of period.referenceTargets) {
    const unit = target.measure === "forward_percent_return" ? "%" : " pp";
    lines.push(
      "",
      `${target.target}: ${target.evaluationDays} aligned days; NEUTRAL ${pct(target.neutralSharePct)}; exactly-zero score ${pct(target.exactZeroScoreSharePct)}; USDJPY runs ${period.independentRuns.USDJPY.totalRuns} total / ${period.independentRuns.USDJPY.directionalRuns} directional`,
    );
    for (const horizon of target.horizons) {
      lines.push(
        `  ${horizon.horizonDays}d; NEUTRAL ${pct(horizon.neutralSharePct)}; exactly-zero score ${pct(horizon.exactZeroScoreSharePct)}; ${horizon.buckets.length} bucket(s), ${horizon.distinctScores} distinct scores`,
      );
      if (horizon.bucketCountNote) lines.push(`    ${horizon.bucketCountNote}`);
      lines.push(
        "    bucket                 score range             n    avg fwd   median   positive",
      );
      for (const bucket of horizon.buckets) {
        lines.push(
          `    ${bucket.label.padEnd(22)} ${bucket.minScore.toFixed(3).padStart(8)} .. ${bucket.maxScore.toFixed(3).padEnd(8)} ${String(bucket.days).padStart(4)}  ${targetValue(bucket.averageForwardValue, unit).padStart(10)}  ${targetValue(bucket.medianForwardValue, unit).padStart(10)}  ${pct(bucket.positiveForwardValuePct)}`,
        );
      }
      const rises =
        horizon.averageValueMonotonicallyRises === null
          ? "n/a"
          : horizon.averageValueMonotonicallyRises
            ? "yes"
            : "no";
      lines.push(
        `    average target value rises lowest-to-highest: ${rises}; top-minus-bottom spread ${targetValue(horizon.topBottomAverageValueSpread, unit)}; pooled Spearman ${decimal(horizon.spearmanScoreForwardValue)}`,
      );
      lines.push("    yearly Spearman (evaluation calendar year; n=paired days):");
      if (horizon.yearlySpearman.length === 0) {
        lines.push("      no evaluation days with a forward target value");
      } else {
        for (const yearly of horizon.yearlySpearman) {
          lines.push(
            `      ${yearly.year}: n=${yearly.days} Spearman=${decimal(yearly.spearmanScoreForwardValue)}`,
          );
        }
      }
    }
  }
  renderCriteria(lines, period, criteria);
}

function reactionValue(
  value: number | null,
  measure: "percent_return" | "percentage_point_change",
): string {
  return targetValue(value, measure === "percent_return" ? "%" : " pp");
}

function reactionStatsLine(
  stats: ReactionStats,
  measure: "percent_return" | "percentage_point_change",
): string {
  return `n=${stats.n}; expected-sign match ${pct(stats.expectedSignMatchesPct)}; avg after hawkish ${reactionValue(stats.averageChangeAfterHawkishSurprises, measure)}; avg after dovish ${reactionValue(stats.averageChangeAfterDovishSurprises, measure)}; Spearman(surprise, change) ${decimal(stats.spearmanSurpriseChange)}`;
}

function renderReleaseReaction(lines: string[], report: ReleaseReactionReport): void {
  lines.push(
    "",
    RULE,
    " RELEASE-DAY REACTION",
    RULE,
    `Zero-surprise events excluded: ${report.zeroSurprisesExcluded}.`,
    `Expected sign after a hawkish surprise: ${Object.entries(report.expectedSigns)
      .map(([target, sign]) => `${target} ${sign > 0 ? "+" : "-"}`)
      .join(", ")}.`,
  );
  for (const [target, count] of Object.entries(report.missingReleaseDateOrPriorCloseByTarget)) {
    if (count)
      lines.push(
        `Skipped ${count} event(s) for ${target}: no release-date close or prior trading-day close.`,
      );
  }
  if (report.groups.length === 0) lines.push("No release-day observations were available.");
  for (const group of report.groups) {
    lines.push(
      "",
      `${group.indicator} / ${group.target} (${group.measure === "percent_return" ? "percent return" : "percentage-point change"}; expected hawkish sign ${group.expectedHawkishSign > 0 ? "+" : "-"})`,
      `  all surprises: ${reactionStatsLine(group.all, group.measure)}`,
      "  by calendar year:",
    );
    if (group.byYear.length === 0) lines.push("    no observations");
    for (const yearly of group.byYear) {
      lines.push(`    ${yearly.year}: ${reactionStatsLine(yearly.stats, group.measure)}`);
    }
    lines.push(
      "  large surprises only (|normalized surprise| >= 0.5):",
      `    all years: ${reactionStatsLine(group.largeSurprises, group.measure)}`,
      "    by calendar year:",
    );
    if (group.largeSurprisesByYear.length === 0) lines.push("      no observations");
    for (const yearly of group.largeSurprisesByYear) {
      lines.push(`      ${yearly.year}: ${reactionStatsLine(yearly.stats, group.measure)}`);
    }
  }
  lines.push(`NOTE: ${report.note}`);
}

function indicatorTable(
  lines: string[],
  title: string,
  reports: BacktestReport["isolatedByIndicator"],
): void {
  lines.push("", THIN, ` ${title}`, THIN);
  for (const instrument of INSTRUMENTS) {
    const ownReports = reports.filter((report) => report.instrument === instrument);
    if (ownReports.length === 0) continue;
    lines.push(
      "",
      instrument,
      "  indicator                     h    n   BULL  BEAR  NEUT   hit%   base%   edge",
    );
    for (const indicator of ownReports) {
      for (const horizon of indicator.horizons) {
        const stats = horizon.stats;
        const edge =
          stats.hitRateDirectionalPct === null || horizon.baseline.alwaysBullishHitRatePct === null
            ? null
            : stats.hitRateDirectionalPct - horizon.baseline.alwaysBullishHitRatePct;
        lines.push(
          `  ${indicator.indicator.padEnd(28)} ${String(horizon.horizonDays).padStart(2)}d ${String(horizon.releases).padStart(4)}  ` +
            `${String(stats.counts.BULLISH).padStart(4)}  ${String(stats.counts.BEARISH).padStart(4)}  ${String(stats.counts.NEUTRAL).padStart(4)}  ` +
            `${pct(stats.hitRateDirectionalPct)}  ${pct(horizon.baseline.alwaysBullishHitRatePct)}  ${signedPts(edge)}` +
            (horizon.lowSampleWarning ? "  !!" : ""),
        );
      }
    }
  }
}

export interface SummaryInputs {
  report: BacktestReport;
  prices: PriceSeriesMap;
  dataQuality: DataQualityReport;
  missingReferenceTargets: string[];
  criteria: CriteriaFile;
  periodAnalysis: { inSample: PeriodAnalysis; holdout: PeriodAnalysis | null };
  releaseDayReaction: ReleaseReactionReport;
  eventsLoaded: number;
  skipped: SkippedEvent[];
  rowsRead: number;
  outputPath: string;
}

export function renderDataQualitySection(dataQuality: DataQualityReport): string {
  const lines: string[] = [THIN, " DATA QUALITY - review before interpreting results", THIN];
  if (dataQuality.eventsPerIndicatorPerYear.length === 0) {
    lines.push("  events per indicator/year: no event rows");
  } else {
    lines.push("  events per indicator/year:");
    for (const row of dataQuality.eventsPerIndicatorPerYear) {
      lines.push(`    ${row.year}  ${row.indicator.padEnd(30)} ${row.count}`);
    }
  }
  lines.push(
    `  duplicate event IDs: ${dataQuality.duplicateEventIds.length === 0 ? "none" : dataQuality.duplicateEventIds.join(", ")}`,
    `  events missing forecast: ${dataQuality.eventsMissingForecast}/${dataQuality.totalEventRows} (${pct(dataQuality.missingForecastPct)})`,
  );
  if (dataQuality.indicatorMonthGaps.length === 0) {
    lines.push("  indicator month gaps: none detected within observed indicator ranges");
  } else {
    lines.push("  indicator month gaps (no scored event row; schedule is not inferred):");
    for (const gap of dataQuality.indicatorMonthGaps) {
      lines.push(
        `    ${gap.indicator}: ${gap.missingMonths.join(", ")}${gap.skippedMissingForecastMonths.length > 0 ? ` (skipped for missing forecast: ${gap.skippedMissingForecastMonths.join(", ")})` : ""}`,
      );
    }
  }
  if (dataQuality.warnings.length === 0) {
    lines.push("  range/missing-release warnings: none");
  } else {
    lines.push("  warnings:");
    for (const warning of dataQuality.warnings) lines.push(`    ! ${warning}`);
  }
  return lines.join("\n");
}

export function renderSummary(input: SummaryInputs): string {
  const {
    report,
    prices,
    dataQuality,
    missingReferenceTargets,
    criteria,
    periodAnalysis,
    releaseDayReaction,
    eventsLoaded,
    skipped,
    rowsRead,
    outputPath,
  } = input;
  const lines: string[] = [RULE, " bendy-macro - historical bias backtest", RULE];
  lines.push(
    "",
    renderDataQualitySection(dataQuality),
    "",
    `events   ${eventsLoaded} usable of ${rowsRead} rows${skipped.length > 0 ? `, ${skipped.length} skipped (missing actual/forecast)` : ""}`,
  );
  for (const instrument of INSTRUMENTS) {
    const series = prices[instrument] ?? [];
    lines.push(
      `prices   ${instrument.padEnd(7)} ${String(series.length).padStart(5)} trading days  ${series.length > 0 ? `${series[0].date} .. ${series[series.length - 1].date}` : "(none)"}`,
    );
  }
  lines.push(
    `evaluation start ${report.evaluationStartDate ?? "unavailable"}; excluded ${report.excludedPriceDaysBeforeStart} unique earlier price day(s) (XAUUSD ${report.excludedPriceDaysByInstrument.XAUUSD}, USDJPY ${report.excludedPriceDaysByInstrument.USDJPY})`,
    `config   daily close assumed at ${String(report.options.dailyCloseHourUtc).padStart(2, "0")}:00 UTC; horizons ${report.options.horizons.map((horizon) => `${horizon}d`).join(", ")}`,
    "",
  );
  if (report.warnings.length > 0) {
    lines.push(
      "!".repeat(78),
      `!! LOW SAMPLE WARNING - ${report.warnings.length} metric group(s) below ${MIN_INDEPENDENT_CALLS} independent calls`,
      "!! Hit rates built on these are not evidence of anything.",
    );
    for (const warning of report.warnings.slice(0, 12)) lines.push(`!!   ${warning}`);
    if (report.warnings.length > 12)
      lines.push(`!!   ... and ${report.warnings.length - 12} more (see the JSON)`);
    lines.push("!".repeat(78), "");
  }

  lines.push(THIN, " DAILY BIAS - engine re-evaluated at every trading day's close", THIN);
  for (const instrument of report.daily) {
    lines.push(
      "",
      `${instrument.instrument}  ${instrument.evaluationDays} evaluation days  ${instrument.firstDate ?? "-"} .. ${instrument.lastDate ?? "-"}`,
    );
    for (const horizon of instrument.horizons) {
      lines.push(
        `  ${horizon.horizonDays}d forward`,
        ...statsBlock(horizon.everyDay, "    "),
        baselineBlock(horizon.baseline, "    "),
      );
      lines.push(
        `    edge       directional hit rate vs always-BULLISH baseline: ${signedPts(horizon.edgeVsBaselinePct)}`,
      );
      lines.push(
        `    INDEPENDENT CALLS (runs of one direction): ${horizon.independentCalls.total} total, ${horizon.independentCalls.directional} directional  <-- the real sample size`,
      );
      lines.push(
        `    on direction-change days only (n=${horizon.onDirectionChange.samples}):`,
        ...statsBlock(horizon.onDirectionChange, "      "),
      );
      if (horizon.lowSampleWarning) lines.push(`    !! ${horizon.lowSampleWarning}`);
    }
  }

  lines.push(
    "",
    THIN,
    " FULL EVALUATION-RANGE SCORE BUCKETS - pooled, unrestricted forward windows",
    THIN,
  );
  for (const instrument of INSTRUMENTS) {
    lines.push("", `${instrument}  direction threshold |score| > ${BIAS_DIRECTION_THRESHOLD}`);
    for (const horizon of report.scoreBuckets[instrument]) {
      lines.push(
        `  ${horizon.horizonDays}d forward  ${horizon.buckets.length} bucket(s), ${horizon.distinctScores} distinct score value(s); NEUTRAL ${pct(horizon.neutralSharePct)}; exactly-zero score ${pct(horizon.exactZeroScoreSharePct)}`,
      );
      if (horizon.bucketCountNote) lines.push(`    ${horizon.bucketCountNote}`);
      lines.push(
        "    bucket                 score range             n    avg fwd   median   positive",
      );
      for (const bucket of horizon.buckets) {
        lines.push(
          `    ${bucket.label.padEnd(22)} ${bucket.minScore.toFixed(3).padStart(8)} .. ${bucket.maxScore.toFixed(3).padEnd(8)} ${String(bucket.days).padStart(4)}  ${signedPct(bucket.averageForwardReturnPct)}  ${signedPct(bucket.medianForwardReturnPct)}  ${pct(bucket.positiveForwardReturnPct)}`,
        );
      }
      const rises =
        horizon.averageReturnMonotonicallyRises === null
          ? "n/a"
          : horizon.averageReturnMonotonicallyRises
            ? "yes"
            : "no";
      lines.push(
        `    average return rises lowest-to-highest: ${rises}; top-minus-bottom spread ${signedPct(horizon.topBottomAverageReturnSpreadPct)}; Spearman(score, forward return) ${decimal(horizon.spearmanScoreForwardReturn)}`,
      );
      lines.push(`    NOTE: ${horizon.note}`);
    }
  }

  lines.push(
    "",
    THIN,
    " FULL EVALUATION-RANGE REFERENCE TARGETS - pooled, unrestricted forward windows",
    THIN,
    "Assumption: the existing USDJPY score is a proxy for US hawkishness; this is an assumption, not a separately calculated score.",
  );
  for (const target of missingReferenceTargets) {
    lines.push(`  SKIP ${target}: series file is missing (optional reference target).`);
  }
  for (const target of report.referenceTargets) {
    const unit =
      target.measure === "forward_percent_return" ? "percent return" : "percentage points";
    const unitShort = target.measure === "forward_percent_return" ? "%" : " pp";
    lines.push(
      "",
      `${target.target}  ${target.evaluationDays} aligned evaluation days  ${target.firstDate ?? "-"} .. ${target.lastDate ?? "-"}; forward ${target.measure === "forward_percent_return" ? "percent return" : "absolute change in percentage points"}`,
    );
    for (const horizon of target.horizons) {
      lines.push(
        `  ${horizon.horizonDays}d forward; ${horizon.buckets.length} bucket(s), ${horizon.distinctScores} distinct score value(s); NEUTRAL ${pct(horizon.neutralSharePct)}`,
      );
      if (horizon.bucketCountNote) lines.push(`    ${horizon.bucketCountNote}`);
      lines.push(
        "    bucket                 score range             n    avg fwd   median   positive",
      );
      for (const bucket of horizon.buckets) {
        const show = (value: number | null): string =>
          value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}${unitShort}`;
        lines.push(
          `    ${bucket.label.padEnd(22)} ${bucket.minScore.toFixed(3).padStart(8)} .. ${bucket.maxScore.toFixed(3).padEnd(8)} ${String(bucket.days).padStart(4)}  ${show(bucket.averageForwardValue).padStart(10)}  ${show(bucket.medianForwardValue).padStart(10)}  ${pct(bucket.positiveForwardValuePct)}`,
        );
      }
      const rises =
        horizon.averageValueMonotonicallyRises === null
          ? "n/a"
          : horizon.averageValueMonotonicallyRises
            ? "yes"
            : "no";
      const spread =
        horizon.topBottomAverageValueSpread === null
          ? "n/a"
          : `${horizon.topBottomAverageValueSpread >= 0 ? "+" : ""}${horizon.topBottomAverageValueSpread.toFixed(3)}${unitShort}`;
      lines.push(
        `    average target value rises lowest-to-highest: ${rises}; top-minus-bottom spread ${spread}; Spearman(score, forward target) ${decimal(horizon.spearmanScoreForwardValue)}`,
      );
      lines.push(
        `    yearly Spearman (evaluation-date calendar year; days are paired observations):`,
      );
      if (horizon.yearlySpearman.length === 0) {
        lines.push("      no usable forward observations");
      } else {
        for (const year of horizon.yearlySpearman) {
          lines.push(
            `      ${year.year}: n=${year.days}  Spearman=${decimal(year.spearmanScoreForwardValue)}`,
          );
        }
      }
      lines.push(`    target measure: ${unit}.`);
    }
  }
  renderPeriodAnalysis(lines, periodAnalysis.inSample, criteria, missingReferenceTargets);
  if (periodAnalysis.holdout === null) {
    lines.push(
      "",
      "HOLDOUT ANALYSIS unavailable: criteria.inSampleEnd is missing; PASS/FAIL is disabled.",
    );
  } else {
    renderPeriodAnalysis(lines, periodAnalysis.holdout, criteria, missingReferenceTargets);
  }
  renderReleaseReaction(lines, releaseDayReaction);

  lines.push("", THIN, " MIRROR CHECK - XAUUSD and USDJPY daily scores", THIN);
  lines.push(
    `matched days ${report.mirror.matchedDays}; score correlation ${decimal(report.mirror.scoreCorrelation)}; exact opposite biases ${report.mirror.exactOppositeBiasDays} (${pct(report.mirror.exactOppositeBiasSharePct)})`,
  );
  lines.push(`NOTE: ${report.mirror.note}`);
  indicatorTable(
    lines,
    "ENGINE STATE AT RELEASE (not isolated)",
    report.engineStateAtReleaseByIndicator,
  );
  indicatorTable(lines, "ISOLATED PER-INDICATOR BIAS", report.isolatedByIndicator);
  lines.push(
    "",
    THIN,
    " Reminder: this measures whether a rule-based macro BIAS lined up with a later price. It is not a strategy, it ignores costs and slippage, and overlapping windows mean daily hit rates are far less independent than their counts suggest.",
    THIN,
    `full results written to ${outputPath}`,
  );
  return lines.join("\n");
}
