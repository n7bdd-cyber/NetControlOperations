/**
 * Unit tests for src/server/main.ts.
 *
 * Teaching notes:
 *  - The `jest.mock(...)` call below MUST live at the top of THIS file so jest's
 *    auto-hoisting can run it before any imports resolve.
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
  endSession,
  getRosterSnapshot,
  installSundaySyncTrigger,
  reconcileOthersNames,
  recordCheckin,
  resolveName,
  setManualName,
  setupSheets,
  startSession,
  sundaySync,
} from '../src/server/main';
import {
  getLogCalls,
  getMailSentEmails,
  getMockSheet,
  getMockTriggers,
  MOCK_SPREADSHEET_ID,
  MOCK_SPREADSHEET_URL,
  setLockAvailable,
  setMockDriveFile,
  setMockDriveFolderFiles,
  setMockEmail,
  setMockNowIso,
  setMockProperty,
  setMockSheetThrowsOnRead,
  setMockUuids,
  setMockUrlFetchResponse,
  setMockUrlFetchThrows,
} from './setup';
import {
  CHECKINS_HEADERS,
  CheckinsCol,
  OthersCol,
  ROSTER_HEADERS,
  SESSIONS_HEADERS,
  SessionsCol,
} from '../src/server/types';

// Convenience: create all tabs so server functions don't return NOT_CONFIGURED.
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
  it('creates Sessions, Checkins, Roster, Others, AND Settings tabs on first run', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('trustee@example.com');
    const r = setupSheets();
    expect(r).toEqual({
      ok: true,
      created: ['Sessions', 'Checkins', 'Roster', 'Others', 'Settings'],
    });
    expect(getMockSheet('Sessions')?.[0]).toEqual(SESSIONS_HEADERS);
    expect(getMockSheet('Checkins')?.[0]).toEqual(CHECKINS_HEADERS);
    expect(getMockSheet('Roster')?.[0]).toEqual(ROSTER_HEADERS);
    expect(getMockSheet('Others')?.[0]).toEqual(['Callsign', 'Name', 'FccName', 'Source', 'NameConflict', 'LastActive']);
    expect(getMockSheet('Settings')?.[0]).toEqual(['Key', 'Value']);
  });

  it('is idempotent: re-running returns created: [] and preserves data rows', () => {
    bootstrap();
    const sessions = getMockSheet('Sessions')!;
    sessions.push(['some-id', '2026-05-12', '...']);
    const r = setupSheets();
    expect(r).toEqual({ ok: true, created: [] });
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
    const row = getMockSheet('Sessions')![1];
    expect(row[SessionsCol.SessionID]).toBe('session-uuid-1');
    expect(row[SessionsCol.NetDate]).toBe('2026-05-12');
    expect(row[SessionsCol.Status]).toBe('Open');
    expect(row[SessionsCol.RequestId]).toBe('req-1');
  });

  it('re-call with the same requestId is deduped', () => {
    bootstrap();
    setMockUuids(['session-uuid-1', 'session-uuid-2']);
    startSession(goodInput);
    const lenAfterFirst = getMockSheet('Sessions')!.length;
    const r = startSession(goodInput);
    expect(r).toEqual({ ok: true, sessionId: 'session-uuid-1', deduped: true });
    expect(getMockSheet('Sessions')!.length).toBe(lenAfterFirst);
  });

  it('rejects missing ncoCallsign', () => {
    bootstrap();
    expect(startSession({ ...goodInput, ncoCallsign: '' })).toMatchObject({
      ok: false, error: 'INVALID_INPUT', field: 'ncoCallsign',
    });
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
    if (!r.ok) throw new Error('session start failed');
    return r.sessionId;
  }

  it('first event for roster member: tapCount=1, resolveAsync=false, resolvedName from Roster', () => {
    const sessionId = startGoodSession();
    getMockSheet('Roster')!.push(['K7XYZ', 'Smith, Jane', 'General']);
    setMockEmail('w7abc@example.com');
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toMatchObject({
      ok: true,
      firstEventForCallsignInSession: true,
      tapCount: 1,
      deduped: false,
      resolveAsync: false,
      resolvedName: 'Smith, Jane',
    });
    // Name written to Checkins row.
    const row = getMockSheet('Checkins')![1];
    expect(row[CheckinsCol.Name]).toBe('Smith, Jane');
  });

  it('roster member with blank Name: resolveAsync=false, resolvedName=null', () => {
    const sessionId = startGoodSession();
    getMockSheet('Roster')!.push(['K7XYZ', '', 'Technician']);
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toMatchObject({ ok: true, resolveAsync: false, resolvedName: null });
  });

  it('non-roster callsign with Others cache hit (name set): resolveAsync=false', () => {
    const sessionId = startGoodSession();
    // Pre-seed Others row with a name.
    getMockSheet('Others')!.push([
      'W7TST', 'Darby, Brian', 'DARBY, BRIAN', 'manual', false, '2026-04-01T00:00:00.000Z',
    ]);
    setMockUuids(['checkin-uuid-1']);
    const r = recordCheckin({ sessionId, callsign: 'W7TST', eventId: 'evt-1' });
    expect(r).toMatchObject({
      ok: true,
      resolveAsync: false,
      resolvedName: 'Darby, Brian',
    });
  });

  it('non-roster callsign with Others cache hit (name blank): resolveAsync=true', () => {
    const sessionId = startGoodSession();
    getMockSheet('Others')!.push([
      'W7TST', '', '', 'pending', false, '2026-04-01T00:00:00.000Z',
    ]);
    setMockUuids(['checkin-uuid-1']);
    const r = recordCheckin({ sessionId, callsign: 'W7TST', eventId: 'evt-1' });
    expect(r).toMatchObject({ ok: true, resolveAsync: true, resolvedName: null });
  });

  it('non-roster callsign with no Others row: creates Others row (pending), resolveAsync=true', () => {
    const sessionId = startGoodSession();
    setMockUuids(['checkin-uuid-1']);
    const r = recordCheckin({ sessionId, callsign: 'W7NEW', eventId: 'evt-1' });
    expect(r).toMatchObject({ ok: true, resolveAsync: true, resolvedName: null });
    const othersRows = getMockSheet('Others')!;
    const dataRow = othersRows[1];
    expect(dataRow[OthersCol.Callsign]).toBe('W7NEW');
    expect(dataRow[OthersCol.Source]).toBe('pending');
  });

  it('re-tap with different eventId: increments tapCount, resolveAsync=false', () => {
    const sessionId = startGoodSession();
    recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    setMockNowIso('2026-05-12T19:05:00.000Z');
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-2' });
    expect(r).toMatchObject({
      ok: true,
      firstEventForCallsignInSession: false,
      tapCount: 2,
      deduped: false,
      resolveAsync: false,
      resolvedName: null,
    });
  });

  it('retry with same eventId: deduped=true, resolveAsync=false', () => {
    const sessionId = startGoodSession();
    recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    const r = recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'evt-1' });
    expect(r).toMatchObject({ ok: true, deduped: true, resolveAsync: false });
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
    expect(recordCheckin({ sessionId: 'x', callsign: 'lower', eventId: 'evt-1' })).toEqual({
      ok: false, error: 'INVALID_CALLSIGN',
    });
  });

  it.each([
    ['bare suffix', 'ABC'],
    ['no trailing letters', 'K7'],
    ['all digits', '12345'],
    ['leading digit', '7ABC'],
  ])('returns INVALID_CALLSIGN for malformed callsign (%s)', (_label, cs) => {
    bootstrap();
    expect(recordCheckin({ sessionId: 'x', callsign: cs, eventId: 'evt-1' })).toEqual({
      ok: false, error: 'INVALID_CALLSIGN',
    });
  });

  it('returns BUSY_TRY_AGAIN on lock contention', () => {
    bootstrap();
    setLockAvailable(false);
    expect(recordCheckin({ sessionId: 'x', callsign: 'K7XYZ', eventId: 'evt-1' })).toEqual({
      ok: false, error: 'BUSY_TRY_AGAIN',
    });
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

  it('flips Status to Closed, returns counts and hours', () => {
    const sessionId = startGoodSession();
    recordCheckin({ sessionId, callsign: 'K7XYZ', eventId: 'e1' });
    recordCheckin({ sessionId, callsign: 'W7DEF', eventId: 'e2' });
    setMockNowIso('2026-05-12T19:30:00.000Z');
    const r = endSession({ sessionId });
    expect(r).toMatchObject({
      ok: true,
      uniqueCallsignCount: 2,
      hoursTotal: 1.0,
      spreadsheetUrl: MOCK_SPREADSHEET_URL,
      alreadyClosed: false,
    });
    expect(getMockSheet('Sessions')![1][SessionsCol.Status]).toBe('Closed');
  });

  it('purges Others rows where LastActive > 13 months ago', () => {
    const sessionId = startGoodSession();
    const others = getMockSheet('Others')!;
    // Stale row: 14 months ago.
    const stale = new Date();
    stale.setMonth(stale.getMonth() - 14);
    others.push(['W7OLD', '', '', 'pending', false, stale.toISOString()]);
    // Fresh row: 1 month ago — should survive.
    const fresh = new Date();
    fresh.setMonth(fresh.getMonth() - 1);
    others.push(['W7NEW', 'New Person', '', 'fcc', false, fresh.toISOString()]);

    endSession({ sessionId });
    // Only header + fresh row should remain.
    expect(others.length).toBe(2);
    expect(others[1][OthersCol.Callsign]).toBe('W7NEW');
  });

  it('does not purge Others rows with no LastActive value', () => {
    const sessionId = startGoodSession();
    const others = getMockSheet('Others')!;
    others.push(['W7BLANK', '', '', 'pending', false, '']);
    endSession({ sessionId });
    expect(others.length).toBe(2); // header + W7BLANK still there
  });

  it('re-call on already-closed session: alreadyClosed=true', () => {
    const sessionId = startGoodSession();
    endSession({ sessionId });
    const r = endSession({ sessionId });
    expect(r).toMatchObject({ ok: true, alreadyClosed: true });
  });

  it('returns SESSION_NOT_FOUND for unknown sessionId', () => {
    bootstrap();
    expect(endSession({ sessionId: 'nope' })).toEqual({ ok: false, error: 'SESSION_NOT_FOUND' });
  });

  it('returns BUSY_TRY_AGAIN on lock contention', () => {
    bootstrap();
    setLockAvailable(false);
    expect(endSession({ sessionId: 'x' })).toEqual({ ok: false, error: 'BUSY_TRY_AGAIN' });
  });
});

// ---------------------------------------------------------------------------
// getRosterSnapshot
// ---------------------------------------------------------------------------

describe('getRosterSnapshot', () => {
  it('returns NOT_CONFIGURED when SpreadsheetId is unset', () => {
    expect(getRosterSnapshot()).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns NOT_CONFIGURED when the Roster tab is missing', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    expect(getRosterSnapshot()).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
  });

  it('returns READ_FAILED when getDataRange().getValues() throws', () => {
    bootstrap();
    setMockSheetThrowsOnRead('Roster');
    expect(getRosterSnapshot()).toEqual({ ok: false, error: 'READ_FAILED' });
  });

  it('returns an empty roster array when the Roster tab has only the header row', () => {
    bootstrap();
    expect(getRosterSnapshot()).toEqual({ ok: true, roster: [] });
  });

  it('returns RosterEntry with licenseClass (not lastActive)', () => {
    bootstrap();
    getMockSheet('Roster')!.push(['W7ABC', 'Smith, Jane', 'General']);
    getMockSheet('Roster')!.push(['KE7XYZ', 'Darby, Brian', 'Extra']);
    const r = getRosterSnapshot();
    expect(r).toEqual({
      ok: true,
      roster: [
        { callsign: 'W7ABC', name: 'Smith, Jane', licenseClass: 'General' },
        { callsign: 'KE7XYZ', name: 'Darby, Brian', licenseClass: 'Extra' },
      ],
    });
  });

  it('skips data rows with empty or malformed Callsign', () => {
    bootstrap();
    getMockSheet('Roster')!.push(['', 'Nobody', '']);
    getMockSheet('Roster')!.push(['bad-cs', 'Nobody', '']);
    const r = getRosterSnapshot();
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.roster).toEqual([]);
  });

  it('dedups duplicate callsigns: later row wins', () => {
    bootstrap();
    getMockSheet('Roster')!.push(['W7ABC', 'OldName', 'General']);
    getMockSheet('Roster')!.push(['W7ABC', 'NewName', 'Extra']);
    const r = getRosterSnapshot();
    if (!r.ok) throw new Error('expected ok=true');
    expect(r.roster).toHaveLength(1);
    expect(r.roster[0].name).toBe('NewName');
    expect(r.roster[0].licenseClass).toBe('Extra');
  });
});

// ---------------------------------------------------------------------------
// resolveName
// ---------------------------------------------------------------------------

describe('resolveName', () => {
  function setupCheckin(callsign: string): { sessionId: string; checkinId: string } {
    bootstrap();
    setMockUuids(['session-uuid', 'checkin-uuid']);
    const sr = startSession({
      requestId: 'req-1', date: '2026-05-12', time: '19:00',
      netType: 'Test', ncoCallsign: 'W7ABC',
    });
    if (!sr.ok) throw new Error();
    // Add to Others (pending) and record check-in.
    getMockSheet('Others')!.push([callsign, '', '', 'pending', false, '2026-05-12T19:00:00.000Z']);
    const cr = recordCheckin({ sessionId: sr.sessionId, callsign, eventId: 'evt-1' });
    if (!cr.ok) throw new Error();
    return { sessionId: sr.sessionId, checkinId: cr.checkinId };
  }

  it('returns name from Others cache when Name is non-blank (no FCC call)', () => {
    bootstrap();
    setMockUuids(['session-uuid', 'checkin-uuid']);
    const sr = startSession({
      requestId: 'req-1', date: '2026-05-12', time: '19:00',
      netType: 'Test', ncoCallsign: 'W7ABC',
    });
    if (!sr.ok) throw new Error();
    // Others row with a name already set.
    getMockSheet('Others')!.push(['W7TST', 'Already Known', 'ALREADY KNOWN', 'fcc', false, '2026-05-12T00:00:00.000Z']);
    const cr = recordCheckin({ sessionId: sr.sessionId, callsign: 'W7TST', eventId: 'evt-1' });
    if (!cr.ok) throw new Error();

    const result = resolveName('W7TST', cr.checkinId);
    expect(result).toMatchObject({ name: 'Already Known', fccName: 'ALREADY KNOWN' });
    // Checkins.Name should be set.
    const checkinRow = getMockSheet('Checkins')![1];
    expect(checkinRow[CheckinsCol.Name]).toBe('Already Known');
    // UrlFetchApp should NOT have been called.
    expect(UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('FCC lookup success: writes name to Others and Checkins', () => {
    const { checkinId } = setupCheckin('W7TST');
    setMockProperty('CallookBaseUrl', 'https://callook.info/');
    setMockUrlFetchResponse(
      'https://callook.info/W7TST/json',
      JSON.stringify({ status: 'VALID', name: 'SMITH, JOHN' }),
    );
    const result = resolveName('W7TST', checkinId);
    expect(result).toMatchObject({ name: 'SMITH, JOHN', fccName: 'SMITH, JOHN' });
    // Others row should be updated.
    const othersRows = getMockSheet('Others')!;
    const othersData = othersRows.find((r) => r[OthersCol.Callsign] === 'W7TST');
    expect(othersData?.[OthersCol.Name]).toBe('SMITH, JOHN');
    expect(othersData?.[OthersCol.Source]).toBe('fcc');
    // Checkins.Name should be set.
    const checkinRow = getMockSheet('Checkins')!.find(
      (r) => r[CheckinsCol.CheckinID] === checkinId,
    );
    expect(checkinRow?.[CheckinsCol.Name]).toBe('SMITH, JOHN');
  });

  it('FCC lookup NOT_FOUND: returns null name, upserts pending row', () => {
    const { checkinId } = setupCheckin('W7UNK');
    setMockProperty('CallookBaseUrl', 'https://callook.info/');
    setMockUrlFetchResponse(
      'https://callook.info/W7UNK/json',
      JSON.stringify({ status: 'NOT_FOUND' }),
    );
    const result = resolveName('W7UNK', checkinId);
    expect(result).toMatchObject({ name: null, fccName: null });
    // Others row LastActive should be updated.
    const othersRows = getMockSheet('Others')!;
    const othersData = othersRows.find((r) => r[OthersCol.Callsign] === 'W7UNK');
    expect(othersData).toBeDefined();
    expect(othersData?.[OthersCol.Source]).toBe('pending');
  });

  it('FCC network error: returns null name', () => {
    const { checkinId } = setupCheckin('W7ERR');
    setMockProperty('CallookBaseUrl', 'https://callook.info/');
    setMockUrlFetchThrows(true);
    const result = resolveName('W7ERR', checkinId);
    expect(result).toMatchObject({ name: null, fccName: null });
  });

  it('IDOR guard: mismatched callsign returns null', () => {
    const { checkinId } = setupCheckin('W7TST');
    // Pass a different callsign than what's in the Checkins row.
    const result = resolveName('W7WRONG', checkinId);
    expect(result).toMatchObject({ name: null, fccName: null });
  });

  it('returns null for invalid callsign', () => {
    const result = resolveName('bad callsign!', 'some-id');
    expect(result).toMatchObject({ name: null, fccName: null });
  });

  it('returns null for empty checkinId', () => {
    const result = resolveName('W7ABC', '');
    expect(result).toMatchObject({ name: null, fccName: null });
  });

  it('returns null when checkinId is not found in Checkins sheet', () => {
    bootstrap();
    const result = resolveName('W7ABC', 'nonexistent-id');
    expect(result).toMatchObject({ name: null, fccName: null });
  });
});

// ---------------------------------------------------------------------------
// setManualName
// ---------------------------------------------------------------------------

describe('setManualName', () => {
  function setupCheckin(callsign: string): string {
    bootstrap();
    setMockUuids(['session-uuid', 'checkin-uuid']);
    const sr = startSession({
      requestId: 'req-1', date: '2026-05-12', time: '19:00',
      netType: 'Test', ncoCallsign: 'W7ABC',
    });
    if (!sr.ok) throw new Error();
    getMockSheet('Others')!.push([callsign, '', '', 'pending', false, '2026-05-12T00:00:00.000Z']);
    const cr = recordCheckin({ sessionId: sr.sessionId, callsign, eventId: 'evt-1' });
    if (!cr.ok) throw new Error();
    return cr.checkinId;
  }

  it('writes trimmed name to Others (Source=manual) and Checkins', () => {
    const checkinId = setupCheckin('W7TST');
    setManualName('W7TST', checkinId, '  Heard Name  ');
    const othersRows = getMockSheet('Others')!;
    const othersData = othersRows.find((r) => r[OthersCol.Callsign] === 'W7TST');
    expect(othersData?.[OthersCol.Name]).toBe('Heard Name');
    expect(othersData?.[OthersCol.Source]).toBe('manual');
    const checkinRow = getMockSheet('Checkins')!.find(
      (r) => r[CheckinsCol.CheckinID] === checkinId,
    );
    expect(checkinRow?.[CheckinsCol.Name]).toBe('Heard Name');
  });

  it('throws on CSV-injection prefix "="', () => {
    const checkinId = setupCheckin('W7TST');
    expect(() => setManualName('W7TST', checkinId, '=SUM(A1)')).toThrow('formula prefix');
  });

  it('throws on CSV-injection prefix "+"', () => {
    const checkinId = setupCheckin('W7TST');
    expect(() => setManualName('W7TST', checkinId, '+1-888-SPAM')).toThrow('formula prefix');
  });

  it('throws on empty name after trim', () => {
    const checkinId = setupCheckin('W7TST');
    expect(() => setManualName('W7TST', checkinId, '   ')).toThrow();
  });

  it('throws on name exceeding 64 chars', () => {
    const checkinId = setupCheckin('W7TST');
    expect(() => setManualName('W7TST', checkinId, 'x'.repeat(65))).toThrow('exceeds 64 chars');
  });

  it('IDOR guard: throws when callsign does not match checkinId', () => {
    const checkinId = setupCheckin('W7TST');
    // W7DIF is a valid callsign but does not own this checkinId.
    expect(() => setManualName('W7DIF', checkinId, 'Good Name')).toThrow('CALLSIGN_MISMATCH');
  });

  it('throws on invalid callsign', () => {
    expect(() => setManualName('bad!', 'some-id', 'Name')).toThrow('INVALID_CALLSIGN');
  });

  it('creates Others row if it does not exist yet (roster member with no prior Others row)', () => {
    bootstrap();
    setMockUuids(['session-uuid', 'checkin-uuid']);
    const sr = startSession({
      requestId: 'req-1', date: '2026-05-12', time: '19:00',
      netType: 'Test', ncoCallsign: 'W7ABC',
    });
    if (!sr.ok) throw new Error();
    getMockSheet('Roster')!.push(['W7MEM', 'Member', 'General']);
    const cr = recordCheckin({ sessionId: sr.sessionId, callsign: 'W7MEM', eventId: 'evt-1' });
    if (!cr.ok) throw new Error();
    // There's no Others row for a roster member, but setManualName should still work.
    setManualName('W7MEM', cr.checkinId, 'Override Name');
    const othersRows = getMockSheet('Others')!;
    const othersData = othersRows.find((r) => r[OthersCol.Callsign] === 'W7MEM');
    expect(othersData?.[OthersCol.Name]).toBe('Override Name');
  });
});

// ---------------------------------------------------------------------------
// reconcileOthersNames
// ---------------------------------------------------------------------------

describe('reconcileOthersNames', () => {
  beforeEach(() => {
    bootstrap();
    setMockProperty('CallookBaseUrl', 'https://callook.info/');
    setMockProperty('TrusteeEmail', 'trustee@example.com');
  });

  it('silent resolve: blank Name → set to FccName, Source→fcc, NameConflict=false', () => {
    getMockSheet('Others')!.push(['W7TST', '', '', 'pending', false, '2026-05-12T00:00:00.000Z']);
    setMockUrlFetchResponse('https://callook.info/W7TST/json', JSON.stringify({ status: 'VALID', name: 'SMITH, JOHN' }));
    const r = reconcileOthersNames();
    expect(r.silentlyResolved).toBe(1);
    expect(r.conflicts).toBe(0);
    const row = getMockSheet('Others')![1];
    expect(row[OthersCol.Name]).toBe('SMITH, JOHN');
    expect(row[OthersCol.FccName]).toBe('SMITH, JOHN');
    expect(row[OthersCol.Source]).toBe('fcc');
    expect(row[OthersCol.NameConflict]).toBe(false);
  });

  it('silent confirm: existing Name matches FccName (case-insensitive)', () => {
    getMockSheet('Others')!.push(['W7TST', 'smith, john', '', 'manual', false, '2026-05-12T00:00:00.000Z']);
    setMockUrlFetchResponse('https://callook.info/W7TST/json', JSON.stringify({ status: 'VALID', name: 'SMITH, JOHN' }));
    const r = reconcileOthersNames();
    expect(r.silentlyResolved).toBe(1);
    expect(r.conflicts).toBe(0);
    const row = getMockSheet('Others')![1];
    expect(row[OthersCol.NameConflict]).toBe(false);
  });

  it('conflict: Name differs from FccName → NameConflict=true, trustee email sent', () => {
    getMockSheet('Others')!.push(['W7TST', 'John Smith', '', 'manual', false, '2026-05-12T00:00:00.000Z']);
    setMockUrlFetchResponse('https://callook.info/W7TST/json', JSON.stringify({ status: 'VALID', name: 'SMITH, JOHN Q' }));
    const r = reconcileOthersNames();
    expect(r.conflicts).toBe(1);
    const row = getMockSheet('Others')![1];
    expect(row[OthersCol.NameConflict]).toBe(true);
    const emails = getMailSentEmails();
    expect(emails.length).toBe(1);
    expect(emails[0].to).toBe('trustee@example.com');
    expect(emails[0].body).toContain('W7TST');
  });

  it('skips rows already in NameConflict=TRUE state', () => {
    getMockSheet('Others')!.push(['W7TST', 'John Smith', 'SMITH, JOHN Q', 'manual', true, '2026-05-12T00:00:00.000Z']);
    const r = reconcileOthersNames();
    expect(r.skipped).toBe(1);
    expect(r.checked).toBe(0);
    expect(UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('FCC NOT_FOUND: leaves Source unchanged, no conflict, no email', () => {
    getMockSheet('Others')!.push(['W7TST', '', '', 'pending', false, '2026-05-12T00:00:00.000Z']);
    setMockUrlFetchResponse('https://callook.info/W7TST/json', JSON.stringify({ status: 'NOT_FOUND' }));
    const r = reconcileOthersNames();
    expect(r.silentlyResolved).toBe(0);
    expect(r.conflicts).toBe(0);
    const emails = getMailSentEmails();
    expect(emails.length).toBe(0);
  });

  it('returns empty result when Others tab is missing', () => {
    setMockProperty('SpreadsheetId', MOCK_SPREADSHEET_ID);
    setMockProperty('AdminEmails', 'trustee@example.com');
    setMockEmail('trustee@example.com');
    // Don't bootstrap — no tabs at all.
    const r = reconcileOthersNames();
    expect(r).toMatchObject({ checked: 0, silentlyResolved: 0, conflicts: 0 });
  });
});

// ---------------------------------------------------------------------------
// sundaySync
// ---------------------------------------------------------------------------

describe('sundaySync', () => {
  const FOLDER_ID = 'folder-123';
  const FILE_ID = 'file-abc';
  const VALID_CSV = 'Callsign,Name,LicenseClass\nW7ABC,Smith Jane,General\nK7XYZ,Brown Bob,Extra\n';

  beforeEach(() => {
    bootstrap();
    setMockProperty('RosterCsvDriveFolderId', FOLDER_ID);
    setMockProperty('TrusteeEmail', 'trustee@example.com');
    setMockProperty('CallookBaseUrl', 'https://callook.info/');
  });

  it('golden path: replaces Roster rows from CSV', () => {
    setMockDriveFile(FILE_ID, VALID_CSV, new Date('2026-05-11T01:30:00Z'));
    setMockDriveFolderFiles(FOLDER_ID, [FILE_ID]);

    sundaySync();

    const roster = getMockSheet('Roster')!;
    // Header + 2 data rows.
    expect(roster.length).toBe(3);
    expect(roster[1][0]).toBe('W7ABC');
    expect(roster[1][1]).toBe('Smith Jane');
    expect(roster[1][2]).toBe('General');
    expect(roster[2][0]).toBe('K7XYZ');
  });

  it('validation guard: CSV with wrong headers leaves Roster unchanged, emails trustee', () => {
    const badCsv = 'Call,FullName,Class\nW7ABC,Smith Jane,General\n';
    setMockDriveFile(FILE_ID, badCsv, new Date('2026-05-11T01:30:00Z'));
    setMockDriveFolderFiles(FOLDER_ID, [FILE_ID]);
    // Pre-seed Roster with a row to verify it is NOT cleared.
    getMockSheet('Roster')!.push(['W7KEEP', 'Keep Me', 'General']);

    sundaySync();

    const roster = getMockSheet('Roster')!;
    expect(roster.length).toBe(2); // header + pre-seeded row unchanged
    expect(roster[1][0]).toBe('W7KEEP');
    const emails = getMailSentEmails();
    expect(emails.length).toBe(1);
    expect(emails[0].to).toBe('trustee@example.com');
  });

  it('idempotency: second concurrent call exits on lock failure', () => {
    // First call holds the lock — second should exit cleanly (no crash).
    setMockDriveFile(FILE_ID, VALID_CSV, new Date('2026-05-11T01:30:00Z'));
    setMockDriveFolderFiles(FOLDER_ID, [FILE_ID]);
    sundaySync(); // first call succeeds

    // Simulate second concurrent call while lock is unavailable.
    setLockAvailable(false);
    expect(() => sundaySync()).not.toThrow();
  });

  it('logs and returns early when RosterCsvDriveFolderId is not configured', () => {
    setMockProperty('RosterCsvDriveFolderId', null);
    sundaySync();
    const log = getLogCalls().map((a) => String(a[0]));
    expect(log.some((l) => l.includes('not configured'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// installSundaySyncTrigger
// ---------------------------------------------------------------------------

describe('installSundaySyncTrigger', () => {
  it('installs exactly one sundaySync trigger', () => {
    installSundaySyncTrigger();
    const triggers = getMockTriggers();
    expect(triggers.length).toBe(1);
    expect(triggers[0].getHandlerFunction()).toBe('sundaySync');
  });

  it('deduplicates: calling twice leaves only one trigger', () => {
    installSundaySyncTrigger();
    installSundaySyncTrigger();
    const triggers = getMockTriggers();
    expect(triggers.length).toBe(1);
  });

  it('removes a pre-existing sundaySync trigger before installing', () => {
    // Manually plant a trigger that the mock ScriptApp built.
    installSundaySyncTrigger();
    const firstTrigger = getMockTriggers()[0];
    installSundaySyncTrigger();
    const triggers = getMockTriggers();
    expect(triggers.length).toBe(1);
    // The old trigger object should be gone.
    expect(triggers[0]).not.toBe(firstTrigger);
  });
});
