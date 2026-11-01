/**
 * Convert user-supplied daily CSVs from data/real/raw into validated
 * date,close series in data/real/prices. Flagged observations are retained.
 *
 *   npm run prepare-prices
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CsvError } from "./lib/csv";
import { parseRawPrices, PreparedSymbol, priceFlags } from "./lib/price-data";

const REQUIRED_SYMBOLS: PreparedSymbol[] = ["XAUUSD", "USDJPY"];
const OPTIONAL_SYMBOLS: PreparedSymbol[] = ["DXY", "REAL10Y", "UST10Y"];
const ALL_SYMBOLS = [...REQUIRED_SYMBOLS, ...OPTIONAL_SYMBOLS];

function main(): void {
  const rawDirectory = resolve(process.cwd(), "data", "real", "raw");
  const outputDirectory = resolve(process.cwd(), "data", "real", "prices");
  const parsed = new Map<
    PreparedSymbol,
    ReturnType<typeof parseRawPrices> & { flags: ReturnType<typeof priceFlags> }
  >();
  const missingRequired: string[] = [];

  for (const symbol of ALL_SYMBOLS) {
    const inputPath = resolve(rawDirectory, `${symbol}.csv`);
    if (!existsSync(inputPath)) {
      if (REQUIRED_SYMBOLS.includes(symbol)) missingRequired.push(inputPath);
      else console.log(`SKIP ${inputPath} (optional reference target is missing)`);
      continue;
    }
    const text = readFileSync(inputPath, "utf8");
    const result = parseRawPrices(text, symbol, inputPath);
    parsed.set(symbol, { ...result, flags: priceFlags(result.points, symbol) });
  }

  if (missingRequired.length > 0) {
    throw new CsvError(
      `Required raw price file(s) missing:\n${missingRequired.map((path) => `  ${path}`).join("\n")}`,
    );
  }

  mkdirSync(outputDirectory, { recursive: true });
  for (const symbol of ALL_SYMBOLS) {
    const result = parsed.get(symbol);
    if (result === undefined) continue;

    const outputPath = resolve(outputDirectory, `${symbol}.csv`);
    const csv = [
      "date,close",
      ...result.points.map((point) => `${point.date},${point.close}`),
      "",
    ].join("\n");
    writeFileSync(outputPath, csv, "utf8");

    const first = result.points[0];
    const last = result.points[result.points.length - 1];
    console.log(
      `${symbol}: ${result.points.length} rows; ${first.date} .. ${last.date}; format=${result.format}`,
    );
    if (result.flags.length === 0) {
      console.log("  flagged rows: none");
    } else {
      console.log(`  flagged rows: ${result.flags.length} (retained; review manually)`);
      for (const flag of result.flags) {
        console.log(`    ${flag.date} ${flag.type}: ${flag.detail}`);
      }
    }
    console.log(`  wrote ${outputPath}`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nPrice preparation failed: ${message}\n`);
  process.exitCode = 1;
}
