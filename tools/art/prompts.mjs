// Reads prompts.md: the first "> quoted" paragraph is the general style block; a quoted paragraph inside a
// "## section" replaces it for that section. Each image is a line "**name.png** - subject" (a dash, en dash or
// em dash separates the name from the subject).
const SUBJECT = /^\*\*([a-z0-9-]+)\.png\*\*\s*[\u2014\u2013-]\s*(.+)$/s;
const oneLine = (s) => s.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

export function parsePrompts(markdown) {
  const result = new Map();
  let general = null;
  let style = '';
  for (const raw of markdown.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    const p = raw.trim();
    if (p.length === 0) continue;
    if (p.startsWith('## ')) {
      style = general ?? '';
      continue;
    }
    if (p.startsWith('>')) {
      style = oneLine(p.replace(/\n>/g, ' ').replace(/^>/, ''));
      general ??= style;
      continue;
    }
    const m = SUBJECT.exec(p);
    if (m) result.set(m[1], `${style}\n\n${oneLine(m[2])}`);
  }
  return result;
}

export function aspectRatio(prompt) {
  const p = prompt.trimEnd().toLowerCase();
  if (p.endsWith('portrait.')) return '9:16';
  if (p.endsWith('landscape.')) return '16:9';
  return '1:1';
}
