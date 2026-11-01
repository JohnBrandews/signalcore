import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { evaluateReleaseDayReactions } from "../src/lib/analysis/release-reaction";
import type { EconomicEvent, EconomicIndicator, EventUnit, PolicySignal } from "../src/models";
import { loadEvents, loadPrices, loadReferencePrices } from "./lib/load-data";

function loadLocalEnv() {
  try {
    for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^("|')(.*)\1$/, "$2");
    }
  } catch { /* environment can be supplied by the shell or deployment platform */ }
}
function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
function eventFromRow(row: { externalId: string; indicator: string; releasedAt: Date; actual: number | null; forecast: number | null; previous: number | null; unit: string; period: string; policySignal: string | null; expectedPolicySignal: string | null }): EconomicEvent {
  return { id: row.externalId, indicator: row.indicator as EconomicIndicator, timestamp: row.releasedAt.toISOString(), ...(row.actual === null ? {} : { actual: row.actual }), ...(row.forecast === null ? {} : { forecast: row.forecast }), ...(row.previous === null ? {} : { previous: row.previous }), unit: row.unit as EventUnit, period: row.period, ...(row.policySignal === null ? {} : { policySignal: row.policySignal as PolicySignal }), ...(row.expectedPolicySignal === null ? {} : { expectedPolicySignal: row.expectedPolicySignal as PolicySignal }) };
}
async function main() {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const root = process.cwd();
  const prisma = new PrismaClient();
  try {
    const csvEvents = loadEvents(resolve(root, "data/real/events.csv"), true).events;
    const symbols = ["XAUUSD", "USDJPY", "UST10Y", "REAL10Y", "DXY"] as const;
    const csvSeries: Record<string, Array<{ date: string; close: number }>> = {
      XAUUSD: loadPrices(resolve(root, "data/real/prices/XAUUSD.csv"), "XAUUSD"),
      USDJPY: loadPrices(resolve(root, "data/real/prices/USDJPY.csv"), "USDJPY"),
      UST10Y: loadReferencePrices(resolve(root, "data/real/prices/UST10Y.csv"), "UST10Y"),
      REAL10Y: loadReferencePrices(resolve(root, "data/real/prices/REAL10Y.csv"), "REAL10Y"),
      DXY: loadReferencePrices(resolve(root, "data/real/prices/DXY.csv"), "DXY"),
    };
    const [allDbReleases, dbBars] = await Promise.all([
      prisma.release.findMany({ orderBy: { externalId: "asc" } }),
      prisma.priceBar.findMany({ where: { symbol: { in: [...symbols] } }, orderBy: [{ symbol: "asc" }, { date: "asc" }] }),
    ]);
    const csvById = new Map(csvEvents.map(event => [event.id, event]));
    const canonicalDbRows = allDbReleases.filter(row => csvById.has(row.externalId));
    assert(canonicalDbRows.length === csvEvents.length, `Canonical release count differs: DB ${canonicalDbRows.length}, CSV ${csvEvents.length}`);
    for (const row of canonicalDbRows) {
      const csv = csvById.get(row.externalId)!;
      assert(new Date(csv.timestamp).getTime() === row.releasedAt.getTime(), `UTC timestamp differs for ${row.externalId}: DB ${row.releasedAt.toISOString()}, CSV ${csv.timestamp}`);
    }
    const dbSeries: Record<string, Array<{ date: string; close: number }>> = {};
    for (const bar of dbBars) (dbSeries[bar.symbol] ??= []).push({ date: bar.date.toISOString().slice(0, 10), close: bar.close });
    const dbCanonicalSeries: Record<string, Array<{ date: string; close: number }>> = {};
    for (const symbol of symbols) {
      const csv = csvSeries[symbol];
      const allDb = dbSeries[symbol] ?? [];
      const byDate = new Map(allDb.map(point => [point.date, point.close]));
      for (const point of csv) assert(byDate.get(point.date) === point.close, `${symbol} CSV value is missing or changed in DB: ${point.date} ${point.close}`);
      dbCanonicalSeries[symbol] = csv.map(point => ({ date: point.date, close: byDate.get(point.date)! }));
    }
    const csvReport = evaluateReleaseDayReactions(csvEvents, { DXY: csvSeries.DXY, XAUUSD: csvSeries.XAUUSD });
    const dbReport = evaluateReleaseDayReactions(canonicalDbRows.map(eventFromRow), { DXY: dbCanonicalSeries.DXY, XAUUSD: dbCanonicalSeries.XAUUSD });
    const coreCsv = csvReport.groups.find(group => group.indicator === "US_CORE_CPI" && group.target === "DXY");
    const coreDb = dbReport.groups.find(group => group.indicator === "US_CORE_CPI" && group.target === "DXY");
    assert(!!coreCsv && !!coreDb, "Missing Core CPI / DXY group");
    assert(JSON.stringify(coreDb.all) === JSON.stringify(coreCsv.all), "Database and CSV Core CPI / DXY statistics differ");
    assert(coreDb.all.n === 46 && coreDb.all.expectedSignMatchesPct?.toFixed(1) === "71.7", `Expected Core CPI / DXY n=46 and 71.7%, got n=${coreDb.all.n}, match=${coreDb.all.expectedSignMatchesPct}`);
    const nfpCsv = csvReport.groups.find(group => group.indicator === "US_NFP" && group.target === "DXY");
    const nfpDb = dbReport.groups.find(group => group.indicator === "US_NFP" && group.target === "DXY");
    assert(!!nfpCsv && !!nfpDb, "Missing NFP / DXY group");
    assert(JSON.stringify(nfpDb.all) === JSON.stringify(nfpCsv.all), "Database and CSV NFP / DXY statistics differ");
    assert(nfpDb.all.n === 69 && nfpDb.all.expectedSignMatchesPct?.toFixed(1) === "60.9", `Expected NFP / DXY n=69 and 60.9%, got n=${nfpDb.all.n}, match=${nfpDb.all.expectedSignMatchesPct}`);
    const goldCsv = csvReport.groups.find(group => group.indicator === "US_CORE_CPI" && group.target === "XAUUSD");
    const goldDb = dbReport.groups.find(group => group.indicator === "US_CORE_CPI" && group.target === "XAUUSD");
    assert(!!goldCsv && !!goldDb, "Missing Core CPI / XAUUSD group");
    assert(JSON.stringify(goldDb.all) === JSON.stringify(goldCsv.all), "Database and CSV Core CPI / XAUUSD statistics differ");
    assert(goldDb.all.n > 0, "Core CPI / XAUUSD has no reaction observations");
    console.log(`Parity passed: ${csvEvents.length} canonical release timestamps and ${dbBars.length} database price rows; every CSV price date/value is present unchanged at UTC/date precision.`);
    console.log(`Core CPI / DXY: n=${coreDb.all.n}, match=${coreDb.all.expectedSignMatchesPct?.toFixed(1)}%; database and CSV statistics match.`);
    console.log(`NFP / DXY: n=${nfpDb.all.n}, match=${nfpDb.all.expectedSignMatchesPct?.toFixed(1)}%; database and CSV statistics match.`);
    console.log(`Core CPI / XAUUSD: n=${goldDb.all.n}, match=${goldDb.all.expectedSignMatchesPct?.toFixed(1)}%; database and CSV statistics match.`);
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });