/**
 * Unit tests for src/server/validators.ts.
 *
 * Teaching notes:
 *  - `describe` groups related tests. `it` (alias of `test`) is one assertion case.
 *  - `expect(actual).toBe(expected)` is the basic jest assertion.
 *  - Pure-logic tests don't need any of the Apps Script mocks — these run in plain Node.
 */

import {
  isValidCallsign,
  isValidIsoDate,
  isValidIsoTime,
  clampString,
  isValidIdField,
  isValidRequiredText,
} from '../src/server/validators';

describe('isValidCallsign', () => {
  it.each(['W7ABC', 'KE7XYZ', 'W7ABC/M', 'W7ABC/P', 'W7ABC/MM', 'W7ABC/QRP', 'KH6/W7ABC', 'K7XYZ/3'])(
    'accepts %s',
    (cs) => {
      expect(isValidCallsign(cs)).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['single char', 'W'],
    ['lowercase', 'w7abc'],
    ['special char', 'W7@BC'],
    ['trailing slash', 'W7ABC/'],
    ['leading slash', '/W7ABC'],
    ['double slash', 'W7ABC//M'],
    ['too long', 'W7ABCDEFG/QRPMM'],
  ])('rejects %s (%s)', (_label, cs) => {
    expect(isValidCallsign(cs)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidCallsign(null)).toBe(false);
    expect(isValidCallsign(undefined)).toBe(false);
    expect(isValidCallsign(123)).toBe(false);
  });
});

describe('isValidIsoDate', () => {
  it.each(['2026-05-12', '2026-01-01', '2026-12-31'])('accepts %s', (d) => {
    expect(isValidIsoDate(d)).toBe(true);
  });

  it.each([
    ['slash separator', '2026/05/12'],
    ['no zero pad month', '2026-5-12'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-15'],
    ['day 32', '2026-05-32'],
    ['plain text', 'today'],
    ['empty', ''],
  ])('rejects %s (%s)', (_label, d) => {
    expect(isValidIsoDate(d)).toBe(false);
  });
});

describe('isValidIsoTime', () => {
  it.each(['19:00', '00:00', '23:59'])('accepts %s', (t) => {
    expect(isValidIsoTime(t)).toBe(true);
  });

  it.each([
    ['12h with AM/PM', '7:00 PM'],
    ['hour 24', '24:00'],
    ['minute 60', '19:60'],
    ['with seconds', '19:00:00'],
    ['empty', ''],
  ])('rejects %s (%s)', (_label, t) => {
    expect(isValidIsoTime(t)).toBe(false);
  });
});

describe('clampString', () => {
  it('returns "" for undefined', () => {
    expect(clampString(undefined, 10)).toBe('');
  });

  it('returns "" for null', () => {
    expect(clampString(null, 10)).toBe('');
  });

  it('returns the string when ≤ max', () => {
    expect(clampString('hello', 10)).toBe('hello');
    expect(clampString('hello', 5)).toBe('hello');
  });

  it('truncates when longer than max', () => {
    expect(clampString('hello world', 5)).toBe('hello');
  });
});

describe('isValidIdField', () => {
  it('accepts non-empty strings within length', () => {
    expect(isValidIdField('abc', 64)).toBe(true);
    expect(isValidIdField('a'.repeat(64), 64)).toBe(true);
  });

  it('rejects empty / too long / non-string', () => {
    expect(isValidIdField('', 64)).toBe(false);
    expect(isValidIdField('a'.repeat(65), 64)).toBe(false);
    expect(isValidIdField(null, 64)).toBe(false);
    expect(isValidIdField(123, 64)).toBe(false);
  });
});

describe('isValidRequiredText', () => {
  it('accepts non-empty text within length', () => {
    expect(isValidRequiredText('Sunday Practice', 100)).toBe(true);
  });

  it('rejects whitespace-only', () => {
    expect(isValidRequiredText('   ', 100)).toBe(false);
  });

  it('rejects empty / too long', () => {
    expect(isValidRequiredText('', 100)).toBe(false);
    expect(isValidRequiredText('a'.repeat(101), 100)).toBe(false);
  });
});
