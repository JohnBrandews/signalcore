import { MacroEngine } from "../engine";
import type { EconomicEvent, EconomicIndicator, EventUnit, PolicySignal } from "../models";
import { RULES_VERSION } from "../config";
import { prisma } from "./prisma";
import { snapshotOrigin } from "./snapshot-origin";

function eventFromRow(row: { id: string; externalId: string; indicator: string; releasedAt: Date; actual: number | null; forecast: number | null; previous: number | null; unit: string; period: string; policySignal: string | null; expectedPolicySignal: string | null }): EconomicEvent {
  return { id: row.externalId, indicator: row.indicator as EconomicIndicator, timestamp: row.releasedAt.toISOString(), ...(row.actual === null ? {} : { actual: row.actual }), ...(row.forecast === null ? {} : { forecast: row.forecast }), ...(row.previous === null ? {} : { previous: row.previous }), unit: row.unit as EventUnit, period: row.period, ...(row.policySignal === null ? {} : { policySignal: row.policySignal as PolicySignal }), ...(row.expectedPolicySignal === null ? {} : { expectedPolicySignal: row.expectedPolicySignal as PolicySignal }) };
}
export function completedUtcSnapshotTime(now = new Date()) {
  const dayOffset = now.getUTCHours() >= 21 ? 0 : -1;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, 21));
}
export async function insertDailySnapshots(now = new Date()) {
  const asOf = completedUtcSnapshotTime(now);
  const releases = await prisma.release.findMany({ where: { releasedAt: { lte: asOf }, OR: [{ policySignal: { not: null } }, { actual: { not: null }, forecast: { not: null } }] }, orderBy: { releasedAt: "asc" } });
  const engine = new MacroEngine();
  for (const release of releases) engine.process(eventFromRow(release));
  const snapshot = engine.snapshot(asOf.toISOString());
  const origin = snapshotOrigin({ vercelEnv: process.env.VERCEL_ENV, forwardTestEnabled: process.env.FORWARD_TEST_ENABLED });
  let inserted = 0;
  for (const instrument of ["XAUUSD", "USDJPY"] as const) {
    const bias = snapshot.biases[instrument];
    const data = { asOf, instrument, rulesVersion: RULES_VERSION, origin };
    const existing = await prisma.biasSnapshot.findFirst({ where: data });
    if (existing) continue;
    const drivers = { topDrivers: [...bias.positiveContributors, ...bias.negativeContributors].slice(0, 5), invalidationConditions: bias.invalidationConditions };
    try {
      await prisma.biasSnapshot.create({ data: { ...data, score: bias.score, direction: bias.direction, strength: Math.min(1, Math.abs(bias.score)), confidence: bias.confidence, drivers: JSON.stringify(drivers), releaseIds: JSON.stringify(releases.map(row => row.id)) } });
      inserted++;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
    }
  }
  return { asOf: asOf.toISOString(), origin, rulesVersion: RULES_VERSION, releaseCount: releases.length, inserted };
}
