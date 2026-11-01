import type { EconomicEvent } from "../../models";
import { FACTOR_RULES } from "../../rules";
import { calculateSurprise } from "../../surprise";

export type InterpretationLabel = "Hawkish" | "Dovish" | "In line";
export type InterpretationMagnitude = "small (<0.5 normalized)" | "moderate" | "large";

export interface ReleaseInterpretation {
  label: InterpretationLabel;
  magnitude: InterpretationMagnitude;
  text: string;
}

/**
 * Produce a rule-based reading of a release's directional surprise.
 * Returns null when the event has no numeric consensus or structured policy signal.
 */
export function generateReleaseInterpretation(event: EconomicEvent): ReleaseInterpretation | null {
  if (
    event.policySignal === undefined &&
    (event.actual === undefined || event.forecast === undefined)
  ) {
    return null;
  }

  const surprise = calculateSurprise(event);
  const magnitudeValue = Math.abs(surprise.normalized);
  const label: InterpretationLabel =
    surprise.directional > 0 ? "Hawkish" : surprise.directional < 0 ? "Dovish" : "In line";
  const magnitude: InterpretationMagnitude =
    magnitudeValue < 0.5 ? "small (<0.5 normalized)" : magnitudeValue < 0.75 ? "moderate" : "large";
  const relationships = [
    ...new Set(
      FACTOR_RULES.filter((rule) => rule.indicator === event.indicator).map(
        (rule) => rule.relationship,
      ),
    ),
  ];
  const lines = [
    `${label} ${magnitudeValue === 0 ? "release" : "surprise"} (${magnitude}).`,
    ...(relationships.length > 0 ? [`Rule relationships: ${relationships.join(" ")}`] : []),
    "This is a rule-based reading of surprise versus consensus.",
  ];

  return { label, magnitude, text: lines.join("\n") };
}
