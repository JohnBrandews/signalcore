import { prisma } from "./prisma";
import { calculateReleaseChange, releaseChangeMeasure } from "./analysis/release-reaction";
import type { ReactionTarget } from "./analysis/release-reaction";
import type { ProviderPrice } from "./prices/types";

export async function persistPrices(rows: readonly ProviderPrice[]) {
  const grouped = new Map<string, ProviderPrice[]>();
  let inserted = 0;
  let unchanged = 0;
  let changedExisting = 0;
  for (const row of rows) grouped.set(row.symbol, [...(grouped.get(row.symbol) ?? []), row]);
  for (const [symbol, points] of grouped) {
    for (const point of points) {
      const date = new Date(`${point.date}T00:00:00.000Z`);
      try {
        await prisma.priceBar.create({ data: { symbol, date, close: point.close, source: point.source } });
        inserted++;
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
        const existing = await prisma.priceBar.findUnique({ where: { symbol_date: { symbol, date } } });
        if (!existing) throw error;
        if (existing.close !== point.close) {
          changedExisting++;
          console.warn(`FRED value differs from stored ${symbol} ${point.date}: stored=${existing.close}, received=${point.close}; existing row was retained.`);
        } else unchanged++;
      }
    }
    const latest = points.reduce((a, b) => a.date > b.date ? a : b);
    const day = new Date(`${latest.date}T00:00:00.000Z`);
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const lagDays = Math.max(0, Math.floor((todayUtc - day.getTime()) / 86_400_000));
    await prisma.priceSeriesStatus.upsert({ where: { symbol }, create: { symbol, latestDate: day, lagDays, source: latest.source }, update: { latestDate: day, lagDays, source: latest.source } });
  }
  return { inserted, unchanged, changedExisting };
}

export async function computeMissingReleaseReactions() {
  const targets: ReactionTarget[] = ["DXY", "USDJPY", "UST10Y", "REAL10Y", "XAUUSD"];
  const [releases, bars] = await Promise.all([
    prisma.release.findMany({ where: { actual: { not: null }, forecast: { not: null } } }),
    prisma.priceBar.findMany({ where: { symbol: { in: targets } }, orderBy: { date: "asc" } }),
  ]);
  const series = new Map<string, typeof bars>();
  for (const bar of bars) series.set(bar.symbol, [...(series.get(bar.symbol) ?? []), bar]);
  let created = 0;
  for (const release of releases) {
    const releaseDay = release.releasedAt.toISOString().slice(0, 10);
    for (const symbol of targets) {
      const points = series.get(symbol) ?? [];
      const currentIndex = points.findIndex((bar) => bar.date.toISOString().slice(0, 10) === releaseDay);
      if (currentIndex <= 0) continue;
      const current = points[currentIndex];
      const prior = points[currentIndex - 1];
      const measure = releaseChangeMeasure(symbol);
      const change = calculateReleaseChange(prior.close, current.close, measure);
      const existing = await prisma.releaseReaction.findUnique({ where: { releaseId_symbol: { releaseId: release.id, symbol } } });
      if (existing) continue;
      await prisma.releaseReaction.create({ data: { releaseId: release.id, symbol, measure: measure === "percent_return" ? "pct" : "abs_pp", change, priorDate: prior.date, releaseDate: current.date } });
      created++;
    }
  }
  return { releases: releases.length, created };
}
