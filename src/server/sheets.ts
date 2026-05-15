/**
 * Sheet access helpers.
 *
 * Teaching notes:
 *  - All Sheet read/write paths in the server code go through this module so
 *    behavior is consistent (and so jest can verify lock acquisition via spies).
 *  - `withLock` is the single place that wraps `LockService.getScriptLock().tryLock(...)`
 *    in a try/finally. The lock is released even if `fn()` throws.
 *  - Generic functions: `withLock<T>(fn: () => T): T | 'BUSY'` — the `<T>` is a
 *    type parameter, the same idea as a parameterized class in other languages.
 *    TypeScript infers `T` from how `fn` is typed at the call site.
 */

import { PROP_SPREADSHEET_ID } from './types';

const LOCK_TIMEOUT_MS = 10000;

/**
 * Open the configured Spreadsheet, or return null if SpreadsheetId is missing
 * or the Sheet can't be opened. Does NOT acquire a lock; callers do.
 */
export function getSpreadsheetOrNull(): GoogleAppsScript.Spreadsheet.Spreadsheet | null {
  const id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) return null;
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    Logger.log(`getSpreadsheetOrNull: openById failed: ${String(e)}`);
    return null;
  }
}

/**
 * Return the named sheet if present, otherwise null. Read-only — never creates.
 */
export function getSheetOrNull(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: string,
): GoogleAppsScript.Spreadsheet.Sheet | null {
  return ss.getSheetByName(name);
}

/**
 * Idempotent: returns the existing sheet (data preserved, headers NOT rewritten)
 * if present; creates the sheet with the given header row and `setFrozenRows(1)`
 * if absent. The `created` flag tells the caller which branch ran.
 *
 * Used ONLY by setupSheets.
 */
export function getOrCreateSheetWithHeader(
  ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
  name: string,
  headers: readonly string[],
): { sheet: GoogleAppsScript.Spreadsheet.Sheet; created: boolean } {
  const existing = ss.getSheetByName(name);
  if (existing) {
    // If the sheet exists but has no header row, write one now.
    if (existing.getLastRow() === 0) {
      existing.getRange(1, 1, 1, headers.length).setValues([[...headers]]);
      existing.setFrozenRows(1);
    }
    return { sheet: existing, created: false };
  }
  const sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([[...headers]]);
  sheet.setFrozenRows(1);
  return { sheet, created: true };
}

/**
 * Append a row and return the 1-indexed sheet row number for the new row.
 * Apps Script's `appendRow` returns void, so we use `getLastRow()` immediately
 * after — safe because the caller holds the script lock.
 */
export function appendRowAndGetIndex(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  values: readonly unknown[],
): number {
  sheet.appendRow([...values]);
  return sheet.getLastRow();
}

/**
 * Linear scan over the sheet's data, skipping the header row.
 * Returns the 1-indexed row number when predicate is true, else -1.
 *
 * The predicate receives a 0-indexed row array (same shape as
 * `getDataRange().getValues()[i]`).
 */
export function findRowIndex(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  predicate: (row: unknown[]) => boolean,
): number {
  const values = sheet.getDataRange().getValues();
  // Start at index 1 to skip the header row (row 1 in Sheet terms).
  for (let i = 1; i < values.length; i++) {
    if (predicate(values[i])) {
      return i + 1; // convert 0-based array index to 1-based sheet row
    }
  }
  return -1;
}

/**
 * Read the entire row at the 1-indexed row number and return its cell values.
 * Uses `getLastColumn()` (single API call returning a number) rather than reading
 * the whole sheet just to learn the column count.
 */
export function readRow(sheet: GoogleAppsScript.Spreadsheet.Sheet, rowIndex: number): unknown[] {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
}

/**
 * Sparse cell update: write only the named (1-indexed) columns in the given row.
 * `updates` is keyed by 1-indexed column number.
 *
 * Batches into a single read + single write across the minimum spanning range
 * (rather than one setValue API call per cell) to keep lock-hold time short
 * and Sheet write quota usage low.
 */
export function updateCells(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  rowIndex: number,
  updates: Record<number, unknown>,
): void {
  const cols = Object.keys(updates).map(Number).sort((a, b) => a - b);
  if (cols.length === 0) return;
  const minCol = cols[0];
  const maxCol = cols[cols.length - 1];
  const span = maxCol - minCol + 1;
  const range = sheet.getRange(rowIndex, minCol, 1, span);
  const current = range.getValues()[0];
  for (const col of cols) {
    current[col - minCol] = updates[col];
  }
  range.setValues([current]);
}

/**
 * Wrap a function with LockService.getScriptLock().tryLock(...). Returns the
 * function's value on success, or the literal string 'BUSY' if the lock could
 * not be acquired within the timeout. The lock is released in a `finally` block
 * — exceptions inside fn() propagate AFTER the lock is released.
 */
export function withLock<T>(fn: () => T): T | 'BUSY' {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return 'BUSY';
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
