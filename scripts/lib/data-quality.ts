import { EconomicIndicator } from "../../src/models";

export interface EventQualityRecord {
  id: string;
  indicator: EconomicIndicator;
  timestamp: string;
  hasForecast: boolean;
  skipped: boolean;
  skippedForMissingForecast: boolean;
}

export interface QualityPriceRange {
  symbol: string;
  firstDate: string | null;
  lastDate: string | null;
}

export interface DataQualityReport {
  eventsPerIndicatorPerYear: Array<{ indicator: EconomicIndicator; year: number; count: number }>;
  indicatorMonthGaps: Array<{
    indicator: EconomicIndicator;
    missingMonths: string[];
    skippedMissingForecastMonths: string[];
  }>;
  duplicateEventIds: string[];
  eventsOutsidePriceRanges: Array<{ symbol: string; eventIds: string[] }>;
  eventsMissingForecast: number;
  totalEventRows: number;
  missingForecastPct: number | null;
  warnings: string[];
}

function monthSequence(first: string, last: string): string[] {
  const months: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  const lastYear = Number(last.slice(0, 4));
  const lastMonth = Number(last.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function buildDataQualityReport(
  records: readonly EventQualityRecord[],
  priceRanges: readonly QualityPriceRange[],
): DataQualityReport {
  const counts = new Map<string, { indicator: EconomicIndicator; year: number; count: number }>();
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  let missingForecast = 0;

  for (const record of records) {
    const year = Number(record.timestamp.slice(0, 4));
    const key = `${record.indicator}|${year}`;
    const entry = counts.get(key) ?? { indicator: record.indicator, year, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
    if (ids.has(record.id)) duplicates.add(record.id);
    ids.add(record.id);
    if (!record.hasForecast) missingForecast += 1;
  }

  const indicators = [...new Set(records.map((record) => record.indicator))].sort();
  const indicatorMonthGaps = indicators.flatMap((indicator) => {
    const own = records.filter((record) => record.indicator === indicator);
    const timestamps = own.map((record) => record.timestamp.slice(0, 7)).sort();
    const months = monthSequence(timestamps[0], timestamps[timestamps.length - 1]);
    const scoredMonths = new Set(
      own.filter((record) => !record.skipped).map((record) => record.timestamp.slice(0, 7)),
    );
    const missingMonths = months.filter((month) => !scoredMonths.has(month));
    if (missingMonths.length === 0) return [];
    const skippedForecastMonths = missingMonths.filter((month) =>
      own.some(
        (record) => record.skippedForMissingForecast && record.timestamp.slice(0, 7) === month,
      ),
    );
    return [{ indicator, missingMonths, skippedMissingForecastMonths: skippedForecastMonths }];
  });
  const eventsOutsidePriceRanges = priceRanges.flatMap((range) => {
    if (range.firstDate === null || range.lastDate === null) return [];
    const eventIds = records
      .filter((record) => {
        const date = record.timestamp.slice(0, 10);
        return date < range.firstDate! || date > range.lastDate!;
      })
      .map((record) => record.id);
    return eventIds.length === 0 ? [] : [{ symbol: range.symbol, eventIds }];
  });
  const warnings = [
    ...eventsOutsidePriceRanges.map(
      ({ symbol, eventIds }) =>
        `${eventIds.length} event(s) fall outside ${symbol} price dates (${eventIds.slice(0, 5).join(", ")}${eventIds.length > 5 ? ", ..." : ""}).`,
    ),
  ];

  return {
    eventsPerIndicatorPerYear: [...counts.values()].sort(
      (left, right) => left.year - right.year || left.indicator.localeCompare(right.indicator),
    ),
    indicatorMonthGaps,
    duplicateEventIds: [...duplicates].sort(),
    eventsOutsidePriceRanges,
    eventsMissingForecast: missingForecast,
    totalEventRows: records.length,
    missingForecastPct: records.length === 0 ? null : (missingForecast / records.length) * 100,
    warnings,
  };
}
