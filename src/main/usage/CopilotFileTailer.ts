import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { UsageEvent } from '../../shared/usage';
import type { Interval } from '../../shared/time';
import { copilotAgentIntervals, parseCopilotLine } from './copilot';

/** Follows `<dir>/<taskId>.jsonl` files written by Copilot CLI. Offsets live in memory; the store dedupes re-reads after a restart. */
export class CopilotFileTailer {
  private readonly offsets = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private counts = { records: 0, unreadable: 0 };

  constructor(
    private readonly dir: string,
    private readonly onEvents: (events: UsageEvent[]) => void,
    private readonly onAgent?: (taskId: string, ivs: Interval[]) => void,
  ) {}

  get stats() {
    return { ...this.counts };
  }

  start(intervalMs = 5000): void {
    this.stop();
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll(): Promise<void> {
    this.running ??= this.scan().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async scan(): Promise<void> {
    let names: string[];
    try {
      names = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return;
    }
    for (const name of names) {
      try {
        await this.readFile(name);
      } catch (e) {
        console.warn(
          `[usage] could not read ${name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  private async readFile(name: string): Promise<void> {
    const file = path.join(this.dir, name);
    const taskId = name.slice(0, -'.jsonl'.length);
    const { size } = await fs.stat(file);
    let offset = this.offsets.get(name) ?? 0;
    if (size < offset) offset = 0;
    if (size === offset) return;
    const handle = await fs.open(file, 'r');
    let chunk: Buffer;
    try {
      chunk = Buffer.alloc(size - offset);
      await handle.read(chunk, 0, chunk.length, offset);
    } finally {
      await handle.close();
    }
    const end = chunk.lastIndexOf(0x0a);
    if (end < 0) return;
    this.offsets.set(name, offset + end + 1);
    const events: UsageEvent[] = [];
    const ivs: Interval[] = [];
    for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
      const r = parseCopilotLine(line, taskId);
      events.push(...r.events);
      ivs.push(...copilotAgentIntervals(line));
      this.counts.unreadable += r.unreadable;
      if (r.unreadable > 0)
        console.warn(
          `[usage] ${r.unreadable} unreadable Copilot CLI line(s) in ${name}`,
        );
    }
    this.counts.records += events.length;
    if (events.length > 0) this.onEvents(events);
    if (ivs.length > 0) this.onAgent?.(taskId, ivs);
  }
}
