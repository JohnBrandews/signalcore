/**
 * Downloads public FRED market series as raw CSVs without an API key.
 *
 *   npm run fetch-fred-prices
 *
 * DEXJPUS is a noon-New-York-rate series, which differs slightly from a
 * 21:00 UTC close. Existing raw files are never overwritten.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CsvError } from "./lib/csv";
import { parseRawPrices, PreparedSymbol } from "./lib/price-data";

const SERIES: Array<{ symbol: PreparedSymbol; seriesId: string }> = [
  { symbol: "USDJPY", seriesId: "DEXJPUS" },
  { symbol: "REAL10Y", seriesId: "DFII10" },
  { symbol: "UST10Y", seriesId: "DGS10" },
];

async function fetchSeries(seriesId: string): Promise<string> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "text/csv" } });
  } catch (error) {
    throw new Error(
      `Could not download FRED series ${seriesId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not download FRED series ${seriesId}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

async function main(): Promise<void> {
  const rawDirectory = resolve(process.cwd(), "data", "real", "raw");
  const destinations = SERIES.map(({ symbol }) => resolve(rawDirectory, `${symbol}.csv`));
  const existing = destinations.filter((path) => existsSync(path));
  if (existing.length > 0) {
    throw new CsvError(
      `Refusing to overwrite existing raw file(s):\n${existing.map((path) => `  ${path}`).join("\n")}\nMove or rename them before downloading.`,
    );
  }

  const downloaded = await Promise.all(
    SERIES.map(async ({ symbol, seriesId }) => {
      const text = await fetchSeries(seriesId);
      parseRawPrices(text, symbol, `${seriesId} (FRED response)`);
      return { symbol, seriesId, text };
    }),
  );

  mkdirSync(rawDirectory, { recursive: true });
  for (const { symbol, seriesId, text } of downloaded) {
    const outputPath = resolve(rawDirectory, `${symbol}.csv`);
    writeFileSync(outputPath, text, "utf8");
    console.log(`${seriesId} -> ${outputPath}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFRED price download failed: ${message}\nNo substitute data was used.\n`);
  process.exitCode = 1;
});
