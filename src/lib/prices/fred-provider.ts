import type { PriceSource, ProviderPrice } from "./types";

const FRED_SERIES: Record<string, string> = { UST10Y: "DGS10", REAL10Y: "DFII10", USDJPY: "DEXJPUS", DXY: "DTWEXBGS" };

/** Public FRED graph CSV adapter. DTWEXBGS is a broad dollar index proxy, not ICE DXY. */
export class FredProvider implements PriceSource {
  readonly name = "FRED";
  async fetch(symbol: string, startDate?: string): Promise<ProviderPrice[]> {
    const series = FRED_SERIES[symbol];
    if (!series) throw new Error(`FRED has no configured series for ${symbol}`);
    const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
    url.searchParams.set("id", series);
    if (startDate) url.searchParams.set("cosd", startDate);
    const response = await fetch(url, { headers: { accept: "text/csv" }, cache: "no-store" });
    if (!response.ok) throw new Error(`FRED ${series} returned HTTP ${response.status}`);
    const lines = (await response.text()).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error(`FRED ${series} returned no observations`);
    const headers = lines[0].split(",").map((part) => part.replace(/^"|"$/g, ""));
    const dateIndex = headers.indexOf("observation_date");
    const valueIndex = headers.indexOf(series);
    if (dateIndex < 0 || valueIndex < 0) throw new Error(`Unexpected FRED ${series} CSV header`);
    const rows: ProviderPrice[] = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(",").map((part) => part.replace(/^"|"$/g, ""));
      const date = cells[dateIndex];
      const raw = cells[valueIndex];
      const close = Number(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) || raw.trim() === "" || raw === "." || !Number.isFinite(close)) continue;
      rows.push({ symbol, date, close, source: `FRED:${series}` });
    }
    if (rows.length === 0) throw new Error(`FRED ${series} has no usable observations`);
    return rows;
  }
}
export const FRED_AUTOMATED_SYMBOLS = Object.keys(FRED_SERIES);



