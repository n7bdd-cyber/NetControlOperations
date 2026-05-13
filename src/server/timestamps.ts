/**
 * Server-clock timestamp wrapper.
 *
 * Teaching notes:
 *  - Returns ISO-8601 UTC ("2026-05-12T19:00:00.000Z"). Always UTC; client-local
 *    display formatting happens in the browser.
 *  - Wrapped so tests can freeze the clock by mocking this module.
 */

export function nowIso(): string {
  return new Date().toISOString();
}
