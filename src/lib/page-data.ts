import { prisma } from "./prisma";
import { evaluateReleaseDayReactions } from "./analysis/release-reaction";
import type { ReactionTarget } from "./analysis/release-reaction";
import type { EconomicEvent, EconomicIndicator, EventUnit, PolicySignal } from "../models";

export const PRICE_SYMBOLS: ReactionTarget[] = ["DXY", "USDJPY", "UST10Y", "REAL10Y", "XAUUSD"];
export function releaseToEvent(row: { externalId: string; indicator: string; releasedAt: Date; actual: number | null; forecast: number | null; previous: number | null; unit: string; period: string; policySignal: string | null; expectedPolicySignal: string | null }): EconomicEvent {
  return { id: row.externalId, indicator: row.indicator as EconomicIndicator, timestamp: row.releasedAt.toISOString(), ...(row.actual === null ? {} : { actual: row.actual }), ...(row.forecast === null ? {} : { forecast: row.forecast }), ...(row.previous === null ? {} : { previous: row.previous }), unit: row.unit as EventUnit, period: row.period, ...(row.policySignal === null ? {} : { policySignal: row.policySignal as PolicySignal }), ...(row.expectedPolicySignal === null ? {} : { expectedPolicySignal: row.expectedPolicySignal as PolicySignal }) };
}
export async function loadAnalysisDataset() {
  const [releases, bars] = await Promise.all([
    prisma.release.findMany({ orderBy: [{ releasedAt: "desc" }, { externalId: "asc" }] }),
    prisma.priceBar.findMany({ where: { symbol: { in: PRICE_SYMBOLS } }, orderBy: [{ symbol: "asc" }, { date: "asc" }] }),
  ]);
  const byTarget: Partial<Record<ReactionTarget, Array<{ date: string; close: number }>>> = {};
  for (const bar of bars) (byTarget[bar.symbol as ReactionTarget] ??= []).push({ date: bar.date.toISOString().slice(0, 10), close: bar.close });
  const events = releases.map(releaseToEvent);
  return { releases, bars, events, reactions: evaluateReleaseDayReactions(events, byTarget) };
}
export function readable(value: number | null | undefined, digits = 3, suffix = "") {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`;
}
