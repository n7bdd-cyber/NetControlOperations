/**
 * Project: NetControlOperations
 * File: timestamps.ts
 * System Version: 1.0.0 | File Version: 1 | Date: 2026-05-15
 *   v1: Initial version tracking.
 *
 * Description: Server-clock timestamp wrapper for test-seam isolation.
 *   nowIso() — returns ISO-8601 UTC string; mocked in jest to freeze the clock
 *
 * Teaching notes:
 *  - Returns ISO-8601 UTC ("2026-05-12T19:00:00.000Z"). Always UTC; client-local
 *    display formatting happens in the browser.
 *  - Wrapped so tests can freeze the clock by mocking this module.
 */

export function nowIso(): string {
  return new Date().toISOString();
}
