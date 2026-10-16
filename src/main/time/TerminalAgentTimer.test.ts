import { describe, expect, it } from 'vitest';
import type { Interval } from '../../shared/time';
import { TerminalAgentTimer } from './TerminalAgentTimer';

function setup() {
  let now = 0;
  const got: [string, Interval][] = [];
  const timer = new TerminalAgentTimer({
    now: () => now,
    watch: (id) => (id === 'oc' ? { taskId: 'task-1' } : null),
    onInterval: (t, iv) => got.push([t, iv]),
  });
  const at = (ms: number) => {
    now = ms;
  };
  return { timer, got, at };
}

describe('TerminalAgentTimer', () => {
  it('counts output after Enter until a gap of more than 30 s', () => {
    const { timer, got, at } = setup();
    at(0);
    timer.input('oc', '\r');
    for (const ms of [1000, 5000, 20000]) {
      at(ms);
      timer.output('oc');
    }
    at(40000);
    timer.tick();
    expect(got).toEqual([]);
    at(60000);
    timer.tick();
    expect(got).toEqual([['task-1', [1000, 20000]]]);
  });
  it('ignores output without an earlier Enter and unwatched terminals', () => {
    const { timer, got, at } = setup();
    at(1000);
    timer.output('oc');
    timer.input('sh', '\r');
    timer.output('sh');
    at(100000);
    timer.tick();
    timer.close('oc');
    expect(got).toEqual([]);
  });
  it('emits the open interval on close', () => {
    const { timer, got, at } = setup();
    timer.input('oc', 'ls\r');
    at(2000);
    timer.output('oc');
    at(9000);
    timer.output('oc');
    timer.close('oc');
    expect(got).toEqual([['task-1', [2000, 9000]]]);
  });
  it('needs a new Enter after a gap closed the interval', () => {
    const { timer, got, at } = setup();
    timer.input('oc', '\r');
    at(1000);
    timer.output('oc');
    at(50000);
    timer.output('oc');
    at(51000);
    timer.output('oc');
    timer.close('oc');
    expect(got).toEqual([['task-1', [1000, 1000]]]);
    timer.input('oc', '\r');
    at(52000);
    timer.output('oc');
    at(53000);
    timer.output('oc');
    timer.close('oc');
    expect(got).toEqual([
      ['task-1', [1000, 1000]],
      ['task-1', [52000, 53000]],
    ]);
  });
});
