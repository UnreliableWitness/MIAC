import { describe, expect, it } from 'vitest';
import { OscScanner, PROBE_REPLY, programStatusSignal } from './OscScanner';

const ESC = '\x1b';
const BEL = '\x07';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('OscScanner', () => {
  it('finds the probe with either terminator', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}]7501;?${BEL}`)).toEqual([{ type: 'probe' }]);
    expect(s.push(`${ESC}]7501;?${ESC}\\`)).toEqual([{ type: 'probe' }]);
    expect(PROBE_REPLY).toBe(`${ESC}]7501;?${BEL}`);
  });

  it('parses status fields', () => {
    const s = new OscScanner();
    expect(
      s.push(
        `x${ESC}]7501;state=blocked:app=claude-code:kind=permission${BEL}y`,
      ),
    ).toEqual([
      {
        type: 'status',
        fields: { state: 'blocked', app: 'claude-code', kind: 'permission' },
      },
    ]);
  });

  it('joins sequences split across chunks, including a split ST', () => {
    const s = new OscScanner();
    expect(s.push(`ab${ESC}]75`)).toEqual([]);
    expect(s.push(`01;state=done:app=claude-code${ESC}`)).toEqual([]);
    expect(s.push('\\rest')).toEqual([
      { type: 'status', fields: { state: 'done', app: 'claude-code' } },
    ]);
  });

  it('reports a bare BEL but not the BEL that ends an OSC', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}]0;title${BEL}`)).toEqual([]);
    expect(s.push(`ding${BEL}`)).toEqual([{ type: 'bell' }]);
  });

  it('ignores other escape sequences and OSC codes', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}[31mred${ESC}[0m${ESC}]8;;http://x${BEL}`)).toEqual(
      [],
    );
  });

  it('drops an unterminated sequence over 8192 characters and recovers', () => {
    const s = new OscScanner();
    expect(s.push(`${ESC}]7501;${'a'.repeat(9000)}`)).toEqual([]);
    expect(s.push(`${BEL}${ESC}]7501;?${BEL}`)).toEqual([{ type: 'probe' }]);
  });
});

describe('programStatusSignal', () => {
  it('decodes msg and clamps it', () => {
    expect(
      programStatusSignal({
        state: 'blocked',
        kind: 'permission',
        msg: b64('approve Bash: rm /tmp/x'),
      }),
    ).toEqual({
      state: 'blocked',
      kind: 'permission',
      message: 'approve Bash: rm /tmp/x',
    });
    const long = programStatusSignal({
      state: 'done',
      msg: b64('x'.repeat(10_000)),
    });
    expect(long?.message?.length).toBe(200);
  });

  it('keeps the state when msg is not base64 or not text', () => {
    expect(programStatusSignal({ state: 'done', msg: '%%%' })).toEqual({
      state: 'done',
    });
    expect(
      programStatusSignal({
        state: 'done',
        msg: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64'),
      }),
    ).toEqual({ state: 'done' });
  });

  it('returns null for unknown or missing states', () => {
    expect(programStatusSignal({ state: 'dancing' })).toBeNull();
    expect(programStatusSignal({})).toBeNull();
  });
});
