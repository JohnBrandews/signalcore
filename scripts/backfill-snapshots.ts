import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { MacroEngine } from "../src/engine";
import type { EconomicEvent, EconomicIndicator, EventUnit, PolicySignal } from "../src/models";
import { RULES_VERSION } from "../src/config";

function loadEnv() {
  try {
    const contents = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of contents.split(String.fromCharCode(10))) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch { /* shell/deployment environment can supply it */ }
}
function event(row: { externalId: string; indicator: string; releasedAt: Date; actual: number | null; forecast: number | null; previous: number | null; unit: string; period: string; policySignal: string | null; expectedPolicySignal: string | null }): EconomicEvent {
  return { id: row.externalId, indicator: row.indicator as EconomicIndicator, timestamp: row.releasedAt.toISOString(), ...(row.actual === null ? {} : { actual: row.actual }), ...(row.forecast === null ? {} : { forecast: row.forecast }), ...(row.previous === null ? {} : { previous: row.previous }), unit: row.unit as EventUnit, period: row.period, ...(row.policySignal === null ? {} : { policySignal: row.policySignal as PolicySignal }), ...(row.expectedPolicySignal === null ? {} : { expectedPolicySignal: row.expectedPolicySignal as PolicySignal }) };
}
async function main() {
  loadEnv(); if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.release.findMany({ where: { OR: [{ policySignal: { not: null } }, { actual: { not: null }, forecast: { not: null } }] }, orderBy: { releasedAt: "asc" } });
    if (!rows.length) { console.log("No scorable releases; no backfill snapshots created."); return; }
    const engine = new MacroEngine(); for (const row of rows) engine.process(event(row));
    const start = new Date(`${rows[0].releasedAt.toISOString().slice(0,10)}T21:00:00.000Z`);
    const now = new Date(); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 21));
    const beforeDev = await prisma.biasSnapshot.count({ where: { origin: "dev" } });
    const beforeLive = await prisma.biasSnapshot.count({ where: { origin: "live" } });
    const existing = await prisma.biasSnapshot.findMany({ where: { origin: "backfill", rulesVersion: RULES_VERSION, asOf: { gte: start, lte: end } }, select: { asOf: true, instrument: true } });
    const seen = new Set(existing.map(row => `${row.asOf.toISOString()}|${row.instrument}`));
    const pending: Array<{ asOf: Date; instrument: string; score: number; direction: string; strength: number; confidence: number; drivers: string; releaseIds: string; rulesVersion: string; origin: string }> = [];
    for (let asOf = start; asOf <= end; asOf = new Date(asOf.getTime() + 86_400_000)) {
      const snapshot = engine.snapshot(asOf.toISOString());
      const releaseIds = JSON.stringify(rows.filter(row => row.releasedAt <= asOf).map(row => row.id));
      for (const instrument of ["XAUUSD", "USDJPY"] as const) {
        const key = `${asOf.toISOString()}|${instrument}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const bias = snapshot.biases[instrument];
        const drivers = [...bias.positiveContributors, ...bias.negativeContributors].slice(0, 5);
        pending.push({ asOf, instrument, score: bias.score, direction: bias.direction, strength: Math.min(1, Math.abs(bias.score)), confidence: bias.confidence, drivers: JSON.stringify(drivers), releaseIds, rulesVersion: RULES_VERSION, origin: "backfill" });
      }
    }
    let created = 0;
    for (let offset = 0; offset < pending.length; offset += 250) {
      const result = await prisma.biasSnapshot.createMany({ data: pending.slice(offset, offset + 250) });
      created += result.count;
    }
    const afterDev = await prisma.biasSnapshot.count({ where: { origin: "dev" } });
    const afterLive = await prisma.biasSnapshot.count({ where: { origin: "live" } });
    if (beforeDev !== afterDev || beforeLive !== afterLive) throw new Error("Backfill unexpectedly changed dev/live snapshots.");
    console.log(`Backfill complete: ${created} snapshots created as origin=backfill; dev=${afterDev} unchanged; live=${afterLive} unchanged.`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });



