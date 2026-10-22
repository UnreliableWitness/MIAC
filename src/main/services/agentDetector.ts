import { execFile } from 'node:child_process';
import {
  AGENT_IDS,
  type AgentId,
  type AgentProbe,
  type AgentsDetected,
} from '../../shared/agents';
import type { Command, Platform } from '../platform/Platform';

export type ProbeRunner = (
  cmd: Command,
  timeoutMs: number,
) => Promise<{ code: number; stdout: string }>;

const PROBE_TIMEOUT_MS = 5000;

/** Runs a command to completion; a non-zero exit resolves with its code, a timeout or spawn failure rejects. */
export const runProbe: ProbeRunner = (cmd, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd.command,
      cmd.args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, ...cmd.env },
      },
      (err, stdout) => {
        if (!err) return resolve({ code: 0, stdout });
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        if (e.killed || typeof e.code !== 'number') return reject(err);
        resolve({ code: e.code, stdout: String(stdout ?? '') });
      },
    );
  });

const NOT_FOUND: AgentProbe = { found: false, version: null, path: null };

async function probe(
  platform: Platform,
  run: ProbeRunner,
  id: AgentId,
): Promise<AgentProbe> {
  try {
    const { code, stdout } = await run(
      platform.probeCommand(id),
      PROBE_TIMEOUT_MS,
    );
    if (code !== 0) return NOT_FOUND;
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return NOT_FOUND;
    const version = lines[1]?.match(/\d+\.\d+\.\d+\S*/)?.[0] ?? null;
    return { found: true, version, path: lines[0] };
  } catch {
    return NOT_FOUND;
  }
}

export async function detectAgents(
  platform: Platform,
  run: ProbeRunner,
): Promise<AgentsDetected> {
  const results = await Promise.all(
    AGENT_IDS.map((id) => probe(platform, run, id)),
  );
  return {
    checkedAt: new Date().toISOString(),
    agents: Object.fromEntries(
      AGENT_IDS.map((id, i) => [id, results[i]]),
    ) as AgentsDetected['agents'],
    shell: { label: platform.shellLabel },
  };
}
