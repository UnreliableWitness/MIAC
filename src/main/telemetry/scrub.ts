/** Escapes a literal for use in a RegExp. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Path forms of `dir` as they can appear in text: as is, with forward slashes, as a file URL path. */
function forms(dir: string): string[] {
  const out = new Set<string>([dir]);
  out.add(dir.replace(/\\/g, '/'));
  out.add(dir.replace(/\//g, '\\'));
  out.add(encodeURI(dir.replace(/\\/g, '/')));
  return [...out].filter((f) => f.length > 1);
}

/**
 * Makes a stack trace or message safe to send: the home folder becomes `~`, any other user
 * folder (`/Users/x`, `/home/x`, `C:\Users\x`) becomes `~` too, and every sensitive value
 * (repo names and paths, branch names, task and work item titles, organization URLs) becomes `<redacted>`.
 */
export function scrub(
  text: string,
  opts: { home?: string; sensitive?: Iterable<string> } = {},
): string {
  let out = text;
  const secrets = [...(opts.sensitive ?? [])]
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    // Longest first, so a repo path is replaced before the repo name inside it.
    .sort((a, b) => b.length - a.length);
  for (const s of secrets)
    for (const f of forms(s))
      out = out.replace(new RegExp(escape(f), 'gi'), '<redacted>');
  out = out.replace(/([A-Za-z]:)?[\\/](Users|home)[\\/][^\\/\s'"`:)]+/gi, '~');
  if (opts.home)
    for (const f of forms(opts.home))
      out = out.replace(new RegExp(`([A-Za-z]:)?${escape(f)}`, 'gi'), '~');
  out = out
    .replace(/\b(?:https?|ssh|git):\/\/[^\s'")]+/gi, '<url>')
    // scp-like ssh remotes (git@ssh.dev.azure.com:v3/org/project/repo) name the project and repo.
    .replace(/\b[\w.-]+@[\w-]+(\.[\w-]+)+:[^\s'")]+/g, '<url>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
  return out;
}
