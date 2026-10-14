import { darwinPlatform } from '../platform/darwin';
import type { Platform } from '../platform/Platform';
import { which } from '../platform/which';
import { windowsPlatform } from '../platform/windows';

export const isWindows = process.platform === 'win32';

/** The real platform for this OS, with a fast shell on macOS (/bin/sh, no login profile surprises). */
export const testPlatform = (): Platform =>
  isWindows
    ? windowsPlatform(process.env, { which: (n) => which(n) })
    : darwinPlatform({ SHELL: '/bin/sh' });

/** Command lines in the syntax of testPlatform().shellCommand. */
export const echoCmd = (text: string): string =>
  isWindows
    ? `Write-Output '${text.replaceAll("'", "''")}'`
    : `echo '${text.replaceAll("'", "'\\''")}'`;
export const sleepCmd = (seconds: number): string =>
  isWindows ? `Start-Sleep -Seconds ${seconds}` : `sleep ${seconds}`;
export const envRef = (name: string): string =>
  isWindows ? `$env:${name}` : `$${name}`;
export const failCmd = (code: number): string =>
  isWindows ? `cmd /c exit ${code}` : `exit ${code}`;

/**
 * Write `text` plus a line break to `file`, replacing it (`append` false) or appending to it.
 * ASCII on Windows: a plain `>` would write UTF-16 under Windows PowerShell 5.
 * The line break is `\r\n` on Windows, so read the file back with normaliseEol.
 */
export const writeLineCmd = (
  text: string,
  file: string,
  append = false,
): string =>
  isWindows
    ? `${append ? 'Add-Content' : 'Set-Content'} -Encoding ascii -Path '${file}' -Value '${text.replaceAll("'", "''")}'`
    : `echo '${text.replaceAll("'", "'\\''")}' ${append ? '>>' : '>'} '${file}'`;

/** `\r\n` to `\n`, for comparing files and terminal output across OSes. */
export const normaliseEol = (s: string): string => s.replaceAll('\r\n', '\n');
