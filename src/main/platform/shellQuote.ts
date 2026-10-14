/** POSIX single-quote quoting: safe for zsh, bash and sh. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}
