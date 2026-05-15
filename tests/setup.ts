/**
 * Apps Script global mocks for jest.
 *
 * Teaching notes:
 *  - Apps Script provides globals like `SpreadsheetApp`, `Session`, `LockService`,
 *    `PropertiesService`, `Utilities`, `HtmlService`, `Logger`, `UrlFetchApp`,
 *    `MailApp`, `DriveApp`, `ScriptApp` that don't exist in Node. To unit-test
 *    server code locally, we install fake versions of these on `globalThis` before
 *    each test.
 *  - This file is loaded by jest via the `setupFilesAfterEach` config in
 *    jest.config.js. It registers a `beforeEach(resetMocks)` hook so every test
 *    starts from a known state.
 *  - The fake Spreadsheet is a tiny in-memory store: `Map<sheetName, row[][]>`.
 *    Each "sheet" is just an array of arrays of cell values.
 */

// ---------------------------------------------------------------------------
// Test-controlled state (reset between tests).
// ---------------------------------------------------------------------------

interface MockDriveFile {
  id: string;
  content: string;
  lastUpdated: Date;
}

interface MockTrigger {
  getHandlerFunction: () => string;
}

interface MockState {
  props: Map<string, string>;
  uuids: string[]; // queue: getUuid() shifts from the front
  fixedNowIso: string | null;
  email: string;
  lockAvailable: boolean;
  sheets: Map<string, unknown[][]>; // sheetName -> rows of cells (row 0 = header)
  sheetReadThrows: Set<string>; // sheets whose getDataRange().getValues() should throw
  spreadsheetExists: boolean;
  logCalls: unknown[][];
  urlFetchResponses: Map<string, string>; // url -> JSON response body
  urlFetchThrows: boolean;
  mailSentEmails: { to: string; subject: string; body: string }[];
  driveFiles: Map<string, MockDriveFile>; // fileId -> file
  driveFolderFiles: Map<string, string[]>; // folderId -> list of fileIds
  scriptTriggers: MockTrigger[];
}

const state: MockState = {
  props: new Map(),
  uuids: [],
  fixedNowIso: null,
  email: '',
  lockAvailable: true,
  sheets: new Map(),
  sheetReadThrows: new Set(),
  spreadsheetExists: true,
  logCalls: [],
  urlFetchResponses: new Map(),
  urlFetchThrows: false,
  mailSentEmails: [],
  driveFiles: new Map(),
  driveFolderFiles: new Map(),
  scriptTriggers: [],
};

export const MOCK_SPREADSHEET_ID = 'MOCK_SPREADSHEET_ID';
export const MOCK_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${MOCK_SPREADSHEET_ID}/edit`;

// Per-test setters tests call to prime mocked state.
export function setMockProperty(key: string, value: string | null): void {
  if (value === null) {
    state.props.delete(key);
  } else {
    state.props.set(key, value);
  }
}

export function setMockUuids(uuids: string[]): void {
  state.uuids = [...uuids];
}

export function setMockNowIso(iso: string | null): void {
  state.fixedNowIso = iso;
}

export function setMockEmail(email: string): void {
  state.email = email;
}

export function setLockAvailable(available: boolean): void {
  state.lockAvailable = available;
}

export function setMockSpreadsheetExists(exists: boolean): void {
  state.spreadsheetExists = exists;
}

// Force `Sheet.getDataRange().getValues()` to throw for the named sheet.
// Used to exercise READ_FAILED-style error paths in getRosterSnapshot etc.
export function setMockSheetThrowsOnRead(name: string): void {
  state.sheetReadThrows.add(name);
}

export function getMockSheet(name: string): unknown[][] | undefined {
  return state.sheets.get(name);
}

export function getLogCalls(): unknown[][] {
  return state.logCalls;
}

// UrlFetchApp helpers.
// `url` should be the full URL the server code will request.
export function setMockUrlFetchResponse(url: string, body: string): void {
  state.urlFetchResponses.set(url, body);
}

export function setMockUrlFetchThrows(throws: boolean): void {
  state.urlFetchThrows = throws;
}

// MailApp helpers.
export function getMailSentEmails(): { to: string; subject: string; body: string }[] {
  return state.mailSentEmails;
}

// DriveApp helpers.
export function setMockDriveFile(fileId: string, content: string, lastUpdated?: Date): void {
  state.driveFiles.set(fileId, {
    id: fileId,
    content,
    lastUpdated: lastUpdated ?? new Date(),
  });
}

export function setMockDriveFolderFiles(folderId: string, fileIds: string[]): void {
  state.driveFolderFiles.set(folderId, fileIds);
}

// ScriptApp helpers.
export function getMockTriggers(): MockTrigger[] {
  return state.scriptTriggers;
}

export function resetMocks(): void {
  state.props.clear();
  state.uuids = [];
  state.fixedNowIso = null;
  state.email = '';
  state.lockAvailable = true;
  state.sheets.clear();
  state.sheetReadThrows.clear();
  state.spreadsheetExists = true;
  state.logCalls = [];
  state.urlFetchResponses.clear();
  state.urlFetchThrows = false;
  state.mailSentEmails = [];
  state.driveFiles.clear();
  state.driveFolderFiles.clear();
  state.scriptTriggers = [];
  jest.clearAllMocks();
}

// ---------------------------------------------------------------------------
// Lock mock.
// ---------------------------------------------------------------------------

const releaseLockSpy = jest.fn();

const mockLock = {
  tryLock: jest.fn((_ms: number) => state.lockAvailable),
  releaseLock: releaseLockSpy,
};

export function getReleaseLockSpy(): jest.Mock {
  return releaseLockSpy;
}

// ---------------------------------------------------------------------------
// Sheet / Range / Spreadsheet mocks.
// ---------------------------------------------------------------------------

interface MockRange {
  getValues(): unknown[][];
  setValues(values: unknown[][]): void;
  setValue(value: unknown): void;
}

function makeRange(rows: unknown[][], colCount: number): MockRange {
  return {
    getValues: () => rows.map((r) => r.slice(0, colCount)),
    setValues: (values: unknown[][]) => {
      for (let i = 0; i < values.length && i < rows.length; i++) {
        for (let j = 0; j < values[i].length && j < colCount; j++) {
          rows[i][j] = values[i][j];
        }
      }
    },
    setValue: (value: unknown) => {
      if (rows[0]) rows[0][0] = value;
    },
  };
}

function makeSheet(name: string, rows: unknown[][]) {
  return {
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    appendRow: (values: unknown[]) => {
      rows.push([...values]);
    },
    setFrozenRows: jest.fn(),
    deleteRow: (rowIndex: number) => {
      // rowIndex is 1-based; splice is 0-based.
      rows.splice(rowIndex - 1, 1);
    },
    getRange: (row: number, col: number, numRows = 1, numCols = 1): MockRange => {
      // Sheet API is 1-based; our rows array is 0-based.
      const r0 = row - 1;
      const c0 = col - 1;
      const view: unknown[][] = [];
      for (let i = 0; i < numRows; i++) {
        if (!rows[r0 + i]) rows[r0 + i] = [];
        view.push(rows[r0 + i].slice(c0, c0 + numCols));
      }
      return {
        getValues: () => view.map((r) => [...r]),
        setValues: (values: unknown[][]) => {
          for (let i = 0; i < values.length; i++) {
            if (!rows[r0 + i]) rows[r0 + i] = [];
            for (let j = 0; j < values[i].length; j++) {
              rows[r0 + i][c0 + j] = values[i][j];
            }
          }
        },
        setValue: (value: unknown) => {
          if (!rows[r0]) rows[r0] = [];
          rows[r0][c0] = value;
        },
      };
    },
    getDataRange: (): MockRange => {
      if (state.sheetReadThrows.has(name)) {
        throw new Error(`Mock: getDataRange threw on '${name}'`);
      }
      return makeRange(rows, rows[0]?.length ?? 0);
    },
  };
}

const mockSpreadsheet = {
  getId: () => MOCK_SPREADSHEET_ID,
  getUrl: () => MOCK_SPREADSHEET_URL,
  getSheetByName: (name: string) => {
    const rows = state.sheets.get(name);
    return rows ? makeSheet(name, rows) : null;
  },
  insertSheet: (name: string) => {
    const rows: unknown[][] = [];
    state.sheets.set(name, rows);
    return makeSheet(name, rows);
  },
};

// ---------------------------------------------------------------------------
// Install globals.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).SpreadsheetApp = {
  openById: jest.fn((_id: string) => {
    if (!state.spreadsheetExists) {
      throw new Error('Mock: Spreadsheet not found');
    }
    return mockSpreadsheet;
  }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Session = {
  getActiveUser: jest.fn(() => ({ getEmail: jest.fn(() => state.email) })),
  getEffectiveUser: jest.fn(() => ({ getEmail: jest.fn(() => state.email) })),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).LockService = {
  getScriptLock: jest.fn(() => mockLock),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn(() => ({
    getProperty: jest.fn((key: string) => state.props.get(key) ?? null),
    setProperty: jest.fn((key: string, value: string) => {
      state.props.set(key, value);
    }),
  })),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Utilities = {
  getUuid: jest.fn(() => state.uuids.shift() ?? 'fallback-uuid'),
  // Simple RFC-4180 CSV parser — handles quoted fields with embedded commas
  // for basic test data, though not all edge cases.
  parseCsv: jest.fn((text: string) =>
    text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) =>
        line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')),
      ),
  ),
  sleep: jest.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).HtmlService = {
  createHtmlOutput: jest.fn((_html: string) => ({
    setTitle: jest.fn().mockReturnThis(),
  })),
  createHtmlOutputFromFile: jest.fn((_name: string) => ({
    setTitle: jest.fn().mockReturnThis(),
  })),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Logger = {
  log: jest.fn((...args: unknown[]) => {
    state.logCalls.push(args);
  }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).UrlFetchApp = {
  fetch: jest.fn((url: string) => {
    if (state.urlFetchThrows) {
      throw new Error('Mock: UrlFetchApp.fetch threw');
    }
    const body = state.urlFetchResponses.get(url) ?? '{"status":"NOT_FOUND"}';
    return {
      getContentText: jest.fn(() => body),
    };
  }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).MailApp = {
  sendEmail: jest.fn((to: string, subject: string, body: string) => {
    state.mailSentEmails.push({ to, subject, body });
  }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DriveApp = {
  getFolderById: jest.fn((folderId: string) => {
    const fileIds = state.driveFolderFiles.get(folderId) ?? [];
    let idx = 0;
    const files = fileIds.map((id) => state.driveFiles.get(id)).filter(Boolean) as MockDriveFile[];
    return {
      getFiles: jest.fn(() => ({
        hasNext: jest.fn(() => idx < files.length),
        next: jest.fn(() => {
          const f = files[idx++];
          return {
            getId: jest.fn(() => f.id),
            getMimeType: jest.fn(() => 'text/csv'),
            getLastUpdated: jest.fn(() => f.lastUpdated),
            getBlob: jest.fn(() => ({
              getDataAsString: jest.fn(() => f.content),
            })),
          };
        }),
      })),
    };
  }),
  getFileById: jest.fn((fileId: string) => {
    const f = state.driveFiles.get(fileId);
    if (!f) throw new Error(`Mock: file not found: ${fileId}`);
    return {
      getId: jest.fn(() => f.id),
      getLastUpdated: jest.fn(() => f.lastUpdated),
      getBlob: jest.fn(() => ({
        getDataAsString: jest.fn(() => f.content),
      })),
    };
  }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ScriptApp = {
  WeekDay: { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 },
  getProjectTriggers: jest.fn(() => state.scriptTriggers),
  deleteTrigger: jest.fn((trigger: MockTrigger) => {
    state.scriptTriggers = state.scriptTriggers.filter((t) => t !== trigger);
  }),
  newTrigger: jest.fn((fnName: string) => {
    const builder = {
      timeBased: jest.fn().mockReturnThis(),
      onWeekDay: jest.fn().mockReturnThis(),
      atHour: jest.fn().mockReturnThis(),
      create: jest.fn(() => {
        const trigger: MockTrigger = { getHandlerFunction: () => fnName };
        state.scriptTriggers.push(trigger);
        return trigger;
      }),
    };
    return builder;
  }),
};

// (jest.mock for timestamps lives at the top of each test file that needs it,
// because Jest's auto-hoisting of jest.mock() only works within the same file
// as the imports. The shared `nowIsoMockHook()` below lets those mocks read
// the fixed value tests prime via setMockNowIso.)

// Reset between every test. `beforeEach` is registered here, but in `setupFiles`
// the test framework isn't loaded yet — so we guard with typeof.
// Test files also register their own beforeEach(resetMocks) for safety.
if (typeof beforeEach !== 'undefined') {
  beforeEach(() => {
    resetMocks();
  });
}

/**
 * Hook used by per-test-file jest.mock factories for timestamps.
 * Returns the fixed iso string set via setMockNowIso(), or the real wall clock.
 */
export function nowIsoMockHook(): string {
  return state.fixedNowIso ?? new Date().toISOString();
}
