import { describe, expect, it } from 'vitest';
import type { Platform } from '../platform/Platform';
import { detectAgents } from './agentDetector';

const platform = {
  shellLabel: 'zsh',
  probeCommand: (name: string) => ({ command: 'probe', args: [name] }),
} as unknown as Platform;

describe('detectAgents', () => {
  it('reads the path and version, and marks missing agents', async () => {
    const r = await detectAgents(platform, async (cmd) =>
      cmd.args[0] === 'claude'
        ? { code: 0, stdout: '/usr/local/bin/claude\n2.1.307 (Claude Code)\n' }
        : { code: 1, stdout: '' },
    );
    expect(r.agents.claude).toEqual({
      found: true,
      version: '2.1.307',
      path: '/usr/local/bin/claude',
    });
    expect(r.agents.copilot).toEqual({
      found: false,
      version: null,
      path: null,
    });
    expect(r.agents.opencode.found).toBe(false);
    expect(r.shell).toEqual({ label: 'zsh' });
    expect(new Date(r.checkedAt).toISOString()).toBe(r.checkedAt);
  });

  it('treats a timeout as not found', async () => {
    const r = await detectAgents(platform, async () => {
      throw new Error('timed out');
    });
    expect(r.agents.claude.found).toBe(false);
  });

  it('runs the probes in parallel with a 5 s timeout', async () => {
    const seen: number[] = [];
    let open = 0;
    let peak = 0;
    await detectAgents(platform, async (_c, ms) => {
      seen.push(ms);
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1;
      return { code: 1, stdout: '' };
    });
    expect(seen).toEqual([5000, 5000, 5000]);
    expect(peak).toBe(3);
  });
});
