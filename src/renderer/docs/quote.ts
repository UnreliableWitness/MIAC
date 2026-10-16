export const MAX_QUOTE = 4000;

/** A quote for an agent prompt: "path:N" or "path:N-M", then the text as "> " lines and an empty line. Never ends in Enter alone: the user finishes the prompt. */
export function buildQuote(
  path: string,
  start: number,
  end: number,
  text: string,
  opts: { singleLine?: boolean } = {},
): string {
  const loc = start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (opts.singleLine) {
    const flat = clean.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE);
    return `${loc} "${flat}" `;
  }
  let body = clean
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');
  if (body.length > MAX_QUOTE)
    body = `${body.slice(0, MAX_QUOTE)}\n> …(truncated)`;
  return `${loc}\n${body}\n\n`;
}
