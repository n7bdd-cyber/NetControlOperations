/**
 * Project: NetControlOperations
 * File: validators.ts
 * System Version: 1.0.0 | File Version: 1 | Date: 2026-05-15
 *   v1: Initial version tracking. Callsign, date, time, and text validators.
 *
 * Description: Format validators and string utilities for user-supplied input.
 *   isValidCallsign(s)             — FCC US amateur callsign format check
 *   isLikelySuffixOnly(s)          — 1–4 char bare-suffix detection
 *   isValidIsoDate(s)              — YYYY-MM-DD
 *   isValidIsoTime(s)              — HH:MM
 *   clampString(value, max)        — trims + truncates to max chars
 *   isValidIdField(s, maxLen)      — non-empty string within length limit
 *   isValidRequiredText(s, maxLen) — non-empty trimmed string within limit
 *
 * Teaching notes:
 *  - Every exported function takes `unknown` (or `string`) and returns a
 *    plain `boolean`. Pure logic; no side effects; trivially testable.
 *  - Callsign format validation classifies user input into three buckets:
 *    a full FCC callsign (submit), a bare suffix (the client surfaces a
 *    "type the full callsign" message until Suffix-Tap is built), or
 *    neither (existing INVALID_INPUT path). The "real" name lookup happens
 *    later via the roster (Sunday-Sync slice, not Slice 1).
 */

import { MAX_NET_TYPE, MAX_REPEATER, MAX_PURPOSE_NOTES, MAX_CALLSIGN } from './types';

// Full FCC callsign:
//   optional DX prefix  (1-3 letters + digit + 0-2 letters, then `/`) — KH6/, KP4/, AL7/, ...
//   required base       (1-2 letters + 1 digit + 1-3 letters)         — W7ABC, KE7XYZ, K7A
//   optional secondary  (`/` + 1-5 alphanumeric)                      — /M, /P, /MM, /QRP, /3
// Accepts: W7ABC, K7A, KE7XYZ, W7ABC/M, W7ABC/P, W7ABC/MM, W7ABC/QRP, KH6/W7ABC, K7XYZ/3
// Rejects: empty, single char, lowercase, special chars other than `/`, trailing/leading/
//          double slash, anything without the letters-digit-letters base structure
//          (e.g. bare suffix "ABC", all digits "12345", "K7" with no trailing letters,
//          "7ABC" starting with a digit). The bare-suffix case is what the SUFFIX_ONLY_RE
//          below catches separately so the client can show a targeted message.
const CALLSIGN_RE =
  /^(?:[A-Z]{1,3}[0-9][A-Z]{0,2}\/)?[A-Z]{1,2}[0-9][A-Z]{1,3}(?:\/[A-Z0-9]{1,5})?$/;

// Suffix-only: 1-3 ALL-CAPS letters, no digit, no slash.
// Used to detect when the user typed only the suffix part of a callsign so the
// client can route them to a "type the full callsign" message in Slice 1, and
// to a roster-lookup candidate list when Suffix-Tap (FR-3) lands.
const SUFFIX_ONLY_RE = /^[A-Z]{1,3}$/;

// ISO date: YYYY-MM-DD, month 01-12, day 01-31 (does not validate calendar — 2026-02-30 passes).
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// 24-hour time HH:mm.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidCallsign(s: unknown): s is string {
  return typeof s === 'string' && s.length <= MAX_CALLSIGN && CALLSIGN_RE.test(s);
}

export function isLikelySuffixOnly(s: unknown): s is string {
  return typeof s === 'string' && SUFFIX_ONLY_RE.test(s);
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
