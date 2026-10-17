// src/main/review/ReviewService.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { viewedKey } from '../../shared/review';
import { GitClient, GitError } from '../services/GitClient';
import {
  cleanupTempRepos,
  commitFile,
  git,
  makeRepo,
} from '../test-helpers/gitRepo';
import { ReviewService } from './ReviewService';
import { ReviewStore } from './ReviewStore';
import { testTask } from './testTask';

afterAll(cleanupTempRepos);

function setup() {
  const repo = makeRepo();
  commitFile(repo, 'a.ts', 'l1\nl2\nl3\nl4\nl5\n');
  const baseSha = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', 'task');
  commitFile(repo, 'b.ts', 'b1\nb2\n');
  writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\n');
  let n = 0;
  const service = new ReviewService({
    git: new GitClient(),
    store: new ReviewStore(mkdtempSync(path.join(os.tmpdir(), 'miac-rs-'))),
    repoName: () => 'web',
    collapseOf: async () => ['gen/**'],
    now: () => new Date('2026-10-17T10:00:00.000Z'),
    newId: () => `c${++n}`,
  });
  const task = testTask({ worktreePath: repo, baseSha });
  return { repo, task, service };
}

describe('ReviewService', () => {
  it('lists every repo with its base, commits, files and collapse globs', async () => {
    const { task, service } = setup();
    const r = await service.files(task, { kind: 'all' });
    expect(r.repos).toHaveLength(1);
    expect(r.repos[0]).toMatchObject({
      workspaceId: 'home',
      name: 'web',
      collapse: ['gen/**'],
    });
    expect(r.repos[0].files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(r.repos[0].commits.map((c) => c.subject)).toEqual(['add b.ts']);
  });

  it('reports a missing worktree and no base per repo instead of failing', async () => {
    const { task, service, repo } = setup();
    const noBase = testTask({
      worktreePath: repo,
      baseSha: null,
      baseRef: 'nope',
    });
    expect(
      (await service.files(noBase, { kind: 'all' })).repos[0].error,
    ).toMatch(/No base/);
    rmSync(repo, { recursive: true, force: true });
    expect((await service.files(task, { kind: 'all' })).repos[0].error).toBe(
      'The worktree is missing',
    );
  });

  it('refuses a task that is not ready', async () => {
    const { repo, service } = setup();
    const done = testTask({ worktreePath: repo, status: 'done' });
    await expect(service.files(done, { kind: 'all' })).rejects.toThrow(
      'not ready',
    );
  });

  it('rejects a path outside the worktree', async () => {
    const { task, service } = setup();
    await expect(
      service.file(
        task,
        'home',
        { path: '../../etc/passwd', status: 'M', binary: false },
        { kind: 'all' },
      ),
    ).rejects.toThrow('Outside the worktree');
  });

  it('adds a comment with its snippet and context from the working tree', async () => {
    const { task, service } = setup();
    const s = await service.addComment(task, {
      workspaceId: 'home',
      path: 'a.ts',
      side: 'after',
      startLine: 3,
      endLine: 3,
      text: 'Why?',
    });
    expect(s.comments[0]).toMatchObject({
      id: 'c1',
      status: 'open',
      snippet: 'CHANGED',
      contextBefore: 'l1\nl2',
      contextAfter: 'l4\nl5',
      createdAt: '2026-10-17T10:00:00.000Z',
    });
  });

  it('anchors a before-side comment on the base file', async () => {
    const { task, service } = setup();
    const s = await service.addComment(task, {
      workspaceId: 'home',
      path: 'a.ts',
      side: 'before',
      startLine: 3,
      endLine: 3,
      text: 'Removed?',
    });
    expect(s.comments[0].snippet).toBe('l3');
  });

  it('moves comments with the code, marks them outdated when it changes, and revives them', async () => {
    const { task, service, repo } = setup();
    await service.addComment(task, {
      workspaceId: 'home',
      path: 'a.ts',
      side: 'after',
      startLine: 3,
      endLine: 3,
      text: 'x',
    });
    writeFileSync(path.join(repo, 'a.ts'), 'new\nl1\nl2\nCHANGED\nl4\nl5\n');
    expect((await service.state(task)).comments[0]).toMatchObject({
      startLine: 4,
      status: 'open',
    });
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nFIXED\nl4\nl5\n');
    expect((await service.state(task)).comments[0].status).toBe('outdated');
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\n');
    expect((await service.state(task)).comments[0]).toMatchObject({
      status: 'open',
      startLine: 3,
    });
  });

  it('a sent comment that goes outdated comes back as sent', async () => {
    const { task, service, repo } = setup();
    await service.addComment(task, {
      workspaceId: 'home',
      path: 'a.ts',
      side: 'after',
      startLine: 3,
      endLine: 3,
      text: 'x',
    });
    await service.markSent(task, ['c1']);
    writeFileSync(path.join(repo, 'a.ts'), 'gone\n');
    expect((await service.state(task)).comments[0]).toMatchObject({
      status: 'outdated',
      sentAt: '2026-10-17T10:00:00.000Z',
    });
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\n');
    expect((await service.state(task)).comments[0].status).toBe('sent');
  });

  it('a comment on a repo that left the task goes outdated', async () => {
    const { task, service } = setup();
    await service.addComment(task, {
      workspaceId: 'home',
      path: 'a.ts',
      side: 'after',
      startLine: 3,
      endLine: 3,
      text: 'x',
    });
    const dropped = { ...task, homeDropped: true, extraWorkspaces: [] };
    expect((await service.state(dropped)).comments[0].status).toBe('outdated');
  });

  it('keeps a comment resolved when it is resolved while state() is reading files', async () => {
    const { task, service, repo } = setup();
    await service.addComment(task, {
      workspaceId: 'home',
      path: 'a.ts',
      side: 'after',
      startLine: 3,
      endLine: 3,
      text: 'x',
    });
    writeFileSync(path.join(repo, 'a.ts'), 'gone\n');
    const pending = service.state(task);
    const resolved = service.updateComment(task, 'c1', { status: 'resolved' });
    await Promise.all([pending, resolved]);
    expect((await service.state(task)).comments[0].status).toBe('resolved');
  });

  it('resolves, reopens, edits and deletes comments; markSent only touches open ones', async () => {
    const { task, service } = setup();
    for (const line of [1, 2])
      await service.addComment(task, {
        workspaceId: 'home',
        path: 'a.ts',
        side: 'after',
        startLine: line,
        endLine: line,
        text: 't',
      });
    await service.updateComment(task, 'c2', { status: 'resolved' });
    let s = await service.markSent(task, ['c1', 'c2']);
    expect(s.comments.map((c) => c.status)).toEqual(['sent', 'resolved']);
    s = await service.updateComment(task, 'c2', {
      status: 'open',
      text: 'edited',
    });
    expect(s.comments[1]).toMatchObject({
      status: 'open',
      text: 'edited',
      resolvedAt: null,
    });
    s = await service.deleteComment(task, 'c1');
    expect(s.comments.map((c) => c.id)).toEqual(['c2']);
  });

  it('summary counts files not viewed at their current content and unresolved comments', async () => {
    const { task, service, repo } = setup();
    const files = (await service.files(task, { kind: 'all' })).repos[0].files;
    const a = files.find((f) => f.path === 'a.ts')!;
    await service.setViewed(task, viewedKey('home', 'a.ts'), a.hash);
    await service.addComment(task, {
      workspaceId: 'home',
      path: 'a.ts',
      side: 'after',
      startLine: 3,
      endLine: 3,
      text: 'x',
    });
    expect(await service.summary(task)).toEqual({
      files: 2,
      notViewed: 1,
      unresolved: 1,
    });
    writeFileSync(path.join(repo, 'a.ts'), 'l1\nl2\nCHANGED\nl4\nl5\nmore\n');
    expect((await service.summary(task)).notViewed).toBe(2);
  });

  it('anchors a before-side comment on a renamed file at its old path, and keeps it there', async () => {
    const { task, service, repo } = setup();
    git(repo, 'mv', 'a.ts', 'renamed.ts');
    const s = await service.addComment(task, {
      workspaceId: 'home',
      path: 'renamed.ts',
      oldPath: 'a.ts',
      side: 'before',
      startLine: 3,
      endLine: 3,
      text: 'Removed?',
    });
    expect(s.comments[0]).toMatchObject({
      path: 'renamed.ts',
      oldPath: 'a.ts',
      snippet: 'l3',
    });
    expect((await service.state(task)).comments[0]).toMatchObject({
      status: 'open',
      startLine: 3,
    });
  });

  it('rejects an oldPath outside the worktree', async () => {
    const { task, service } = setup();
    await expect(
      service.addComment(task, {
        workspaceId: 'home',
        path: 'a.ts',
        oldPath: '../x.ts',
        side: 'before',
        startLine: 1,
        endLine: 1,
        text: 'x',
      }),
    ).rejects.toThrow('Outside the worktree');
  });

  it('shows the error message when git fails with an empty stderr', async () => {
    const { repo } = setup();
    const failing = {
      resolveBase: async () => {
        throw new GitError(['merge-base'], '', 128);
      },
    } as unknown as GitClient;
    const service = new ReviewService({
      git: failing,
      store: new ReviewStore(mkdtempSync(path.join(os.tmpdir(), 'miac-rs-'))),
      repoName: () => 'web',
      collapseOf: async () => [],
    });
    const r = await service.files(testTask({ worktreePath: repo }), {
      kind: 'all',
    });
    expect(r.repos[0].error).toBe('git merge-base failed (128):');
  });
});
