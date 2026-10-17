import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { holdWatch } from './holdWatch';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('holdWatch', () => {
  it('sends on, reports live, and off on release', async () => {
    const { calls } = installFakeApi({
      'review:watch': () => ({ live: true }),
    });
    const lives: boolean[] = [];
    const release = holdWatch('review:watch', 't1#w2', (l) => lives.push(l));
    await flush();
    release();
    await flush();
    expect(
      calls.filter((c) => c.channel === 'review:watch').map((c) => c.args),
    ).toEqual([
      ['t1#w2', true],
      ['t1#w2', false],
    ]);
    expect(lives).toEqual([true]);
  });

  it('sends no off for a watcher main already stopped', async () => {
    const { calls, emit } = installFakeApi({
      'review:watch': () => ({ live: true }),
    });
    const lives: boolean[] = [];
    const release = holdWatch('review:watch', 't1', (l) => lives.push(l));
    await flush();
    emit('docs:watchStopped', { taskId: 't1' });
    release();
    await flush();
    expect(calls.filter((c) => c.channel === 'review:watch')).toHaveLength(1);
    expect(lives).toEqual([true, false]);
  });

  it('reports not live when main refuses the hold, and sends no off', async () => {
    const { calls } = installFakeApi({
      'review:watch': () => {
        throw new Error('no watcher');
      },
    });
    const lives: boolean[] = [];
    const release = holdWatch('review:watch', 't1', (l) => lives.push(l));
    await flush();
    release();
    await flush();
    expect(lives).toEqual([false]);
    expect(calls.filter((c) => c.channel === 'review:watch')).toHaveLength(1);
  });
});
