/**
 * UUID generator wrapper.
 *
 * Teaching notes:
 *  - Wraps `Utilities.getUuid()` so jest tests can mock this module and feed a
 *    deterministic UUID sequence. The Apps Script global `Utilities` is awkward
 *    to mock cleanly; a local wrapper gives us one stable seam.
 *  - In production this just calls Apps Script's built-in UUID generator.
 */

export function newUuid(): string {
  return Utilities.getUuid();
}
