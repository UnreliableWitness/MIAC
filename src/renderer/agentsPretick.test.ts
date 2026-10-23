import { describe, expect, it } from 'vitest';
import type { AgentsDetected } from '../shared/agents';
import { pretick } from './agentsPretick';

const detected = (found: string[]): AgentsDetected => ({
  checkedAt: '2026-10-22T10:00:00.000Z',
  agents: {
    claude: { found: found.includes('claude'), version: null, path: null },
    copilot: { found: found.includes('copilot'), version: null, path: null },
    opencode: { found: found.includes('opencode'), version: null, path: null },
  },
  shell: { label: 'zsh' },
});

describe('pretick', () => {
  it('ticks only Claude Code when Claude Code and OpenCode are found', () => {
    expect(pretick(detected(['claude', 'opencode']))).toEqual({
      claude: true,
      copilot: false,
      opencode: false,
      shell: true,
    });
  });
  it('ticks OpenCode when it is the only one found', () => {
    expect(pretick(detected(['opencode']))).toEqual({
      claude: false,
      copilot: false,
      opencode: true,
      shell: true,
    });
  });
  it('prefers OpenCode over Copilot', () => {
    expect(pretick(detected(['copilot', 'opencode'])).opencode).toBe(true);
  });
  it('ticks only the shell when nothing is found', () => {
    expect(pretick(detected([]))).toEqual({
      claude: false,
      copilot: false,
      opencode: false,
      shell: true,
    });
  });
});
