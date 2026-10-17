export const MAX_QUOTE = 4000;

/**
 * Control characters (ESC of a bracketed-paste end marker, CR, Ctrl-C, ...) would let pasted text send
 * input to the terminal; keep only \n and \t. Trailing newlines go too.
 */
export function cleanPasteText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
      .replace(/\n+$/, '')
  );
}

/** A quote for an agent prompt: "path:N" or "path:N-M", then the text as "> " lines and an empty line. Never ends in Enter alone: the user finishes the prompt. */
export function buildQuote(
  path: string,
  start: number,
  end: number,
  text: string,
  opts: { singleLine?: boolean } = {},
): string {
  const loc = start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
  const clean = cleanPasteText(text);
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
