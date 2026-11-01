import { TimeDecay } from "./models";

const MS_PER_HOUR = 3_600_000;

export function applyTimeDecay(
  initialImpact: number,
  eventTimestamp: string,
  asOf: string,
  halfLifeHours: number,
): TimeDecay {
  const ageHours = Math.max(0, (Date.parse(asOf) - Date.parse(eventTimestamp)) / MS_PER_HOUR);
  return {
    initialImpact,
    halfLifeHours,
    ageHours,
    effectiveImpact: initialImpact * Math.pow(0.5, ageHours / halfLifeHours),
  };
}
