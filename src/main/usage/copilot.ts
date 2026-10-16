import type { Interval } from '../../shared/time';
import type { UsageEvent } from '../../shared/usage';
import { attrMap, int, nanosToIso, safeIso } from './otlp';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
type Attrs = Record<string, unknown>;

const plainAttrs = (v: unknown): Attrs =>
  Array.isArray(v) ? attrMap(v) : isObj(v) ? v : {};
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown): number =>
  int(typeof v === 'number' || typeof v === 'string' ? v : undefined);

function startIso(span: Obj): string {
  if (Array.isArray(span.startTime) && span.startTime.length === 2) {
    const [sec, nanos] = span.startTime.map(Number);
    if (Number.isFinite(sec))
      return safeIso(sec * 1000 + Math.floor((nanos || 0) / 1e6));
  }
  return nanosToIso(span.startTimeUnixNano);
}

function toEvent(span: Obj, taskId: string): UsageEvent | 'unreadable' | null {
  const name = s(span.name);
  const a = plainAttrs(span.attributes);
  const hasUsage =
    a['gen_ai.usage.input_tokens'] !== undefined ||
    a['gen_ai.usage.output_tokens'] !== undefined;
  if (!name.startsWith('chat') || !hasUsage)
    return name.startsWith('chat') && a['gen_ai.operation.name'] === 'chat'
      ? 'unreadable'
      : null;
  const ctx = isObj(span.spanContext) ? span.spanContext : span;
  const traceId = s(ctx.traceId) || s(span.traceId);
  const spanId = s(ctx.spanId) || s(span.spanId);
  const model = s(a['gen_ai.response.model']) || s(a['gen_ai.request.model']);
  if (!traceId || !spanId || !model) return 'unreadable';
  return {
    id: `${traceId}:${spanId}`,
    taskId,
    tool: 'copilot-cli',
    sessionId: traceId,
    model,
    at: startIso(span),
    inputTokens: n(a['gen_ai.usage.input_tokens']),
    outputTokens: n(a['gen_ai.usage.output_tokens']),
    cacheReadTokens: n(a['gen_ai.usage.cache_read.input_tokens']),
    cacheWriteTokens: n(a['gen_ai.usage.cache_creation.input_tokens']),
    fast: false,
  };
}

function spansOf(doc: Obj): unknown[] {
  return Array.isArray(doc.resourceSpans)
    ? doc.resourceSpans.flatMap((rs) =>
        isObj(rs)
          ? arr(rs.scopeSpans).flatMap((ss) => (isObj(ss) ? arr(ss.spans) : []))
          : [],
      )
    : typeof doc.name === 'string'
      ? [doc]
      : [];
}

/** A span time as epoch ms, from `[sec, nanos]` or unix nanos; null when missing. */
function spanMs(pair: unknown, nanos: unknown): number | null {
  if (Array.isArray(pair) && pair.length === 2) {
    const [sec, ns] = pair.map(Number);
    if (Number.isFinite(sec)) return sec * 1000 + Math.floor((ns || 0) / 1e6);
  }
  const v =
    typeof nanos === 'string' || typeof nanos === 'number'
      ? Number(nanos)
      : Number.NaN;
  return v > 0 ? Math.floor(v / 1e6) : null;
}

/** Time spans of agent work (`invoke_agent*`, `chat*`, `execute_tool*`) in one exporter line; spans without a start and an end are skipped. */
export function copilotAgentIntervals(line: string): Interval[] {
  if (!line.trim()) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(doc)) return [];
  const out: Interval[] = [];
  for (const span of spansOf(doc)) {
    if (!isObj(span)) continue;
    const name = s(span.name);
    if (!/^(invoke_agent|chat|execute_tool)/.test(name)) continue;
    const start = spanMs(span.startTime, span.startTimeUnixNano);
    const end = spanMs(span.endTime, span.endTimeUnixNano);
    if (start !== null && end !== null && end >= start) out.push([start, end]);
  }
  return out;
}

/** One line of the Copilot CLI file exporter. The task comes from the file name, not the line. */
export function parseCopilotLine(
  line: string,
  taskId: string,
): { events: UsageEvent[]; unreadable: number } {
  const out = { events: [] as UsageEvent[], unreadable: 0 };
  if (!line.trim()) return out;
  let doc: unknown;
  try {
    doc = JSON.parse(line);
  } catch {
    out.unreadable++;
    return out;
  }
  if (!isObj(doc)) return out;
  for (const span of spansOf(doc)) {
    if (!isObj(span)) continue;
    const e = toEvent(span, taskId);
    if (e === 'unreadable') out.unreadable++;
    else if (e) out.events.push(e);
  }
  return out;
}
