/** Git sign-in failures and what to tell the user about them. Pure: no I/O. */

/** Where git could not sign in: the remote's host, the Azure DevOps connection whose token was used (if any), the folder. */
export type GitAuthHint = {
  host: string;
  connectionId: string | null;
  path: string;
};

const AUTH_FAILURE = [
  /could not read (?:Username|Password)/i,
  /Authentication failed/i,
  /terminal prompts disabled/i,
  /HTTP Basic: Access denied/i,
  /The requested URL returned error: 40[13]\b/i,
];

/** Whether git's stderr says it could not sign in to the remote. */
export function isGitAuthFailure(text: string): boolean {
  return AUTH_FAILURE.some((re) => re.test(text));
}

/** The host of a remote URL: `https://user@host/...`, `ssh://git@host/...` or scp-style `git@host:path`. */
export function remoteHost(url: string): string | null {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname.toLowerCase() || null;
    } catch {
      return null;
    }
  }
  const scp = /^(?:[^@/]+@)?([^:/]+):/.exec(trimmed);
  return scp ? scp[1].toLowerCase() : null;
}

/** The host of the first http(s) URL in a message, e.g. git's "could not read Password for 'https://…'". */
export function hostInText(text: string): string | null {
  const m = /https?:\/\/[^\s'"]+/i.exec(text);
  return m ? remoteHost(m[0]) : null;
}

/** What to do about a sign-in failure. `command` is the git command to run by hand for a remote without a token. */
export function gitAuthAdvice(
  hint: GitAuthHint,
  command: 'git fetch' | 'git push' = 'git fetch',
): string {
  if (hint.connectionId)
    return `Git could not sign in to ${hint.host} with your Azure DevOps token. Update the token, then Retry.`;
  return `Git could not sign in to ${hint.host}. Sign in once from a terminal (run \`${command}\` in ${hint.path}), then Retry.`;
}
