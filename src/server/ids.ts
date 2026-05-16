/**
 * Project: NetControlOperations
 * File: ids.ts
 * System Version: 1.0.0 | File Version: 1 | Date: 2026-05-15
 *   v1: Initial version tracking.
 *
 * Description: UUID generator wrapper for test-seam isolation.
 *   newUuid() — wraps Utilities.getUuid(); mocked in jest for deterministic IDs
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
