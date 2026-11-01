import { EconomicEvent, Surprise } from "./models";
import { INDICATOR_RULES, POLICY_VALUE } from "./rules";

const clamp = (n: number): number => Math.max(-1, Math.min(1, n));

/** Range of POLICY_VALUE (HAWKISH 1 .. DOVISH -1), used to normalise a stance gap to [-1, 1]. */
const POLICY_RANGE = 2;

export function calculateSurprise(event: EconomicEvent): Surprise {
  const rule = INDICATOR_RULES[event.indicator];

  if (event.policySignal) {
    const raw =
      POLICY_VALUE[event.policySignal] - POLICY_VALUE[event.expectedPolicySignal ?? "NEUTRAL"];
    const normalized = clamp(raw / POLICY_RANGE);
    return {
      raw,
      normalized,
      directional: normalized,
      interpretation: "Structured policy stance relative to expected stance",
    };
  }

  if (event.actual === undefined || event.forecast === undefined) {
    throw new Error(`${event.id}: actual and forecast required`);
  }

  const raw = event.actual - event.forecast;
  const normalized = clamp(raw / rule.normalizationScale);
  return {
    raw,
    normalized,
    directional: normalized * rule.favorableDirection,
    interpretation: rule.description,
  };
}
