import { describe, expect, it } from 'vitest';
import { LeakMatcher } from './LeakMatcher';

const KEY = 'sk_test_51HxAbCdEf';
const PROD = 'prod-db-password-9f2c';
const values = [
  { name: 'STRIPE_SECRET_KEY', value: KEY, env: 'development' as const },
  { name: 'DB_PASSWORD', value: PROD, env: 'production' as const },
];

/** Feeds the chunks one by one with the carry, then flushes, as the terminal does. */
const stream = (m: LeakMatcher, chunks: string[]) => {
  let carry = '';
  let out = '';
  const hits: { name: string; env: string }[] = [];
  for (const c of chunks) {
    const r = m.mask(c, carry);
    out += r.text;
    carry = r.carry;
    hits.push(...r.hits);
  }
  const end = m.mask('', carry, true);
  out += end.text;
  hits.push(...end.hits);
  expect(end.carry).toBe('');
  return { out, hits };
};

describe('LeakMatcher', () => {
  it('masks an exact value as [NAME] and reports the hit with its environment', () => {
    const m = LeakMatcher.from(values);
    const r = stream(m, [`{"stripeKey":"${KEY}"}\r\n`]);
    expect(r.out).toBe('{"stripeKey":"[STRIPE_SECRET_KEY]"}\r\n');
    expect(r.hits).toEqual([{ name: 'STRIPE_SECRET_KEY', env: 'development' }]);
  });

  it('masks the base64 form, also inside a longer base64 string at any alignment', () => {
    const m = LeakMatcher.from(values);
    const plain = Buffer.from(KEY).toString('base64');
    expect(stream(m, [`auth: ${plain}\n`]).out).not.toContain(plain);
    for (const prefix of ['', 'a', 'ab', 'abc'])
      for (const suffix of ['', 'x', 'xy']) {
        const b64 = Buffer.from(`${prefix}${KEY}${suffix}`).toString('base64');
        const r = stream(m, [`Basic ${b64}\n`]);
        expect(r.out).toContain('[STRIPE_SECRET_KEY]');
        expect(r.hits).toHaveLength(1);
      }
    const url = Buffer.from(`??>${KEY}`).toString('base64url');
    expect(stream(m, [url]).out).toContain('[STRIPE_SECRET_KEY]');
  });

  it('masks a value split over two chunks (the tail is carried, not shown early)', () => {
    const m = LeakMatcher.from(values);
    const first = m.mask(`key=${KEY.slice(0, 7)}`, '');
    expect(first.text).not.toContain(KEY.slice(0, 7));
    expect(first.hits).toEqual([]);
    const second = m.mask(`${KEY.slice(7)} done\n`, first.carry);
    expect(first.text + second.text).toBe('key=[STRIPE_SECRET_KEY] done\n');
    expect(second.hits).toHaveLength(1);
    // Split at every point, the value never shows.
    const line = `x ${PROD} y`;
    for (let i = 1; i < line.length; i++) {
      const r = stream(m, [line.slice(0, i), line.slice(i)]);
      expect(r.out).toBe('x [DB_PASSWORD] y');
    }
  });

  it('holds back only what could start a value, so ordinary output is not delayed', () => {
    const m = LeakMatcher.from(values);
    expect(m.mask('hello world\r\n', '')).toEqual({
      text: 'hello world\r\n',
      carry: '',
      hits: [],
    });
    expect(m.mask('typing sk_', '').carry).toBe('sk_');
  });

  it('ignores values under 8 characters', () => {
    const m = LeakMatcher.from([
      { name: 'SHORT', value: 'abc1234', env: 'production' },
    ]);
    expect(m.empty).toBe(true);
    expect(m.mask('abc1234', '')).toEqual({
      text: 'abc1234',
      carry: '',
      hits: [],
    });
  });

  it('does not match exempt values (in a tracked file already)', () => {
    const m = LeakMatcher.from(values, { exempt: [KEY] });
    expect(stream(m, [`${KEY} ${PROD}`]).out).toBe(`${KEY} [DB_PASSWORD]`);
  });

  it('reports the gravest environment when two share a value, and prefers the longest match', () => {
    const m = LeakMatcher.from([
      { name: 'A', value: 'shared-value-1', env: 'development' },
      { name: 'A', value: 'shared-value-1', env: 'production' },
      { name: 'LONG', value: 'shared-value-1-and-more', env: 'test' },
    ]);
    expect(m.find('shared-value-1!')).toEqual([
      { name: 'A', env: 'production' },
    ]);
    expect(stream(m, ['shared-value-1-and-more']).out).toBe('[LONG]');
  });

  it('never splits a surrogate pair at the carry', () => {
    const m = LeakMatcher.from([
      { name: 'EMOJI', value: '😀😀-secret-x', env: 'development' },
    ]);
    for (const input of ['ok 😀', 'ok 😀😀', 'ok 😀😀-sec']) {
      const r = m.mask(input, '');
      expect(r.text + r.carry).toBe(input);
      for (const part of [r.text, r.carry])
        expect(part.isWellFormed()).toBe(true);
    }
  });

  it('keeps up with a busy terminal: many values, long chunks', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      name: `K${i}`,
      value: `value-${i}-${'q'.repeat(30)}-${i}`,
      env: 'test' as const,
    }));
    const m = LeakMatcher.from(many);
    const chunk = `${'lorem ipsum dolor sit amet '.repeat(40_000)}value-499-${'q'.repeat(30)}-499`;
    const t0 = performance.now();
    const r = stream(m, [chunk, chunk]);
    const ms = performance.now() - t0;
    expect(r.hits).toHaveLength(2);
    expect(ms).toBeLessThan(1500);
  });
});
