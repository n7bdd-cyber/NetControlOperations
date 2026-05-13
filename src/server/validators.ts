/**
 * Format validators for user-supplied strings.
 *
 * Teaching notes:
 *  - Every exported function takes `unknown` (or `string`) and returns a
 *    plain `boolean`. Pure logic; no side effects; trivially testable.
 *  - The regexes are deliberately permissive at the format level — the
 *    real "is this a known callsign" check happens later via the roster
 *    (Sunday-Sync slice, not Slice 1).
 */

import { MAX_NET_TYPE, MAX_REPEATER, MAX_PURPOSE_NOTES, MAX_CALLSIGN } from './types';

// Callsign: 2-7 ALL-CAPS alphanumeric, optional /SUFFIX of 1-5 ALL-CAPS alphanumeric.
// Accepts: W7ABC, KE7XYZ, W7ABC/M, W7ABC/MM, W7ABC/QRP, KH6/W7ABC, K7XYZ/3
// Rejects: empty, single char, lowercase, special chars other than `/`, >12 chars total,
//          starts or ends with `/`, multiple `/`.
const CALLSIGN_RE = /^[A-Z0-9]{2,7}(?:\/[A-Z0-9]{1,5})?$/;

// ISO date: YYYY-MM-DD, month 01-12, day 01-31 (does not validate calendar — 2026-02-30 passes).
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// 24-hour time HH:mm.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidCallsign(s: unknown): s is string {
  return typeof s === 'string' && s.length <= MAX_CALLSIGN && CALLSIGN_RE.test(s);
}

export function isValidIsoDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s);
}

export function isValidIsoTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s);
}

/**
 * Server-side defensive clamp: if the value is too long, silently truncate.
 * The client validators reject; the server's job is "don't crash."
 *
 * Iterates by Unicode code points (via Array.from) rather than UTF-16 code
 * units so emoji and other supplementary-plane characters are never split
 * mid-surrogate (which would corrupt downstream JSON/Sheet display).
 */
export function clampString(value: string | undefined | null, max: number): string {
  if (!value) return '';
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/**
 * Validate a required identifier-shaped string (requestId, eventId, sessionId).
 * Non-empty, length-bounded. Format beyond non-empty is not enforced.
 */
export function isValidIdField(s: unknown, maxLen: number): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen;
}

/**
 * Validate netType / required text fields: non-empty after trim, ≤ maxLen.
 */
export function isValidRequiredText(s: unknown, maxLen: number): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= maxLen;
}

// Re-export the caps from types.ts so callers can use them through this module
// when validating server-side input.
export { MAX_NET_TYPE, MAX_REPEATER, MAX_PURPOSE_NOTES, MAX_CALLSIGN };
