import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { loadEvents, loadPrices, loadReferencePrices } from "./lib/load-data";
import { CsvError } from "./lib/csv";

function loadLocalEnv(): void {
  const path = resolve(process.cwd(), ".env");
  try {
    const contents = readFileSync(path, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || process.env[match[1]]) continue;
      const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch {
    // Environment variables may be supplied by the shell or deployment platform.
  }
}

async function withConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  for (let offset = 0; offset < items.length; offset += concurrency) {
    await Promise.all(items.slice(offset, offset + concurrency).map(task));
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to seed the database.");

  const root = process.cwd();
  const eventsPath = resolve(root, "data/real/events.csv");
  // includeUnscorable keeps each validated release row for persistence while
  // preserving the backtest's default behavior of skipping it for scoring.
  const loaded = loadEvents(eventsPath, true);
  const symbols = ["XAUUSD", "USDJPY", "UST10Y", "REAL10Y", "DXY"] as const;
  const prices = symbols.map((symbol) => ({
    symbol,
    rows:
      symbol === "XAUUSD" || symbol === "USDJPY"
        ? loadPrices(resolve(root, `data/real/prices/${symbol}.csv`), symbol)
        : loadReferencePrices(resolve(root, `data/real/prices/${symbol}.csv`), symbol),
  }));

  const prisma = new PrismaClient();
  try {
    await withConcurrency(loaded.events, 20, async (event) => {
      await prisma.release.upsert({
        where: { externalId: event.id },
        create: {
          externalId: event.id,
          indicator: event.indicator,
          releasedAt: new Date(event.timestamp),
          actual: event.actual ?? null,
          forecast: event.forecast ?? null,
          previous: event.previous ?? null,
          unit: event.unit,
          period: event.period,
          policySignal: event.policySignal ?? null,
          expectedPolicySignal: event.expectedPolicySignal ?? null,
          source: "data/real/events.csv",
        },
        update: {
          indicator: event.indicator,
          releasedAt: new Date(event.timestamp),
          actual: event.actual ?? null,
          forecast: event.forecast ?? null,
          previous: event.previous ?? null,
          unit: event.unit,
          period: event.period,
          policySignal: event.policySignal ?? null,
          expectedPolicySignal: event.expectedPolicySignal ?? null,
          source: "data/real/events.csv",
        },
      });
    });

    for (const { symbol, rows } of prices) {
      await withConcurrency(rows, 40, async (point) => {
        const date = new Date(`${point.date}T00:00:00.000Z`);
        await prisma.priceBar.upsert({
          where: { symbol_date: { symbol, date } },
          create: { symbol, date, close: point.close, source: `data/real/prices/${symbol}.csv` },
          update: { close: point.close, source: `data/real/prices/${symbol}.csv` },
        });
      });
      const latest = rows.reduce((a, b) => a.date > b.date ? a : b);
      const latestDate = new Date(`${latest.date}T00:00:00.000Z`);
      const now = new Date();
      const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const lagDays = Math.max(0, Math.floor((todayUtc - latestDate.getTime()) / 86_400_000));
      await prisma.priceSeriesStatus.upsert({
        where: { symbol },
        create: { symbol, latestDate, lagDays, source: `data/real/prices/${symbol}.csv` },
        update: { latestDate, lagDays, source: `data/real/prices/${symbol}.csv` },
      });
    }

    const [releaseCount, priceCounts] = await Promise.all([
      prisma.release.count(),
      Promise.all(
        symbols.map(async (symbol) => ({
          symbol,
          count: await prisma.priceBar.count({ where: { symbol } }),
        })),
      ),
    ]);
    console.log(
      `Releases seeded: ${loaded.events.length} CSV rows; ${releaseCount} total in database.`,
    );
    for (const { symbol, rows } of prices) {
      const count = priceCounts.find((entry) => entry.symbol === symbol)?.count ?? 0;
      console.log(`${symbol} prices seeded: ${rows.length} CSV rows; ${count} total in database.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof CsvError) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
});

