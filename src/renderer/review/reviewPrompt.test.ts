import { describe, expect, it } from 'vitest';
import { buildReviewPrompt } from './reviewPrompt';

const a = {
  path: 'src/a.ts',
  startLine: 42,
  endLine: 45,
  snippet: 'const x = compute(a);\nreturn x;',
  text: 'Use the cached value.',
};
const b = {
  path: 'web/src/b.tsx',
  startLine: 10,
  endLine: 10,
  snippet: '<div/>',
  text: 'Why a div?\nUse a button.',
};

describe('buildReviewPrompt', () => {
  it('numbers the comments with their location, quoted lines and text, ending without Enter', () => {
    expect(buildReviewPrompt([a, b])).toBe(
      [
        'Review comments on the changes in this task:',
        '',
        '1. src/a.ts:42-45',
        '   > const x = compute(a);',
        '   > return x;',
        '   Use the cached value.',
        '',
        '2. web/src/b.tsx:10',
        '   > <div/>',
        '   Why a div?',
        '   Use a button.',
        '',
        '',
      ].join('\n'),
    );
  });

  it('strips control characters a comment could use to send keys', () => {
    const out = buildReviewPrompt([
      { ...a, text: 'ok\x1b[201~\rrm -rf /\x03' },
    ]);
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    expect(out).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
    // CR becomes a line break (indented like the rest of the comment); ESC and Ctrl-C are gone.
    expect(out).toContain('   ok[201~\n   rm -rf /\n');
  });

  it('shortens long snippets', () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const out = buildReviewPrompt([{ ...a, snippet: long }]);
    expect(out).toContain('   > line 11\n   > …');
    expect(out).not.toContain('line 12');
  });

  it('flattens for a terminal without bracketed paste', () => {
    const out = buildReviewPrompt([a, b], { singleLine: true });
    expect(out).not.toContain('\n');
    expect(out).toBe(
      'Review comments on the changes in this task: 1. src/a.ts:42-45: Use the cached value. 2. web/src/b.tsx:10: Why a div? Use a button. ',
    );
  });

  it('cleans the location in both modes', () => {
    const odd = { ...a, path: 'a\x1b[201~\nb.ts' };
    const multi = buildReviewPrompt([odd]);
    expect(multi.split('\n')[2]).toBe('1. a[201~ b.ts:42-45');
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    expect(multi).not.toMatch(/\x1b/);
    const flat = buildReviewPrompt([odd], { singleLine: true });
    expect(flat).not.toContain('\n');
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    expect(flat).not.toMatch(/\x1b/);
    expect(flat).toContain('1. a[201~ b.ts:42-45:');
  });
});
