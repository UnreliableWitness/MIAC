import { describe, expect, it } from 'vitest';
import { aspectRatio, parsePrompts } from './prompts.mjs';

const md = `# Prompts

> General style, dark ground, no text.

**one.png** - A thing. Portrait.

## Icons

> Icon style, bold shapes.

**icon-a.png** - A counting hand.

**icon-b.png** - A tally. Landscape.
`;

describe('parsePrompts', () => {
  it('prefixes each subject with the style block of its section', () => {
    const p = parsePrompts(md);
    expect([...p.keys()]).toEqual(['one', 'icon-a', 'icon-b']);
    expect(p.get('one')).toBe(
      'General style, dark ground, no text.\n\nA thing. Portrait.',
    );
    expect(p.get('icon-a')).toBe(
      'Icon style, bold shapes.\n\nA counting hand.',
    );
  });
  it('falls back to the general style when a section has no block', () => {
    const p = parsePrompts(md.replace('> Icon style, bold shapes.\n\n', ''));
    expect(p.get('icon-a')).toBe(
      'General style, dark ground, no text.\n\nA counting hand.',
    );
  });
});

describe('aspectRatio', () => {
  it('reads the trailing orientation word', () => {
    expect(aspectRatio('x. Portrait.')).toBe('9:16');
    expect(aspectRatio('x. Landscape.')).toBe('16:9');
    expect(aspectRatio('x.')).toBe('1:1');
  });
});
