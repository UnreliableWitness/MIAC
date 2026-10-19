import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Task } from '../../shared/types';
import { GitClient } from '../services/GitClient';
import { claudeProjectFolder } from '../services/claudeSessions';
import { cleanupTempRepos, makeRepo, tempRoots } from '../test-helpers/gitRepo';
import { absoluteIn, mdEditsFromLines, SessionDocs } from './sessionDocs';

afterAll(() => cleanupTempRepos());

const line = (
  name: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-19T10:00:00Z',
    message: { content: [{ type: 'tool_use', name, input }] },
    ...extra,
  });

describe('mdEditsFromLines', () => {
  it('takes Markdown paths from Write, Edit, MultiEdit and NotebookEdit', () => {
    const edits = mdEditsFromLines([
      line('Write', { file_path: '/a/one.md' }),
      line('Edit', { file_path: '/a/two.MD' }),
      line('MultiEdit', { file_path: '/a/three.markdown' }),
      line('NotebookEdit', { notebook_path: '/a/four.md' }),
      line('Read', { file_path: '/a/read.md' }),
      line('Write', { file_path: '/a/code.ts' }),
      line('Bash', { command: 'echo hi > /a/bash.md' }),
    ]);
    expect(edits.map((e) => e.path)).toEqual(
      ['/a/one.md', '/a/two.MD', '/a/three.markdown', '/a/four.md'].map((p) =>
        path.resolve(p),
      ),
    );
    expect(edits[0].at).toBe(Date.parse('2026-10-19T10:00:00Z'));
  });

  it('keeps Windows paths, also relative ones against a Windows cwd', () => {
    const edits = mdEditsFromLines([
      line('Write', {
        file_path:
          'C:\\Projects\\investigations\\2026-10-19-ado-7951-push-order-to-fo.md',
      }),
      line(
        'Edit',
        { file_path: 'docs\\plan.md' },
        { cwd: 'C:\\src\\webshop.worktrees\\t1' },
      ),
      line('Edit', { file_path: 'C:/Projects/fwd.md' }),
    ]);
    expect(edits.map((e) => e.path)).toEqual([
      'C:\\Projects\\investigations\\2026-10-19-ado-7951-push-order-to-fo.md',
      'C:\\src\\webshop.worktrees\\t1\\docs\\plan.md',
      'C:\\Projects\\fwd.md',
    ]);
  });

  it('skips malformed lines, other entry types and odd inputs', () => {
    expect(
      mdEditsFromLines([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/x.md"}',
        'not json at all "tool_use" ".md"',
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Write',
                input: { file_path: '/u.md' },
              },
            ],
          },
        }),
        JSON.stringify({ type: 'assistant', message: { content: 'x.md' } }),
        line('Write', { file_path: 42 } as never),
        line('Write', { file_path: '' }),
        line('Write', null as never),
        // Relative without a cwd cannot be placed.
        line('Write', { file_path: 'rel.md' }),
      ]),
    ).toEqual([]);
  });

  it('resolves relative paths against the entry cwd', () => {
    expect(
      mdEditsFromLines([
        line('Write', { file_path: 'docs/a.md' }, { cwd: '/w/t1' }),
      ]).map((e) => e.path),
    ).toEqual([path.resolve('/w/t1/docs/a.md')]);
  });
});

describe('absoluteIn', () => {
  it('handles both path styles', () => {
    expect(absoluteIn('C:\\a\\..\\b.md', null)).toBe('C:\\b.md');
    expect(absoluteIn('\\\\server\\share\\x.md', null)).toBe(
      '\\\\server\\share\\x.md',
    );
    expect(absoluteIn('x.md', null)).toBeNull();
  });
});

describe('SessionDocs', () => {
  function fixture(o: { sessionId?: string } = {}) {
    const repo = makeRepo('wt');
    const tmp = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), 'shellie-sd-')),
    );
    tempRoots.push(tmp);
    const projects = path.join(tmp, 'projects');
    const folder = path.join(projects, claudeProjectFolder(repo));
    mkdirSync(folder, { recursive: true });
    const task = {
      id: 't1',
      status: 'ready',
      worktreePath: repo,
      baseSha: null,
      homeDropped: false,
      extraWorkspaces: [],
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      terminals: [
        { id: 'a', kind: 'claude', label: 'Claude', sessionId: o.sessionId },
      ],
      closedTerminals: [],
    } as unknown as Task;
    const s = new SessionDocs({
      git: new GitClient(),
      projectsDir: () => projects,
    });
    return { repo, tmp, projects, folder, task, s };
  }

  it('without a session id, reads the worktree folder transcripts written since the task started, incrementally', async () => {
    const { repo, tmp, folder, task, s } = fixture();
    const a = path.join(tmp, 'a.md');
    const b = path.join(tmp, 'b.md');
    const old = path.join(tmp, 'old.md');
    for (const f of [a, b, old]) writeFileSync(f, '# x\n');
    const log = path.join(folder, 'any-id.jsonl');
    writeFileSync(log, line('Write', { file_path: a }) + '\n');
    const before = path.join(folder, 'before.jsonl');
    writeFileSync(before, line('Write', { file_path: old }) + '\n');
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(before, past, past);
    expect((await s.list(task)).map((e) => e.path)).toEqual([a]);
    appendFileSync(log, line('Edit', { file_path: b }) + '\n');
    expect((await s.list(task)).map((e) => e.path)).toEqual([a, b]);
    expect(repo).toBeTruthy();
  });

  it('finds a session by id in any project folder', async () => {
    const { tmp, projects, task, s } = fixture({ sessionId: 'sid-1' });
    const a = path.join(tmp, 'a.md');
    writeFileSync(a, '# a\n');
    const other = path.join(projects, 'some-shortened-folder');
    mkdirSync(other);
    writeFileSync(
      path.join(other, 'sid-1.jsonl'),
      line('Write', { file_path: a }) + '\n',
    );
    expect((await s.list(task)).map((e) => e.path)).toEqual([a]);
    expect(await s.find(task, a)).toMatchObject({ workspaceId: null });
    expect(await s.find(task, path.join(tmp, 'nope.md'))).toBeNull();
    expect(await s.find(task, 'a.md')).toBeNull();
  });
});
