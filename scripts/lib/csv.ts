/**
 * Minimal CSV reader for the backtest inputs.
 *
 * Deliberately small: RFC-4180 quoting on a single line, no embedded newlines
 * inside quoted fields. Every failure carries the file name, the line number
 * and the column, because a silent coercion in a backtest loader is how you
 * end up trusting a number that was never there.
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export interface CsvRow {
  /** 1-based line number in the source file, header included. */
  lineNumber: number;
  values: Record<string, string>;
}

export interface CsvTable {
  file: string;
  columns: string[];
  rows: CsvRow[];
}

function splitLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCsv(file: string, text: string): CsvTable {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) throw new CsvError(`${file}: file is empty`);

  const columns = splitLine(lines[headerIndex]).map((name) => name.trim());
  const duplicate = columns.find((name, i) => columns.indexOf(name) !== i);
  if (duplicate) throw new CsvError(`${file}: duplicate column "${duplicate}" in the header`);

  const rows: CsvRow[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) continue;

    const fields = splitLine(line);
    if (fields.length !== columns.length) {
      throw new CsvError(
        `${file}:${i + 1}: expected ${columns.length} columns (${columns.join(", ")}), got ${fields.length}`,
      );
    }
    const values: Record<string, string> = {};
    columns.forEach((name, index) => {
      values[name] = fields[index].trim();
    });
    rows.push({ lineNumber: i + 1, values });
  }

  return { file, columns, rows };
}

export function requireColumns(table: CsvTable, required: string[]): void {
  const missing = required.filter((name) => !table.columns.includes(name));
  if (missing.length > 0) {
    throw new CsvError(
      `${table.file}: missing required column(s): ${missing.join(", ")}. Found: ${table.columns.join(", ")}`,
    );
  }
}

export function cell(table: CsvTable, row: CsvRow, column: string): string {
  return row.values[column] ?? "";
}

export function requiredCell(table: CsvTable, row: CsvRow, column: string): string {
  const value = cell(table, row, column);
  if (value.length === 0) {
    throw new CsvError(`${table.file}:${row.lineNumber}: "${column}" is required but empty`);
  }
  return value;
}

/** Parses an optional numeric cell. Empty -> undefined. Non-numeric -> hard error. */
export function optionalNumber(table: CsvTable, row: CsvRow, column: string): number | undefined {
  const value = cell(table, row, column);
  if (value.length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CsvError(`${table.file}:${row.lineNumber}: "${column}" is not a number: "${value}"`);
  }
  return parsed;
}

export function requiredNumber(table: CsvTable, row: CsvRow, column: string): number {
  const parsed = optionalNumber(table, row, column);
  if (parsed === undefined) {
    throw new CsvError(`${table.file}:${row.lineNumber}: "${column}" is required but empty`);
  }
  return parsed;
}

export function oneOf<T extends string>(
  table: CsvTable,
  row: CsvRow,
  column: string,
  allowed: readonly T[],
): T | undefined {
  const value = cell(table, row, column);
  if (value.length === 0) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new CsvError(
      `${table.file}:${row.lineNumber}: "${column}" must be one of ${allowed.join(" | ")}, got "${value}"`,
    );
  }
  return value as T;
}
