import { describe, expect, it } from 'vitest';
import { smokeVerdict } from './smokeVerdict.mjs';

const OK = 'smoke: pty ok\nMIAC_SMOKE_OK\n';

describe('smokeVerdict', () => {
  it('passes on the marker and exit 0', () => {
    expect(smokeVerdict({ timedOut: false, code: 0, output: OK })).toBe(true);
  });

  it('passes on the marker when the exit code is unknown', () => {
    expect(smokeVerdict({ timedOut: false, code: null, output: OK })).toBe(
      true,
    );
    expect(smokeVerdict({ timedOut: false, code: undefined, output: OK })).toBe(
      true,
    );
  });

  it('fails without the marker, on a non-zero exit, or after our timeout', () => {
    expect(smokeVerdict({ timedOut: false, code: 0, output: 'x' })).toBe(false);
    expect(smokeVerdict({ timedOut: false, code: null, output: '' })).toBe(
      false,
    );
    expect(smokeVerdict({ timedOut: false, code: 1, output: OK })).toBe(false);
    expect(smokeVerdict({ timedOut: true, code: null, output: OK })).toBe(
      false,
    );
    expect(smokeVerdict({ timedOut: true, code: 0, output: OK })).toBe(false);
  });
});
