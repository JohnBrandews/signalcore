import { existsSync, readFileSync } from "node:fs";

import { PricePoint } from "../../src/daily-backtest";
import {
  EconomicEvent,
  EconomicIndicator,
  EventUnit,
  MarketInstrument,
  PolicySignal,
} from "../../src/models";
import { ReferenceTarget } from "../../src/daily-backtest";
import { INDICATOR_RULES } from "../../src/rules";
import { EventQualityRecord } from "./data-quality";
import {
  CsvError,
  cell,
  optionalNumber,
  oneOf,
  parseCsv,
  requireColumns,
  requiredCell,
  requiredNumber,
} from "./csv";

const INDICATORS = Object.keys(INDICATOR_RULES) as EconomicIndicator[];
const UNITS: EventUnit[] = ["percent", "index", "thousands", "basis_points", "text"];
const POLICY_SIGNALS: PolicySignal[] = ["HAWKISH", "NEUTRAL", "DOVISH"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isUtcTimestamp(timestamp: string): boolean {
  return /(?:Z|[+-]00:00|[+-]0000)$/i.test(timestamp);
}

export interface SkippedEvent {
  lineNumber: number;
  id: string;
  reason: string;
}

export interface LoadedEvents {
  events: EconomicEvent[];
  skipped: SkippedEvent[];
  rowsRead: number;
  qualityRecords: EventQualityRecord[];
}

function read(path: string, what: string): string {
  if (!existsSync(path)) {
    throw new CsvError(`${what} file not found: ${path}`);
  }
  return readFileSync(path, "utf8");
}

/**
 * events.csv columns:
 *   id, indicator, timestamp, actual, forecast, previous, unit, period,
 *   policySignal, expectedPolicySignal
 *
 * Rows missing `actual` or `forecast` are SKIPPED and counted, unless the row
 * carries a `policySignal` — those are scored against `expectedPolicySignal`
 * and need no numbers. Anything else wrong (unknown indicator, unparseable
 * timestamp, non-numeric number) is a hard error, not a silent skip.
 */
export function loadEvents(path: string, includeUnscorable = false): LoadedEvents {
  const table = parseCsv(path, read(path, "Events"));
  requireColumns(table, ["id", "indicator", "timestamp"]);

  const events: EconomicEvent[] = [];
  const skipped: SkippedEvent[] = [];
  const qualityRecords: EventQualityRecord[] = [];
  const seenIds = new Map<string, number>();

  for (const row of table.rows) {
    const id = requiredCell(table, row, "id");

    const firstSeen = seenIds.get(id);
    if (firstSeen !== undefined) {
      throw new CsvError(
        `${table.file}:${row.lineNumber}: duplicate event id "${id}" (first seen on line ${firstSeen})`,
      );
    }
    seenIds.set(id, row.lineNumber);

    const indicatorValue = requiredCell(table, row, "indicator");
    if (!INDICATORS.includes(indicatorValue as EconomicIndicator)) {
      throw new CsvError(
        `${table.file}:${row.lineNumber}: unknown indicator "${indicatorValue}". Known: ${INDICATORS.join(", ")}`,
      );
    }
    const indicator = indicatorValue as EconomicIndicator;

    const timestamp = requiredCell(table, row, "timestamp");
    if (!Number.isFinite(Date.parse(timestamp))) {
      throw new CsvError(
        `${table.file}:${row.lineNumber}: timestamp "${timestamp}" is not a parseable ISO date-time`,
      );
    }
    if (!isUtcTimestamp(timestamp)) {
      throw new CsvError(
        `${table.file}:${row.lineNumber}: timestamp "${timestamp}" is not UTC. Use ISO UTC, e.g. 2024-01-11T13:30:00Z`,
      );
    }

    const policySignal = oneOf(table, row, "policySignal", POLICY_SIGNALS);
    const expectedPolicySignal = oneOf(table, row, "expectedPolicySignal", POLICY_SIGNALS);
    const actual = optionalNumber(table, row, "actual");
    const forecast = optionalNumber(table, row, "forecast");
    const previous = optionalNumber(table, row, "previous");
    if (policySignal === undefined && (actual === undefined || forecast === undefined)) {
      const missing = [
        actual === undefined ? "actual" : null,
        forecast === undefined ? "forecast" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      qualityRecords.push({
        id,
        indicator,
        timestamp,
        hasForecast: forecast !== undefined,
        skipped: true,
        skippedForMissingForecast: forecast === undefined,
      });
      skipped.push({ lineNumber: row.lineNumber, id, reason: `missing ${missing}` });
      if (!includeUnscorable) continue;
    }
    qualityRecords.push({
      id,
      indicator,
      timestamp,
      hasForecast: forecast !== undefined,
      skipped: false,
      skippedForMissingForecast: false,
    });

    // Assumption: a blank `unit` is inferred rather than rejected, because the
    // engine only uses it for display. Policy rows become "text", numeric rows
    // "percent".
    const unit = oneOf(table, row, "unit", UNITS) ?? (policySignal ? "text" : "percent");

    // Assumption: a blank `period` falls back to the release month, which is
    // what the label is for.
    const period = cell(table, row, "period") || timestamp.slice(0, 7);

    events.push({
      id,
      indicator,
      timestamp,
      ...(actual !== undefined ? { actual } : {}),
      ...(forecast !== undefined ? { forecast } : {}),
      ...(previous !== undefined ? { previous } : {}),
      unit,
      period,
      ...(policySignal ? { policySignal } : {}),
      ...(expectedPolicySignal ? { expectedPolicySignal } : {}),
    });
  }

  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { events, skipped, rowsRead: table.rows.length, qualityRecords };
}

/** prices/<SYMBOL>.csv columns: date (YYYY-MM-DD), close. */
function loadPriceSeries(path: string, symbol: string, requirePositive: boolean): PricePoint[] {
  const table = parseCsv(path, read(path, `${symbol} price`));
  requireColumns(table, ["date", "close"]);

  const points: PricePoint[] = [];
  const seenDates = new Map<string, number>();

  for (const row of table.rows) {
    const date = requiredCell(table, row, "date");
    const dateMs = ISO_DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
    if (!Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== date) {
      throw new CsvError(
        `${table.file}:${row.lineNumber}: date "${date}" is not a valid YYYY-MM-DD calendar date`,
      );
    }
    const firstSeen = seenDates.get(date);
    if (firstSeen !== undefined) {
      throw new CsvError(
        `${table.file}:${row.lineNumber}: duplicate date "${date}" (first seen on line ${firstSeen})`,
      );
    }
    seenDates.set(date, row.lineNumber);

    const close = requiredNumber(table, row, "close");
    if (requirePositive && close <= 0) {
      throw new CsvError(
        `${table.file}:${row.lineNumber}: close must be positive for ${symbol}, got ${close}`,
      );
    }
    points.push({ date, close });
  }

  if (points.length === 0) throw new CsvError(`${table.file}: no price rows`);

  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
  return points;
}
/** prices/<INSTRUMENT>.csv columns: date (YYYY-MM-DD), close. */
export function loadPrices(path: string, instrument: MarketInstrument): PricePoint[] {
  return loadPriceSeries(path, instrument, true);
}

/** DXY is a price index; Treasury yields are allowed to be negative. */
export function loadReferencePrices(path: string, target: ReferenceTarget): PricePoint[] {
  return loadPriceSeries(path, target, target === "DXY");
}
