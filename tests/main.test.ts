/**
 * Unit tests for src/server/main.ts (doGet, startSession, recordCheckin,
 * endSession, setupSheets).
 *
 * Teaching notes:
 *  - The `jest.mock(...)` call below MUST live at the top of THIS file so jest's
 *    auto-hoisting can run it before any imports resolve. Putting it in
 *    tests/setup.ts wouldn't hoist across files.
 *  - The mock factory delegates to `nowIsoMockHook()` exported from setup.ts,
 *    which reads the per-test value primed via `setMockNowIso(...)`.
 */

jest.mock('../src/server/timestamps', () => ({
  nowIso: jest.fn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hook = require('./setup').nowIsoMockHook as () => string;
    return hook();
  }),
}));

import {
  doGet,
  startSession,
  recordCheckin,
  endSession,
  setupSheets,
  getRosterSnapshot,
} from '../src/server/main';
import {
  setMockProperty,
  setMockUuids,
  setMockNowIso,
  setMockEmail,
  setLockAvailable,
  setMockSheetThrowsOnRead,
  getMockSheet,
  getLogCalls,
  MOCK_SPREADSHEET_ID,
  MOCK_SPREADSHEET_URL,
} from './setup';
// (resetMocks is registered globally inside setup.ts; no per-file registration needed.)
import {
  CHECKINS_HEADERS,
  ROSTER_HEADERS,
  SESSIONS_HEADERS,
  CheckinsCol,
  SessionsCol,
} from '../src/server/types';

// Convenience: create the Sessions and Checkins tabs so server functions
// don't return NOT_CONFIGURED. Mimics what setupSheets does on first run.
function bootstrap(): void {
  setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
  setMockProperty('AdminEmails', 'trustee@example.com');
  setMockEmail('trustee@example.com');
  const setup = setupSheets();
  expect(setup.ok).toBe(true);
}

// ---------------------------------------------------------------------------
// doGet
// ---------------------------------------------------------------------------

describe('doGet', () => {
  it('returns the friendly "not configured" output when SpreadsheetId is unset', () => {
    doGet();
    expect(HtmlService.createHtmlOutput).toHaveBeenCalledWith(
      expect.stringContaining('App not configured'),
    );
    expect(HtmlService.createHtmlOutputFromFile).not.toHaveBeenCalled();
  });

  it('returns the index template when SpreadsheetId is set', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    doGet();
    expect(HtmlService.createHtmlOutputFromFile).toHaveBeenCalledWith('index');
  });

  it('does NOT open the Spreadsheet (no Sheet read on page load)', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    doGet();
    expect(SpreadsheetApp.openById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setupSheets
// ---------------------------------------------------------------------------

describe('setupSheets', () => {
  it('creates Sessions, Checkins, AND Roster tabs on first run', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('trustee@example.com');
    const r = setupSheets();
    expect(r).toEqual({ ok: true, created: ['Sessions', 'Checkins', 'Roster'] });
    expect(getMockSheet('Sessions')?.[0]).toEqual(SESSIONS_HEADERS);
    expect(getMockSheet('Checkins')?.[0]).toEqual(CHECKINS_HEADERS);
    expect(getMockSheet('Roster')?.[0]).toEqual(ROSTER_HEADERS);
  });

  it('is idempotent: re-running returns created: [] and preserves data rows', () => {
    bootstrap();
    // Add a data row to Sessions.
    const sessions = getMockSheet('Sessions')!;
    sessions.push(['some-id', '2026-05-12', '...']);
    const r = setupSheets();
    expect(r).toEqual({ ok: true, created: [] });
    // Data row preserved.
    expect(sessions[1][0]).toBe('some-id');
  });

  it('returns NOT_AUTHORIZED when caller is not in AdminEmails', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('someone-else@example.com');
    expect(setupSheets()).toEqual({ ok: false, error: 'NOT_AUTHORIZED' });
  });

  it('returns NOT_AUTHORIZED when AdminEmails is unset', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockEmail('trustee@example.com');
    expect(setupSheets()).toEqual({ ok: false, error: 'NOT_AUTHORIZED' });
  });

  it('returns NOT_AUTHORIZED when caller email is empty (cross-org)', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('');
    expect(setupSheets()).toEqual({ ok: false, error: 'NOT_AUTHORIZED' });
  });

  it('returns NOT_CONFIGURED when SpreadsheetId is unset', () => {
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('trustee@example.com');
    expect(setupSheets()).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('handles AdminEmails with surrounding whitespace and mixed case', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', ' Trustee@Example.COM , other@x.com ');
    setMockEmail('trustee@example.com');
    expect(setupSheets().ok).toBe(true);
  });

  it('calls Logger.log with confirmation including created list (no email in log)', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('trustee@example.com');
    setupSheets();
    const log = getLogCalls();
    expect(log.length).toBeGreaterThan(0);
    const msg = String(log[log.length - 1][0]);
    expect(msg).toContain('setupSheets');
    expect(msg).toContain('Sessions');
    expect(msg).toContain('Checkins');
    // Email must NOT appear in the log (PII concern); execution history records caller separately.
    expect(msg).not.toContain('trustee@example.com');
  });

  it('returns BUSY_TRY_AGAIN on lock contention', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('trustee@example.com');
    setLockAvailable(false);
    expect(setupSheets()).toEqual({ ok: false, error: 'BUSY_TRY_AGAIN' });
  });
});

// ---------------------------------------------------------------------------
// startSession
// ---------------------------------------------------------------------------

describe('startSession', () => {
  const goodInput = {
    requestId: 'req-1',
    date: '2026-05-12',
    time: '19:00',
    netType: 'Sunday Practice',
    ncoCallsign: 'W7ABC',
    repeater: 'W7DTC 146.86',
    purposeNotes: '',
  };

  it('writes a Sessions row with all required fields, returns a UUID', () => {
    bootstrap();
    setMockUuids(['session-uuid-1']);
    setMockNowIso('2026-05-12T19:00:00.000Z');
    setMockEmail('w7abc@example.com');
    const r = startSession(goodInput);
    expect(r).toEqual({ ok: true, sessionId: 'session-uuid-1', deduped: false });
    const sessions = getMockSheet('Sessions')!;
    const row = sessions[1];
    expect(row[SessionsCol.SessionID]).toBe('session-uuid-1');
    expect(row[SessionsCol.StartTimestamp]).toBe('2026-05-12T19:00:00.000Z');
    expect(row[SessionsCol.NetDate]).toBe('2026-05-12');
    expect(row[SessionsCol.NetTime]).toBe('19:00');
    expect(row[SessionsCol.NetType]).toBe('Sunday Practice');
    expect(row[SessionsCol.NCOCallsign]).toBe('W7ABC');
    expect(row[SessionsCol.NCOEmail]).toBe('w7abc@example.com');
    expect(row[SessionsCol.Status]).toBe('Open');
    expect(row[SessionsCol.RequestId]).toBe('req-1');
  });

  it('re-call with the same requestId is deduped and writes no new row', () => {
    bootstrap();
    setMockUuids(['session-uuid-1', 'session-uuid-2']);
    startSession(goodInput);
    const sessionsAfterFirst = getMockSheet('Sessions')!.length;
    const r = startSession(goodInput);
    expect(r).toEqual({ ok: true, sessionId: 'session-uuid-1', deduped: true });
    expect(getMockSheet('Sessions')!.length).toBe(sessionsAfterFirst);
  });

  it('rejects missing ncoCallsign', () => {
    bootstrap();
    const r = startSession({ ...goodInput, ncoCallsign: '' });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_INPUT', field: 'ncoCallsign' });
  });

  it('rejects invalid date', () => {
    bootstrap();
    const r = startSession({ ...goodInput, date: 'today' });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_INPUT', field: 'date' });
  });

  it('rejects invalid time', () => {
    bootstrap();
    const r = startSession({ ...goodInput, time: '7:00 PM' });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_INPUT', field: 'time' });
  });

  it('rejects empty requestId', () => {
    bootstrap();
    const r = startSession({ ...goodInput, requestId: '' });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_INPUT', field: 'requestId' });
  });

  it('rejects requestId longer than 64 chars', () => {
    bootstrap();
    const r = startSession({ ...goodInput, requestId: 'a'.repeat(65) });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_INPUT', field: 'requestId' });
  });

  it('clamps netType > 100 chars', () => {
    bootstrap();
    setMockUuids(['session-uuid-1']);
    const long = 'x'.repeat(200);
    const r = startSession({ ...goodInput, netType: long });
    expect(r.ok).toBe(true);
    const row = getMockSheet('Sessions')![1];
    expect((row[SessionsCol.NetType] as string).length).toBe(100);
  });

  it('returns NOT_CONFIGURED when SpreadsheetId is unset', () => {
    expect(startSession(goodInput)).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns NOT_CONFIGURED when Sessions tab is missing', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    // Don't run setupSheets — tabs absent.
    expect(startSession(goodInput)).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns BUSY_TRY_AGAIN on lock contention', () => {
    bootstrap();
    setLockAvailable(false);
    expect(startSession(goodInput)).toEqual({ ok: false, error: 'BUSY_TRY_AGAIN' });
  });
});

// ---------------------------------------------------------------------------
// recordCheckin
// ---------------------------------------------------------------------------

describe('recordCheckin', () => {
  function startGoodSession(): string {
    bootstrap();
    setMockUuids(['session-uuid', 'checkin-uuid-1', 'checkin-uuid-2', 'checkin-uuid-3']);
    setMockNowIso('2026-05-12T19:00:00.000Z');
    const r = startSession({
      requestId: 'req-1',
      date: '2026-05-12',
      time: '19:00',
      netType: 'Sunday Practice',
      ncoCallsign: 'W7ABC',
    });
    if (!r.ok) throw new Error('Expected session start to succeed');
    return r.sessionId;
  }

  it('first event: creates a Checkins row, tapCount=1, firstEvent=true', () => {
    const sessionId = startGoodSession();
    setMockEmail('w7abc@example.com');
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toMatchObject({
      ok: true,
      firstEventForCallsignInSession: true,
      tapCount: 1,
      deduped: false,
    });
    const row = getMockSheet('Checkins')![1];
    expect(row[CheckinsCol.Callsign]).toBe('K7XYZ');
    expect(row[CheckinsCol.TapCount]).toBe(1);
    expect(row[CheckinsCol.Source]).toBe('Manual');
    expect(row[CheckinsCol.LastTappedEventId]).toBe('evt-1');
    expect(row[CheckinsCol.LoggedByNCOEmail]).toBe('w7abc@example.com');
    expect(row[CheckinsCol.LastTappedByNCOEmail]).toBe('w7abc@example.com');
  });

  it('re-tap with different eventId: increments tapCount, updates timestamps', () => {
    const sessionId = startGoodSession();
    recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    setMockNowIso('2026-05-12T19:05:00.000Z');
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-2' });
    expect(r).toMatchObject({
      ok: true,
      firstEventForCallsignInSession: false,
      tapCount: 2,
      deduped: false,
    });
    const row = getMockSheet('Checkins')![1];
    expect(row[CheckinsCol.TapCount]).toBe(2);
    expect(row[CheckinsCol.FirstTimestamp]).toBe('2026-05-12T19:00:00.000Z'); // unchanged
    expect(row[CheckinsCol.LatestTimestamp]).toBe('2026-05-12T19:05:00.000Z');
    expect(row[CheckinsCol.LastTappedEventId]).toBe('evt-2');
  });

  it('retry with same eventId: deduped, no row change', () => {
    const sessionId = startGoodSession();
    recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    const rowsBefore = getMockSheet('Checkins')!.length;
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toMatchObject({ ok: true, deduped: true, tapCount: 1 });
    expect(getMockSheet('Checkins')!.length).toBe(rowsBefore);
  });

  it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
    bootstrap();
    const r = recordCheckin({ sessionId: 'nope', callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toEqual({ ok: false, error: 'SESSION_NOT_FOUND' });
  });

  it('returns SESSION_CLOSED on a closed session', () => {
    const sessionId = startGoodSession();
    endSession({ sessionId });
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toEqual({ ok: false, error: 'SESSION_CLOSED' });
  });

  it('returns INVALID_CALLSIGN for bad callsign', () => {
    bootstrap();
    const r = recordCheckin({ sessionId: 'whatever', callsign: 'lower', eventId: 'evt-1' });
    expect(r).toEqual({ ok: false, error: 'INVALID_CALLSIGN' });
  });

  // Defensive at the server: even if a client (or a future direct API caller)
  // submits a malformed callsign, recordCheckin must reject it the same way
  // it rejects other ill-formed input. The client's job is to route the user
  // to a friendlier message (e.g. suffix-only → "type the full callsign");
  // the server's job is to refuse the data.
  it.each([
    ['bare suffix', 'ABC'],
    ['no trailing letters', 'K7'],
    ['all digits', '12345'],
    ['leading digit', '7ABC'],
    ['no digit at all', 'WABCXYZ'],
  ])('returns INVALID_CALLSIGN for malformed callsign %s (%s)', (_label, cs) => {
    bootstrap();
    const r = recordCheckin({ sessionId: 'whatever', callsign: cs, eventId: 'evt-1' });
    expect(r).toEqual({ ok: false, error: 'INVALID_CALLSIGN' });
  });

  it('returns INVALID_INPUT for empty eventId', () => {
    bootstrap();
    const r = recordCheckin({ sessionId: 'whatever', callsign: 'K7XYZ', eventId: '' });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_INPUT', field: 'eventId' });
  });

  it('returns NOT_CONFIGURED when SpreadsheetId is unset', () => {
    const r = recordCheckin({ sessionId: 'x', callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns BUSY_TRY_AGAIN on lock contention', () => {
    bootstrap();
    setLockAvailable(false);
    const r = recordCheckin({ sessionId: 'x', callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toEqual({ ok: false, error: 'BUSY_TRY_AGAIN' });
  });
});

// ---------------------------------------------------------------------------
// endSession
// ---------------------------------------------------------------------------

describe('endSession', () => {
  function startGoodSession(): string {
    bootstrap();
    setMockUuids(['session-uuid', 'c1', 'c2', 'c3']);
    setMockNowIso('2026-05-12T19:00:00.000Z');
    const r = startSession({
      requestId: 'req-1',
      date: '2026-05-12',
      time: '19:00',
      netType: 'Sunday Practice',
      ncoCallsign: 'W7ABC',
    });
    if (!r.ok) throw new Error();
    return r.sessionId;
  }

  it('flips Status to Closed, writes EndTimestamp, returns counts and hours', () => {
    const sessionId = startGoodSession();
    recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'e1' });
    recordCheckin({ sessionId, callsign: 'W7DEF', eventId: 'e2' });
    recordCheckin({ sessionId, callsign: 'W7DEF', eventId: 'e3' }); // re-tap
    setMockNowIso('2026-05-12T19:30:00.000Z');
    const r = endSession({ sessionId });
    expect(r).toEqual({
      ok: true,
      checkinCount: 3, // 1 + 2
      uniqueCallsignCount: 2,
      hoursTotal: 1.0, // 2 * 0.5
      spreadsheetUrl: MOCK_SPREADSHEET_URL,
      alreadyClosed: false,
    });
    const sessionRow = getMockSheet('Sessions')![1];
    expect(sessionRow[SessionsCol.Status]).toBe('Closed');
    expect(sessionRow[SessionsCol.EndTimestamp]).toBe('2026-05-12T19:30:00.000Z');
  });

  it('duplicate (sessionId, callsign) rows count as one unique callsign', () => {
    // Defensive regression: recordCheckin enforces one row per (sessionId,
    // callsign), but a future writer (Sunday-Sync import, backfill, manual
    // edit) could violate that invariant. uniqueCallsignCount feeds the EC
    // monthly hours report, so silently double-counting would publish bad
    // numbers. Seed a duplicate row directly into the mock sheet and assert
    // uniqueCallsignCount stays at 1 while checkinCount still sums TapCount.
    const sessionId = startGoodSession();
    recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'e1' });
    const checkinsSheet = getMockSheet('Checkins')!;
    checkinsSheet.push([
      'checkin-uuid-dup',
      sessionId,
      'K7XYZ',
      '2026-05-12T19:01:00.000Z',
      '2026-05-12T19:01:00.000Z',
      2, // simulate a duplicate row carrying its own TapCount
      'admin@example.com',
      'Manual',
      'admin@example.com',
      'e-dup',
    ]);
    setMockNowIso('2026-05-12T19:30:00.000Z');
    const r = endSession({ sessionId });
    expect(r).toMatchObject({
      ok: true,
      checkinCount: 3, // 1 (from recordCheckin) + 2 (from the seeded duplicate)
      uniqueCallsignCount: 1, // NOT 2 — invariant-safe
      hoursTotal: 0.5, // 1 * 0.5
    });
  });

  it('zero check-ins: counts 0, hours 0, status Closed', () => {
    const sessionId = startGoodSession();
    const r = endSession({ sessionId });
    expect(r).toMatchObject({
      ok: true,
      checkinCount: 0,
      uniqueCallsignCount: 0,
      hoursTotal: 0,
      alreadyClosed: false,
    });
  });

  it('re-call on already-closed session: alreadyClosed=true, preserves EndTimestamp', () => {
    const sessionId = startGoodSession();
    setMockNowIso('2026-05-12T19:30:00.000Z');
    endSession({ sessionId });
    const firstEndTs = (getMockSheet('Sessions')![1] as unknown[])[SessionsCol.EndTimestamp];
    setMockNowIso('2026-05-12T20:00:00.000Z');
    const r = endSession({ sessionId });
    expect(r).toMatchObject({ ok: true, alreadyClosed: true });
    // EndTimestamp NOT overwritten.
    expect((getMockSheet('Sessions')![1] as unknown[])[SessionsCol.EndTimestamp]).toBe(firstEndTs);
  });

  it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
    bootstrap();
    expect(endSession({ sessionId: 'nope' })).toEqual({ ok: false, error: 'SESSION_NOT_FOUND' });
  });

  it('returns INVALID_INPUT for empty sessionId', () => {
    bootstrap();
    expect(endSession({ sessionId: '' })).toMatchObject({
      ok: false,
      error: 'INVALID_INPUT',
      field: 'sessionId',
    });
  });

  it('returns NOT_CONFIGURED when SpreadsheetId is unset', () => {
    expect(endSession({ sessionId: 'x' })).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns BUSY_TRY_AGAIN on lock contention', () => {
    bootstrap();
    setLockAvailable(false);
    expect(endSession({ sessionId: 'x' })).toEqual({ ok: false, error: 'BUSY_TRY_AGAIN' });
  });
});

// ---------------------------------------------------------------------------
// getRosterSnapshot — FR-2 (Slice 2 narrower signature: no asOfTimestamp,
// no RosterVersion). Read-only, no LockService, no admin gate.
// ---------------------------------------------------------------------------

describe('getRosterSnapshot', () => {
  it('returns NOT_CONFIGURED when SpreadsheetId is unset', () => {
    expect(getRosterSnapshot()).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns NOT_CONFIGURED when the Roster tab is missing', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    // No bootstrap → Roster sheet does not exist on the mock spreadsheet.
    expect(getRosterSnapshot()).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns READ_FAILED when getDataRange().getValues() throws', () => {
    bootstrap();
    setMockSheetThrowsOnRead('Roster');
    expect(getRosterSnapshot()).toEqual({ ok: false, error: 'READ_FAILED' });
  });

  it('returns an empty roster array when the Roster tab has only the header row', () => {
    bootstrap();
    const r = getRosterSnapshot();
    expect(r).toEqual({ ok: true, roster: [] });
  });

  it('returns one RosterEntry per data row with Callsign, Name, LastActive fields populated', () => {
    bootstrap();
    const roster = getMockSheet('Roster')!;
    roster.push(['W7ABC', 'Smith, Jane', '2026-05-01']);
    roster.push(['KE7XYZ', 'Darby, Brian', '']);
    const r = getRosterSnapshot();
    expect(r).toEqual({
      ok: true,
      roster: [
        { callsign: 'W7ABC', name: 'Smith, Jane', lastActive: '2026-05-01' },
        { callsign: 'KE7XYZ', name: 'Darby, Brian', lastActive: '' },
      ],
    });
  });

  it('skips data rows with empty Callsign', () => {
    bootstrap();
    const roster = getMockSheet('Roster')!;
    roster.push(['W7ABC', '', '']);
    roster.push(['', '', '']); // trailing-blank row shape
    roster.push(['  ', 'whatever', '']); // whitespace-only after trim
    const r = getRosterSnapshot();
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.roster.map((e) => e.callsign)).toEqual(['W7ABC']);
  });

  it.each([
    ['lowercase', 'k7abc'],
    ['special chars', 'K7!BC'],
    ['suffix-only', 'ABC'],
  ])('skips data rows with malformed Callsign: %s (%s)', (_label, cs) => {
    bootstrap();
    const roster = getMockSheet('Roster')!;
    roster.push([cs, '', '']);
    const r = getRosterSnapshot();
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.roster).toEqual([]);
  });

  it('dedups duplicate callsigns: later row wins', () => {
    bootstrap();
    const roster = getMockSheet('Roster')!;
    roster.push(['W7ABC', 'OldName', '2026-01-01']);
    roster.push(['W7ABC', 'NewName', '2026-05-01']);
    const r = getRosterSnapshot();
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.roster).toHaveLength(1);
    expect(r.roster[0]).toEqual({
      callsign: 'W7ABC',
      name: 'NewName',
      lastActive: '2026-05-01',
    });
  });

  it('preserves declaration order of valid, non-duplicate rows', () => {
    bootstrap();
    const roster = getMockSheet('Roster')!;
    roster.push(['W7ABC', '', '']);
    roster.push(['KE7XYZ', '', '']);
    roster.push(['K7TST', '', '']);
    roster.push(['N7DEF', '', '']);
    const r = getRosterSnapshot();
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.roster.map((e) => e.callsign)).toEqual([
      'W7ABC',
      'KE7XYZ',
      'K7TST',
      'N7DEF',
    ]);
  });

  it('coerces numeric or Date cells to strings without crashing', () => {
    bootstrap();
    const roster = getMockSheet('Roster')!;
    // Simulate Sheet returning a Date object for LastActive (Google Sheets
    // sometimes returns Date objects when a cell looks like a date).
    roster.push(['W7ABC', 123, new Date('2026-05-01T00:00:00Z')]);
    const r = getRosterSnapshot();
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.roster).toHaveLength(1);
    expect(r.roster[0].callsign).toBe('W7ABC');
    expect(typeof r.roster[0].name).toBe('string');
    expect(typeof r.roster[0].lastActive).toBe('string');
  });

});
