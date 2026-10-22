import { describe, expect, it } from 'vitest';
import type { TerminalKind } from '../../shared/terminalFailure';
import type { Telemetry } from '../telemetry/AppInsightsClient';
import { TerminalFailures } from './TerminalFailures';

const recorder = () => {
  const events: { name: string; props?: unknown; m?: unknown }[] = [];
  const exceptions: { error: unknown; props?: unknown }[] = [];
  const telemetry = {
    event: (name: string, props?: unknown, m?: unknown) =>
      events.push({ name, props, m }),
    exception: (error: unknown, props?: unknown) =>
      exceptions.push({ error, props }),
  } as unknown as Telemetry;
  return { events, exceptions, telemetry };
};

const setup = (o: { kind?: TerminalKind; output: string; runMs: number }) => {
  const r = recorder();
  const failures = new TerminalFailures({
    buffer: () => o.output,
    runMs: () => o.runMs,
    kindOf: () => o.kind ?? 'opencode',
    telemetry: r.telemetry,
  });
  return { ...r, failures };
};

describe('TerminalFailures', () => {
  it('diagnoses an early agent exit, keeps it for the tab and sends terminal.failed without the output (#109)', () => {
    const { failures, events } = setup({
      output:
        'Configuration is invalid at /Users/dries/repo/.opencode/agents/a.md\n↳ Expected object, got "Read" tools\n',
      runMs: 900,
    });
    const f = failures.exit('t1', 1);
    expect(f?.reason).toBe('invalid-config');
    expect(failures.get('t1')).toEqual(f);
    expect(events).toEqual([
      {
        name: 'terminal.failed',
        props: { kind: 'opencode', reason: 'invalid-config', exitCode: '1' },
        m: { runMs: 900 },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/agents|Read|dries/);
  });

  it('sends nothing for a normal exit and forgets an earlier failure on clear', () => {
    const { failures, events } = setup({ output: 'bye', runMs: 60_000 });
    expect(failures.exit('t1', 0)).toBeNull();
    expect(events).toEqual([]);
    const bad = setup({ output: 'boom', runMs: 10 });
    bad.failures.exit('t1', 2);
    expect(bad.failures.get('t1')).not.toBeNull();
    bad.failures.clear('t1');
    expect(bad.failures.get('t1')).toBeNull();
  });

  it('reports an early non-zero exit of a shell tab as terminal.exitedEarly, without a failure for the view', () => {
    const { failures, events } = setup({
      kind: 'shell',
      output: 'x',
      runMs: 50,
    });
    expect(failures.exit('t1', 1)).toBeNull();
    expect(events).toEqual([
      {
        name: 'terminal.exitedEarly',
        props: { kind: 'shell', exitCode: '1' },
        m: { runMs: 50 },
      },
    ]);
  });

  it('records a spawn failure as an exception and a failure for the tab', () => {
    const { failures, exceptions, events } = setup({ output: '', runMs: 0 });
    const error = new Error('posix_spawnp failed.');
    const f = failures.spawnFailed('t1', 'claude', error);
    expect(f).toMatchObject({
      reason: 'spawn-failed',
      detail: 'posix_spawnp failed.',
    });
    expect(failures.get('t1')).toEqual(f);
    expect(exceptions).toEqual([
      { error, props: { source: 'terminal', kind: 'claude' } },
    ]);
    expect(events[0]).toMatchObject({
      name: 'terminal.failed',
      props: { kind: 'claude', reason: 'spawn-failed' },
    });
  });

  it('ignores the exit of a terminal no task lists', () => {
    const r = recorder();
    const failures = new TerminalFailures({
      buffer: () => '',
      runMs: () => 1,
      kindOf: () => undefined,
      telemetry: r.telemetry,
    });
    expect(failures.exit('t1', 1)).toBeNull();
    expect(r.events).toEqual([]);
  });
});
