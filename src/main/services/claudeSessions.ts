import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where Claude Code keeps its sessions: `<config dir>/projects/<folder per cwd>/<session id>.jsonl`. */
export function claudeProjectsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(
    env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    'projects',
  );
}

/**
 * Whether Claude Code saved a conversation with this id. A session is only written once the user sends a
 * message, so a tab started with --session-id but never used has none and must start again, not resume.
 * Any folder under projects/ is checked, so the way Claude names the folder for a cwd does not matter.
 */
export function claudeSessionExists(
  sessionId: string,
  projectsDir: string = claudeProjectsDir(),
): boolean {
  let folders: string[];
  try {
    folders = readdirSync(projectsDir);
  } catch {
    return false;
  }
  return folders.some((f) =>
    existsSync(path.join(projectsDir, f, `${sessionId}.jsonl`)),
  );
}
