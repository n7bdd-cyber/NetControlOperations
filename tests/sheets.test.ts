/**
 * Unit tests for src/server/sheets.ts.
 *
 * Teaching notes:
 *  - These tests rely on the Apps Script mocks installed by tests/setup.ts
 *    (loaded via jest.config.js's setupFilesAfterEach hook).
 *  - The mock Spreadsheet's "tabs" live in a Map<sheetName, row[][]>. The helper
 *    `setMockProperty('SpreadsheetId', 'X')` simulates a configured Spreadsheet.
 */

import {
  getSpreadsheetOrNull,
  getSheetOrNull,
  getOrCreateSheetWithHeader,
  appendRowAndGetIndex,
  findRowIndex,
  readRow,
  updateCells,
  withLock,
} from '../src/server/sheets';
import {
  setMockProperty,
  setMockSpreadsheetExists,
  setLockAvailable,
  getReleaseLockSpy,
  MOCK_SPREADSHEET_ID,
} from './setup';
// (resetMocks is registered globally inside setup.ts; no per-file registration needed.)

describe('getSpreadsheetOrNull', () => {
  it('returns null when SpreadsheetId property is unset', () => {
    expect(getSpreadsheetOrNull()).toBeNull();
  });

  it('returns the spreadsheet when SpreadsheetId is set and openable', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    const ss = getSpreadsheetOrNull();
    expect(ss).not.toBeNull();
    expect(ss?.getId()).toBe(MOCK_SPREADSHEET_ID);
  });

  it('returns null when openById throws', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockSpreadsheetExists(false);
    expect(getSpreadsheetOrNull()).toBeNull();
  });
});

describe('getSheetOrNull', () => {
  beforeEach(() => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
  });

  it('returns null when the named tab is absent', () => {
    const ss = getSpreadsheetOrNull()!;
    expect(getSheetOrNull(ss, 'Sessions')).toBeNull();
  });

  it('returns the sheet when present', () => {
    const ss = getSpreadsheetOrNull()!;
    ss.insertSheet('Sessions');
    expect(getSheetOrNull(ss, 'Sessions')).not.toBeNull();
  });
});

describe('getOrCreateSheetWithHeader', () => {
  beforeEach(() => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
  });

  it('creates the sheet with the header row and frozen row 1 when absent', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet, created } = getOrCreateSheetWithHeader(ss, 'Sessions', ['A', 'B', 'C']);
    expect(created).toBe(true);
    expect(sheet.getRange(1, 1, 1, 3).getValues()).toEqual([['A', 'B', 'C']]);
  });

  it('returns existing sheet untouched when present', () => {
    const ss = getSpreadsheetOrNull()!;
    const first = getOrCreateSheetWithHeader(ss, 'Sessions', ['A', 'B', 'C']);
    // Append a data row.
    first.sheet.appendRow(['x', 'y', 'z']);

    const second = getOrCreateSheetWithHeader(ss, 'Sessions', ['DIFFERENT', 'HEADERS', 'IGNORED']);
    expect(second.created).toBe(false);
    // Header row preserved.
    expect(second.sheet.getRange(1, 1, 1, 3).getValues()).toEqual([['A', 'B', 'C']]);
    // Data row preserved.
    expect(second.sheet.getRange(2, 1, 1, 3).getValues()).toEqual([['x', 'y', 'z']]);
  });

  it('calls setFrozenRows(1) on newly created sheets', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet } = getOrCreateSheetWithHeader(ss, 'Sessions', ['A', 'B', 'C']);
    // The mock's setFrozenRows is a jest.fn(); cast to read its calls.
    const setFrozen = sheet.setFrozenRows as unknown as jest.Mock;
    expect(setFrozen).toHaveBeenCalledWith(1);
  });

  it('writes headers and freezes row 1 when existing sheet is blank', () => {
    const ss = getSpreadsheetOrNull()!;
    // Insert a blank sheet (simulates a pre-existing sheet with no data).
    ss.insertSheet('Roster');
    const { sheet, created } = getOrCreateSheetWithHeader(ss, 'Roster', ['Callsign', 'Name', 'LicenseClass']);
    expect(created).toBe(false);
    expect(sheet.getRange(1, 1, 1, 3).getValues()).toEqual([['Callsign', 'Name', 'LicenseClass']]);
    const setFrozen = sheet.setFrozenRows as unknown as jest.Mock;
    expect(setFrozen).toHaveBeenCalledWith(1);
  });
});

describe('appendRowAndGetIndex', () => {
  beforeEach(() => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
  });

  it('appends a row and returns the new 1-indexed row number', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet } = getOrCreateSheetWithHeader(ss, 'Sessions', ['A', 'B']);
    const idx1 = appendRowAndGetIndex(sheet, ['x', 'y']);
    const idx2 = appendRowAndGetIndex(sheet, ['p', 'q']);
    expect(idx1).toBe(2);
    expect(idx2).toBe(3);
  });
});

describe('findRowIndex', () => {
  beforeEach(() => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
  });

  it('returns the 1-indexed row when predicate matches', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet } = getOrCreateSheetWithHeader(ss, 'Sessions', ['Id', 'Name']);
    appendRowAndGetIndex(sheet, ['a', 'Alice']);
    appendRowAndGetIndex(sheet, ['b', 'Bob']);
    const idx = findRowIndex(sheet, (row) => row[0] === 'b');
    expect(idx).toBe(3);
  });

  it('returns -1 when no row matches', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet } = getOrCreateSheetWithHeader(ss, 'Sessions', ['Id', 'Name']);
    appendRowAndGetIndex(sheet, ['a', 'Alice']);
    expect(findRowIndex(sheet, (row) => row[0] === 'z')).toBe(-1);
  });

  it('skips the header row', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet } = getOrCreateSheetWithHeader(ss, 'Sessions', ['Id', 'Name']);
    appendRowAndGetIndex(sheet, ['a', 'Alice']);
    // Predicate that would match the header but should be skipped.
    expect(findRowIndex(sheet, (row) => row[0] === 'Id')).toBe(-1);
  });
});

describe('readRow / updateCells', () => {
  beforeEach(() => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
  });

  it('readRow returns the cells in the row', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet } = getOrCreateSheetWithHeader(ss, 'Sessions', ['A', 'B', 'C']);
    appendRowAndGetIndex(sheet, ['x', 'y', 'z']);
    expect(readRow(sheet, 2)).toEqual(['x', 'y', 'z']);
  });

  it('updateCells writes the given cells, leaves others alone', () => {
    const ss = getSpreadsheetOrNull()!;
    const { sheet } = getOrCreateSheetWithHeader(ss, 'Sessions', ['A', 'B', 'C']);
    appendRowAndGetIndex(sheet, ['x', 'y', 'z']);
    updateCells(sheet, 2, { 2: 'Y!' });
    expect(readRow(sheet, 2)).toEqual(['x', 'Y!', 'z']);
  });
});

describe('withLock', () => {
  it('calls fn() and returns its result when lock acquired', () => {
    const result = withLock(() => 42);
    expect(result).toBe(42);
  });

  it("returns 'BUSY' and does NOT call fn when tryLock returns false", () => {
    setLockAvailable(false);
    const fn = jest.fn(() => 'wont-run');
    const result = withLock(fn);
    expect(result).toBe('BUSY');
    expect(fn).not.toHaveBeenCalled();
  });

  it('releases the lock on success', () => {
    const releaseLock = getReleaseLockSpy();
    withLock(() => 1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when fn() throws (exception propagates)', () => {
    const releaseLock = getReleaseLockSpy();
    expect(() =>
      withLock(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});
