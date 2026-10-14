import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageEvent } from '../../shared/usage';
import { CopilotFileTailer } from './CopilotFileTailer';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const span = (spanId: string) =>
  JSON.stringify({
    name: 'chat gpt-5.5',
    traceId: 'tr',
    spanId,
    attributes: {
      'gen_ai.response.model': 'gpt-5.5',
      'gen_ai.usage.input_tokens': 10,
      'gen_ai.usage.output_tokens': 2,
    },
  });

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-cop-'));
  dirs.push(dir);
  const got: UsageEvent[] = [];
  return {
    dir,
    got,
    tailer: new CopilotFileTailer(dir, (e) => got.push(...e)),
  };
}

describe('CopilotFileTailer', () => {
  it('reads new complete lines per task file and keeps its offset', async () => {
    const { dir, got, tailer } = setup();
    writeFileSync(path.join(dir, 'task-a.jsonl'), `${span('1')}\n`);
    await tailer.poll();
    expect(got.map((e) => [e.taskId, e.id])).toEqual([['task-a', 'tr:1']]);
    appendFileSync(path.join(dir, 'task-a.jsonl'), `${span('2')}\n`);
    await tailer.poll();
    expect(got.map((e) => e.id)).toEqual(['tr:1', 'tr:2']);
    expect(tailer.stats).toEqual({ records: 2, unreadable: 0 });
  });
  it('waits for a partial last line to be completed', async () => {
    const { dir, got, tailer } = setup();
    const line = span('3');
    writeFileSync(path.join(dir, 'task-b.jsonl'), line.slice(0, 20));
    await tailer.poll();
    expect(got).toEqual([]);
    appendFileSync(path.join(dir, 'task-b.jsonl'), `${line.slice(20)}\n`);
    await tailer.poll();
    expect(got.map((e) => e.id)).toEqual(['tr:3']);
  });
  it('starts over when a file shrinks, and survives a missing folder', async () => {
    const { dir, got, tailer } = setup();
    writeFileSync(
      path.join(dir, 'task-c.jsonl'),
      `${span('4')}\n${span('5')}\n`,
    );
    await tailer.poll();
    writeFileSync(path.join(dir, 'task-c.jsonl'), `${span('6')}\n`);
    await tailer.poll();
    expect(got.map((e) => e.id)).toEqual(['tr:4', 'tr:5', 'tr:6']);
    const missing = new CopilotFileTailer(path.join(dir, 'nope'), () => {});
    await expect(missing.poll()).resolves.toBeUndefined();
  });
  it('counts unreadable lines', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dir, tailer } = setup();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'task-d.jsonl'), 'garbage\n');
    await tailer.poll();
    expect(tailer.stats).toEqual({ records: 0, unreadable: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
