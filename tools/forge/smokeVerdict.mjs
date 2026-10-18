// The pass/fail rule of the packaged smoke check (tools/forge/smoke.mjs), kept apart so it can be tested.
export const SMOKE_MARKER = 'SHELLIE_SMOKE_OK';

/**
 * Passes when the app printed the marker and was not killed by our timeout. The exit code must be 0,
 * or unknown (null/undefined): the marker is only printed after the pty check succeeded, and on Windows
 * the exit code of a GUI process can be lost.
 * @param {{ timedOut: boolean, code: number | null | undefined, output: string }} r
 * @returns {boolean}
 */
export function smokeVerdict({ timedOut, code, output }) {
  if (timedOut) return false;
  if (!output.includes(SMOKE_MARKER)) return false;
  return code === 0 || code === null || code === undefined;
}
