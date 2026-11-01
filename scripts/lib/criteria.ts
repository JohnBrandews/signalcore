import {
  ReferenceTarget,
  ReferenceTargetReport,
  REFERENCE_TARGETS,
} from "../../src/daily-backtest";
import { CsvError } from "./csv";

export interface TargetCriteria {
  expectedSpearmanSign: 1 | -1 | null;
  minimumAbsoluteSpearman: number | null;
  horizonsToCheck: number[] | null;
  topBucketMustBeatBottom: boolean | null;
}

export interface CriteriaFile {
  inSampleEnd: string | null;
  targets: Record<ReferenceTarget, TargetCriteria>;
}

export interface CriteriaEvaluation {
  target: ReferenceTarget;
  horizonDays: number;
  expectedSpearmanSign: 1 | -1;
  observedSpearman: number | null;
  minimumAbsoluteSpearman: number;
  signMet: boolean;
  magnitudeMet: boolean;
  topBucketMustBeatBottom: boolean;
  topBottomSpread: number | null;
  topBottomMet: boolean | null;
  passed: boolean;
}

export function emptyCriteria(): CriteriaFile {
  return {
    inSampleEnd: null,
    targets: Object.fromEntries(
      REFERENCE_TARGETS.map((target) => [
        target,
        {
          expectedSpearmanSign: null,
          minimumAbsoluteSpearman: null,
          horizonsToCheck: null,
          topBucketMustBeatBottom: null,
        },
      ]),
    ) as Record<ReferenceTarget, TargetCriteria>,
  };
}

const REQUIRED_FIELDS = [
  "expectedSpearmanSign",
  "minimumAbsoluteSpearman",
  "horizonsToCheck",
  "topBucketMustBeatBottom",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCriteria(text: string, file = "criteria.json"): CriteriaFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CsvError(
      `${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed.targets)) {
    throw new CsvError(`${file}: expected an object with "inSampleEnd" and a "targets" object`);
  }
  const inSampleEnd = parsed.inSampleEnd ?? null;
  if (
    inSampleEnd !== null &&
    (typeof inSampleEnd !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(inSampleEnd) ||
      !Number.isFinite(Date.parse(`${inSampleEnd}T00:00:00Z`)) ||
      new Date(`${inSampleEnd}T00:00:00Z`).toISOString().slice(0, 10) !== inSampleEnd)
  ) {
    throw new CsvError(`${file}: inSampleEnd must be null or a valid YYYY-MM-DD date`);
  }

  const targetKeys = Object.keys(parsed.targets);
  const expectedTargets = [...REFERENCE_TARGETS].sort();
  if (
    targetKeys.length !== expectedTargets.length ||
    targetKeys.some((key) => !expectedTargets.includes(key as ReferenceTarget))
  ) {
    throw new CsvError(`${file}: targets must contain exactly ${expectedTargets.join(", ")}`);
  }

  const targets = {} as Record<ReferenceTarget, TargetCriteria>;
  for (const target of REFERENCE_TARGETS) {
    const value = parsed.targets[target];
    if (!isRecord(value)) throw new CsvError(`${file}: targets.${target} must be an object`);
    const missing = REQUIRED_FIELDS.filter((field) => !(field in value));
    const extra = Object.keys(value).filter(
      (field) => !(REQUIRED_FIELDS as readonly string[]).includes(field),
    );
    if (missing.length > 0 || extra.length > 0) {
      throw new CsvError(
        `${file}: targets.${target} fields must be exactly ${REQUIRED_FIELDS.join(", ")}`,
      );
    }

    const sign = value.expectedSpearmanSign;
    if (sign !== null && sign !== 1 && sign !== -1) {
      throw new CsvError(`${file}: targets.${target}.expectedSpearmanSign must be null, +1, or -1`);
    }
    const minimum = value.minimumAbsoluteSpearman;
    if (
      minimum !== null &&
      (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum < 0 || minimum > 1)
    ) {
      throw new CsvError(
        `${file}: targets.${target}.minimumAbsoluteSpearman must be null or a number from 0 to 1`,
      );
    }
    const horizons = value.horizonsToCheck;
    if (
      horizons !== null &&
      (!Array.isArray(horizons) ||
        horizons.length === 0 ||
        horizons.some((horizon) => horizon !== 5 && horizon !== 20) ||
        new Set(horizons).size !== horizons.length)
    ) {
      throw new CsvError(
        `${file}: targets.${target}.horizonsToCheck must be null or a non-empty unique list containing only 5 and/or 20`,
      );
    }
    const topMustBeat = value.topBucketMustBeatBottom;
    if (topMustBeat !== null && typeof topMustBeat !== "boolean") {
      throw new CsvError(
        `${file}: targets.${target}.topBucketMustBeatBottom must be null or boolean`,
      );
    }
    targets[target] = {
      expectedSpearmanSign: sign,
      minimumAbsoluteSpearman: minimum,
      horizonsToCheck: horizons as number[] | null,
      topBucketMustBeatBottom: topMustBeat,
    };
  }
  return { inSampleEnd, targets };
}

export function criteriaMissingFields(criteria: CriteriaFile): string[] {
  const missing: string[] = criteria.inSampleEnd === null ? ["inSampleEnd"] : [];
  for (const target of REFERENCE_TARGETS) {
    const item = criteria.targets[target];
    for (const field of REQUIRED_FIELDS) {
      if (item[field] === null) missing.push(`targets.${target}.${field}`);
    }
  }
  return missing;
}

export function assertCriteriaComplete(criteria: CriteriaFile): void {
  const missing = criteriaMissingFields(criteria);
  if (missing.length > 0) {
    throw new Error(
      `Criteria incomplete; refusing PASS/FAIL output. Fill in: ${missing.join(", ")}`,
    );
  }
}

export function evaluateCriteria(
  reports: readonly ReferenceTargetReport[],
  criteria: CriteriaFile,
): CriteriaEvaluation[] {
  assertCriteriaComplete(criteria);
  const byTarget = new Map(reports.map((report) => [report.target, report]));
  const results: CriteriaEvaluation[] = [];

  for (const target of REFERENCE_TARGETS) {
    const criterion = criteria.targets[target];
    const report = byTarget.get(target);
    if (report === undefined) continue;
    for (const horizonDays of criterion.horizonsToCheck!) {
      const horizon = report.horizons.find((item) => item.horizonDays === horizonDays);
      const rho = horizon?.spearmanScoreForwardValue ?? null;
      const spread = horizon?.topBottomAverageValueSpread ?? null;
      const signMet = rho !== null && Math.sign(rho) === criterion.expectedSpearmanSign;
      const magnitudeMet = rho !== null && Math.abs(rho) >= criterion.minimumAbsoluteSpearman!;
      const topBottomMet =
        criterion.topBucketMustBeatBottom === true ? spread !== null && spread > 0 : null;
      results.push({
        target,
        horizonDays,
        expectedSpearmanSign: criterion.expectedSpearmanSign!,
        observedSpearman: rho,
        minimumAbsoluteSpearman: criterion.minimumAbsoluteSpearman!,
        signMet,
        magnitudeMet,
        topBucketMustBeatBottom: criterion.topBucketMustBeatBottom!,
        topBottomSpread: spread,
        topBottomMet,
        passed: signMet && magnitudeMet && (topBottomMet === null || topBottomMet),
      });
    }
  }
  return results;
}
