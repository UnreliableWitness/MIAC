import { EventEmitter } from 'node:events';
import { z } from 'zod';
import {
  AGENT_TOOLS,
  clip,
  mergeIntervals,
  periodsOf,
  totalMs,
  unionMs,
  workingMs,
  type AgentTool,
  type Interval,
  type TaskTime,
  type WorkHours,
} from '../../shared/time';
import type { Task } from '../../shared/types';
import { JsonFileStore } from '../usage/JsonFileStore';

const IntervalSchema = z.tuple([z.number(), z.number()]);
const ToolSchema = z.enum(['claude-code', 'copilot-cli', 'opencode']);

const TimeFileSchema = z.object({
  version: z.literal(1),
  active: z.record(z.string(), z.array(IntervalSchema)),
  agent: z.record(
    z.string(),
    z.partialRecord(ToolSchema, z.array(IntervalSchema)),
  ),
  claudeLast: z.record(z.string(), z.number()),
  baselines: z.record(
    z.string(),
    z.object({ hours: z.number(), recordedAt: z.string() }),
  ),
});
type TimeFile = z.infer<typeof TimeFileSchema>;

const empty = (): TimeFile => ({
  version: 1,
  active: {},
  agent: {},
  claudeLast: {},
  baselines: {},
});

/** Measured active and agent intervals per task, and estimate baselines, in one JSON file. */
export class TimeStore extends EventEmitter<{ changed: [taskId: string] }> {
  private readonly store: JsonFileStore<TimeFile>;

  constructor(file: string) {
    super();
    this.store = new JsonFileStore(file, TimeFileSchema, empty);
  }

  load(): Promise<{ recovered: boolean; backup?: string }> {
    return this.store.load();
  }

  async addActive(taskId: string, iv: Interval): Promise<void> {
    await this.store.update((v) => {
      v.active[taskId] = mergeIntervals([...(v.active[taskId] ?? []), iv]);
    });
    this.emit('changed', taskId);
  }

  async addAgent(taskId: string, tool: AgentTool, iv: Interval): Promise<void> {
    await this.store.update((v) => addAgentTo(v, taskId, tool, iv));
    this.emit('changed', taskId);
  }

  async addClaudeActive(p: {
    taskId: string;
    sessionId: string;
    endMs: number;
    value: number;
    cumulative: boolean;
  }): Promise<void> {
    await this.store.update((v) => {
      let seconds = p.value;
      if (p.cumulative) {
        const last = v.claudeLast[p.sessionId];
        v.claudeLast[p.sessionId] = p.value;
        // The first value only sets the reference; a drop is a counter reset.
        seconds =
          last === undefined ? 0 : p.value >= last ? p.value - last : p.value;
      }
      if (seconds > 0)
        addAgentTo(v, p.taskId, 'claude-code', [
          p.endMs - Math.round(seconds * 1000),
          p.endMs,
        ]);
    });
    this.emit('changed', p.taskId);
  }

  async recordBaseline(key: string, hours: number): Promise<void> {
    if (this.store.value.baselines[key]) return;
    await this.store.update((v) => {
      v.baselines[key] ??= { hours, recordedAt: new Date().toISOString() };
    });
  }

  baseline(key: string): number | null {
    return this.store.value.baselines[key]?.hours ?? null;
  }

  activeIntervals(taskId: string): Interval[] {
    return (this.store.value.active[taskId] ?? []).map(([s, e]) => [s, e]);
  }

  agentIntervals(taskId: string): Record<AgentTool, Interval[]> {
    const a = this.store.value.agent[taskId] ?? {};
    return Object.fromEntries(
      AGENT_TOOLS.map((t) => [t, (a[t] ?? []).map(([s, e]) => [s, e])]),
    ) as Record<AgentTool, Interval[]>;
  }

  summarize(
    task: Task,
    hours: WorkHours,
    now: number,
  ): Omit<TaskTime, 'estimate'> {
    const active = this.activeIntervals(task.id);
    const agent = this.agentIntervals(task.id);
    const periods = periodsOf(task, now);
    const lastStart = periods.length ? periods[periods.length - 1][0] : 0;
    const sec = (ms: number) => Math.round(ms / 1000);
    return {
      taskId: task.id,
      activeSeconds: sec(totalMs(active)),
      agentSeconds: Object.fromEntries(
        AGENT_TOOLS.map((t) => [t, sec(totalMs(agent[t]))]),
      ) as Record<AgentTool, number>,
      realisticSeconds: sec(
        unionMs(active, ...AGENT_TOOLS.map((t) => agent[t])),
      ),
      wallClockSeconds: sec(workingMs(periods, hours)),
      measuredSinceReopenSeconds: sec(
        totalMs(clip(active, lastStart, Infinity)),
      ),
      booking: task.time,
    };
  }
}

function addAgentTo(
  v: TimeFile,
  taskId: string,
  tool: AgentTool,
  iv: Interval,
): void {
  const byTool = (v.agent[taskId] ??= {});
  byTool[tool] = mergeIntervals([...(byTool[tool] ?? []), iv]);
}
