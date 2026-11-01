import { prisma } from "./prisma";
import { FRED_AUTOMATED_SYMBOLS, FredProvider } from "./prices/fred-provider";
import { persistPrices } from "./ingestion";

export async function ingestFredPrices() {
  const provider = new FredProvider();
  const results: Array<{ symbol: string; rows?: number; inserted?: number; changedExisting?: number; error?: string }> = [];
  for (const symbol of FRED_AUTOMATED_SYMBOLS) {
    try {
      const latest = await prisma.priceBar.findFirst({ where: { symbol }, orderBy: { date: "desc" } });
      const since = latest ? new Date(latest.date.getTime() - 7 * 86_400_000).toISOString().slice(0, 10) : undefined;
      const rows = await provider.fetch(symbol, since);
      const saved = await persistPrices(rows);
      results.push({ symbol, rows: rows.length, inserted: saved.inserted, changedExisting: saved.changedExisting });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Price ingestion failed for ${symbol}: ${message}`);
      results.push({ symbol, error: message });
    }
  }
  return { provider: provider.name, results, failed: results.some(row => !!row.error) };
}
