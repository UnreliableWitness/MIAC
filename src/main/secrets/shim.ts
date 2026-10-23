import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isAgentKind } from '../../shared/terminalFailure';
import type { TerminalDef } from '../../shared/types';

/**
 * `shellie run` for agents: the shims Shellie writes to `<userData>/bin` on every start, first on agent tabs' PATH.
 * They POST the name and arguments to Shellie's local `/v1/run` with the task's token and print the answer, whose
 * last line (NUL `exit:<code>`) becomes their exit code. curl does the HTTP on both platforms (macOS ships it,
 * Windows 10 and later ship curl.exe). No time limit, since tests and dev servers run long; a connect timeout, so
 * a Shellie that does not answer never hangs the agent.
 */

/** POSIX sh (macOS, and Git Bash on Windows, which Claude Code's Bash tool uses). Builds no JSON: a form body. */
export const SHIM_SH = `#!/bin/sh
# Written by Shellie on every start; edits are overwritten.
# shellie run <name> [-- args...]: runs one of this task's named commands in Shellie, with the task's secrets, and
# prints its output with stored values hidden. Plain commands in this shell run without secrets.
if [ "\${1-}" != run ]; then
  echo 'Usage: shellie run <name> [-- args...]' >&2
  exit 2
fi
shift
if [ -z "\${SHELLIE_RUN_URL-}" ] || [ -z "\${SHELLIE_RUN_TOKEN-}" ]; then
  echo 'shellie run works in an agent tab that Shellie started' >&2
  exit 1
fi
name=
if [ $# -gt 0 ] && [ "$1" != -- ]; then
  name=$1
  shift
fi
if [ "\${1-}" = -- ]; then
  shift
fi
# Git Bash on Windows: the folder as Windows writes it.
here=$(pwd -W 2>/dev/null || pwd)
dir=$(mktemp -d "\${TMPDIR:-/tmp}/shellie-run.XXXXXX") || exit 1
trap 'rm -rf "$dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# The token goes to curl in a file: on its command line other users could list it.
(umask 077 && printf 'Authorization: Bearer %s\\n' "$SHELLIE_RUN_TOKEN" >"$dir/auth") || exit 1
if [ -z "$name" ]; then
  set -- --get --data-urlencode "workspace=$here"
else
  # Each argument is its own form field, never part of a shell line.
  for a do
    set -- "$@" --data-urlencode "arg=$a"
    shift
  done
  set -- "$@" --data-urlencode "name=$name" --data-urlencode "workspace=$here" \\
    --data-urlencode "terminal=\${SHELLIE_TERMINAL_ID-}"
fi
# No time limit (tests and dev servers run long), but a connect timeout, so a stuck Shellie never hangs the agent.
# The answer ends with the line NUL exit:<code>; sed keeps it out of the output (unbuffered, NUL safe).
curl -q -s -N --noproxy '*' --connect-timeout 5 -D "$dir/head" -H "@$dir/auth" "$@" "$SHELLIE_RUN_URL" |
  LC_ALL=C sed -u -n -e '/^[[:cntrl:]]exit:-\\{0,1\\}[0-9]\\{1,\\}$/{' -e "w $dir/exit" -e 'd' -e '}' -e 'p'
status=$(sed -n 's/^HTTP\\/[0-9.]* \\([0-9][0-9]*\\).*/\\1/p' "$dir/head" 2>/dev/null | tail -n 1)
if [ -z "$status" ]; then
  echo 'Shellie is not running' >&2
  exit 1
fi
if [ "$status" = 401 ]; then
  echo "This task's run link expired; start the agent tab again from Shellie" >&2
  exit 1
fi
if [ "$status" != 200 ]; then
  echo "Shellie refused the request (HTTP $status)" >&2
  exit 1
fi
code=$(LC_ALL=C tr -d '\\000' <"$dir/exit" 2>/dev/null | tail -n 1 | sed 's/^exit://')
case $code in
'' | *[!0-9]*)
  [ -s "$dir/exit" ] || echo 'Shellie stopped before the command finished' >&2
  exit 1
  ;;
esac
[ "$code" -le 255 ] || exit 1
exit "$code"
`;

/** Windows PowerShell 5.1 or 7, started by shellie.cmd. */
export const SHIM_PS1 =
  `# Written by Shellie on every start; edits are overwritten.
# shellie run <name> [-- args...]: runs one of this task's named commands in Shellie, with the task's secrets, and
# prints its output with stored values hidden. Plain commands in this shell run without secrets.
$ErrorActionPreference = 'Stop'
function Fail([string]$message, [int]$code = 1) {
  [Console]::Error.WriteLine($message)
  exit $code
}
if ($args.Count -lt 1 -or $args[0] -ne 'run') { Fail 'Usage: shellie run <name> [-- args...]' 2 }
if (-not $env:SHELLIE_RUN_URL -or -not $env:SHELLIE_RUN_TOKEN) {
  Fail 'shellie run works in an agent tab that Shellie started'
}
# curl is an alias of Invoke-WebRequest in Windows PowerShell: always curl.exe (Windows 10 and later ship it).
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Fail 'shellie run needs curl.exe (Windows 10 or later)' }
$rest = @($args | Select-Object -Skip 1)
$name = ''
if ($rest.Count -gt 0 -and $rest[0] -ne '--') {
  $name = [string]$rest[0]
  $rest = @($rest | Select-Object -Skip 1)
}
if ($rest.Count -gt 0 -and $rest[0] -eq '--') { $rest = @($rest | Select-Object -Skip 1) }
$dir = Join-Path ([IO.Path]::GetTempPath()) ('shellie-run-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
$code = $null
$status = $null
try {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  # The token goes to curl in a file: on its command line other users could list it.
  $auth = Join-Path $dir 'auth'
  [IO.File]::WriteAllText($auth, "Authorization: Bearer $($env:SHELLIE_RUN_TOKEN)\`n", $utf8)
  $head = Join-Path $dir 'head'
  # No time limit (tests and dev servers run long), but a connect timeout, so a stuck Shellie never hangs the agent.
  $curl = @('-q', '-s', '-N', '--noproxy', '*', '--connect-timeout', '5', '-D', $head, '-H', "@$auth")
  $here = $PWD.ProviderPath
  if ($name -eq '') {
    $curl += @('--get', '--data-urlencode', "workspace=$here")
  } else {
    # The arguments travel as JSON in a file: never part of a shell line, and out of PowerShell's native quoting.
    $body = Join-Path $dir 'body'
    $json = ConvertTo-Json -Compress -InputObject @{
      name = $name
      args = [string[]]$rest
      workspace = $here
      terminal = [string]$env:SHELLIE_TERMINAL_ID
    }
    [IO.File]::WriteAllText($body, $json, $utf8)
    $curl += @('-H', 'Content-Type: application/json', '--data-binary', "@$body")
  }
  try { [Console]::OutputEncoding = $utf8 } catch {}
  # The answer ends with the line NUL exit:<code>; it becomes the exit code, not output.
  $mark = "$([char]0)exit:"
  & curl.exe @curl $env:SHELLIE_RUN_URL | ForEach-Object {
    if ($_.StartsWith($mark)) { $code = $_.Substring($mark.Length) } else { [Console]::Out.WriteLine($_) }
  }
  if (Test-Path $head) {
    foreach ($line in Get-Content $head) { if ($line -match '^HTTP/\\S+ (\\d+)') { $status = $Matches[1] } }
  }
} finally {
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}
if (-not $status) { Fail 'Shellie is not running' }
if ($status -eq '401') { Fail "This task's run link expired; start the agent tab again from Shellie" }
if ($status -ne '200') { Fail "Shellie refused the request (HTTP $status)" }
if ($code -notmatch '^\\d{1,9}$') {
  if ($null -eq $code) { [Console]::Error.WriteLine('Shellie stopped before the command finished') }
  exit 1
}
exit ([int]$code)
`.replaceAll('\n', '\r\n');

/** What cmd.exe and PowerShell find on PATH (PATHEXT): runs the ps1 next to it. */
export const SHIM_CMD = [
  '@echo off',
  'rem Written by Shellie on every start; edits are overwritten.',
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0shellie.ps1" %*',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n');

/** The files, all on every platform: Git Bash on Windows runs the sh one, cmd and PowerShell the .cmd one. */
export function shimFiles(): { name: string; content: string; mode: number }[] {
  return [
    { name: 'shellie', content: SHIM_SH, mode: 0o755 },
    { name: 'shellie.cmd', content: SHIM_CMD, mode: 0o644 },
    { name: 'shellie.ps1', content: SHIM_PS1, mode: 0o644 },
  ];
}

/** Writes the shims to `dir` (made when missing). */
export async function writeShims(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const f of shimFiles()) {
    const file = path.join(dir, f.name);
    await fs.writeFile(file, f.content, { mode: f.mode });
    // writeFile keeps an existing file's mode.
    await fs.chmod(file, f.mode);
  }
}

/** Agent tabs only: where `shellie run` goes, the task's token, and the shim first on PATH. Others get nothing. */
export function agentRunEnv(
  kind: TerminalDef['kind'],
  o: {
    url: string;
    token: string;
    shimDir: string;
    env: Record<string, string | undefined>;
    delimiter?: string;
  },
): Record<string, string> {
  if (!isAgentKind(kind)) return {};
  return {
    SHELLIE_RUN_URL: o.url,
    SHELLIE_RUN_TOKEN: o.token,
    ...withShimPath(o.env, o.shimDir, o.delimiter),
  };
}

/** The PATH entry with the shim folder first, under the key the environment has (Windows: `Path`). */
export function withShimPath(
  env: Record<string, string | undefined>,
  dir: string,
  delimiter: string = path.delimiter,
): Record<string, string> {
  const key =
    Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const current = env[key];
  return { [key]: current ? `${dir}${delimiter}${current}` : dir };
}
