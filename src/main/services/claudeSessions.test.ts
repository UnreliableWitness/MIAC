import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeProjectsDir, claudeSessionExists } from './claudeSessions';

describe('claudeSessionExists', () => {
  it('finds a session file in any project folder', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-claude-'));
    mkdirSync(path.join(dir, '-Users-d-src-webshop-worktrees-48231'));
    writeFileSync(
      path.join(dir, '-Users-d-src-webshop-worktrees-48231', 'abc.jsonl'),
      '{}\n',
    );
    expect(claudeSessionExists('abc', dir)).toBe(true);
    expect(claudeSessionExists('def', dir)).toBe(false);
  });

  it('is false when Claude Code has no projects folder yet', () => {
    expect(
      claudeSessionExists('abc', path.join(os.tmpdir(), 'miac-no-such-dir')),
    ).toBe(false);
  });

  it('honours CLAUDE_CONFIG_DIR', () => {
    expect(claudeProjectsDir({ CLAUDE_CONFIG_DIR: '/cfg' })).toBe(
      path.join('/cfg', 'projects'),
    );
  });
});
