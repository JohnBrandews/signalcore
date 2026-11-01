import { CsvError, parseCsv } from "./csv";

export type RawPriceFormat = "yahoo" | "stooq" | "fred";
export type PreparedSymbol = "XAUUSD" | "USDJPY" | "DXY" | "REAL10Y" | "UST10Y";

export interface PreparedPricePoint {
  date: string;
  close: number;
}

export interface PriceFlag {
  type: "gap" | "large_move";
  date: string;
  detail: string;
}

const PRICE_SYMBOLS: PreparedSymbol[] = ["XAUUSD", "USDJPY", "DXY"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateValue = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const isValidDate = (date: string): boolean => {
  if (!ISO_DATE.test(date)) return false;
  const timestamp = dateValue(date);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
};

function header(table: ReturnType<typeof parseCsv>, name: string): string | undefined {
  return table.columns.find((column) => column.toLowerCase() === name.toLowerCase());
}

export function detectRawPriceFormat(text: string, file = "inline.csv"): RawPriceFormat {
  const table = parseCsv(file, text);
  const first = table.columns[0]?.toLowerCase();
  if (first === "observation_date" && table.columns.length === 2) return "fred";
  if (header(table, "date") && header(table, "close") && header(table, "adj close")) return "yahoo";
  if (header(table, "date") && header(table, "close")) return "stooq";
  throw new CsvError(
    `${file}: unsupported header. Expected Yahoo history (Date, Close, Adj Close), Stooq (Date, Close), or two-column FRED (observation_date, series).`,
  );
}

export function parseRawPrices(
  text: string,
  symbol: PreparedSymbol,
  file = "inline.csv",
): { format: RawPriceFormat; points: PreparedPricePoint[] } {
  const table = parseCsv(file, text);
  const format = detectRawPriceFormat(text, file);
  const dateColumn = format === "fred" ? table.columns[0] : header(table, "date")!;
  const closeColumn = format === "fred" ? table.columns[1] : header(table, "close")!;
  const seen = new Set<string>();
  const points: PreparedPricePoint[] = [];

  for (const row of table.rows) {
    const date = row.values[dateColumn];
    if (!isValidDate(date)) {
      throw new CsvError(`${file}:${row.lineNumber}: invalid date "${date}"; expected YYYY-MM-DD`);
    }
    if (seen.has(date)) throw new CsvError(`${file}:${row.lineNumber}: duplicate date "${date}"`);
    seen.add(date);
    const raw = row.values[closeColumn];
    if (format === "fred" && (raw === "" || raw === ".")) continue;
    const close = raw === "" ? Number.NaN : Number(raw);
    if (!Number.isFinite(close)) {
      throw new CsvError(`${file}:${row.lineNumber}: close is not numeric: "${raw}"`);
    }
    if (PRICE_SYMBOLS.includes(symbol) && close <= 0) {
      throw new CsvError(
        `${file}:${row.lineNumber}: close must be positive for ${symbol}, got ${close}`,
      );
    }
    points.push({ date, close });
  }
  if (points.length === 0) throw new CsvError(`${file}: no usable rows after FRED missing values`);
  points.sort((left, right) => left.date.localeCompare(right.date));
  return { format, points };
}

export function priceFlags(
  points: readonly PreparedPricePoint[],
  symbol: PreparedSymbol,
): PriceFlag[] {
  const flags: PriceFlag[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const prior = points[index - 1];
    const current = points[index];
    const days = (dateValue(current.date) - dateValue(prior.date)) / 86_400_000;
    if (days > 5)
      flags.push({
        type: "gap",
        date: current.date,
        detail: `${days} calendar days since ${prior.date}`,
      });
    if (PRICE_SYMBOLS.includes(symbol)) {
      const movePct = (current.close / prior.close - 1) * 100;
      if (Math.abs(movePct) > 8) {
        flags.push({
          type: "large_move",
          date: current.date,
          detail: `${movePct.toFixed(2)}% from ${prior.date}`,
        });
      }
    }
  }
  return flags;
}
