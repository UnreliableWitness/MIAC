import { describe, expect, it, vi } from 'vitest';
import type { Environment } from '../../shared/secrets';
import {
  EXPIRY_CHECK_MS,
  type ExpiryTimers,
  expiredTasks,
  scheduleExpiry,
} from './expiry';

const T0 = Date.parse('2026-10-23T10:00:00Z');
const task = (id: string, environment: Environment, until: string | null) => ({
  id,
  environment,
  environmentUntil: until,
});

/** Timers the test drives by hand: the interval and the resume listener are kept, nothing runs by itself. */
function fakeTimers() {
  const intervals: { fn: () => void; ms: number }[] = [];
  const resumes: (() => void)[] = [];
  const stopped = { interval: 0, resume: 0 };
  const timers: ExpiryTimers = {
    every: (fn, ms) => {
      intervals.push({ fn, ms });
      return () => stopped.interval++;
    },
    onResume: (fn) => {
      resumes.push(fn);
      return () => stopped.resume++;
    },
  };
  return { timers, intervals, resumes, stopped };
}

describe('expiredTasks', () => {
  it('finds Production tasks at or past their bound only', () => {
    const at = new Date(T0).toISOString();
    expect(
      expiredTasks(
        [
          task('due', 'production', at),
          task('past', 'production', new Date(T0 - 1).toISOString()),
          task('later', 'production', new Date(T0 + 1).toISOString()),
          task('uat', 'uat', at),
          task('dev', 'development', at),
          task('unbounded', 'production', null),
        ],
        T0,
      ),
    ).toEqual(['due', 'past']);
  });
});

describe('scheduleExpiry', () => {
  it('checks at once, every 30 s and on resume', async () => {
    let now = T0;
    const until = new Date(T0 + 60 * 60_000).toISOString();
    const tasks = [task('t1', 'production', until)];
    const onExpire = vi.fn(async (id: string) => {
      tasks.splice(
        tasks.findIndex((t) => t.id === id),
        1,
        task(id, 'development', null),
      );
    });
    const f = fakeTimers();
    scheduleExpiry(
      () => tasks,
      () => now,
      onExpire,
      f.timers,
    );
    expect(f.intervals).toHaveLength(1);
    expect(f.intervals[0]!.ms).toBe(EXPIRY_CHECK_MS);
    expect(EXPIRY_CHECK_MS).toBe(30_000);
    expect(onExpire).not.toHaveBeenCalled();

    now = T0 + 60 * 60_000 - 1;
    f.intervals[0]!.fn();
    expect(onExpire).not.toHaveBeenCalled();

    // The machine slept past the bound: the resume check catches it before the next tick.
    now = T0 + 2 * 60 * 60_000;
    f.resumes[0]!();
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalledWith('t1'));
    f.intervals[0]!.fn();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('expires a task already past its bound when it starts (after a relaunch)', () => {
    const onExpire = vi.fn();
    scheduleExpiry(
      () => [task('t1', 'production', new Date(T0 - 1000).toISOString())],
      () => T0,
      onExpire,
      fakeTimers().timers,
    );
    expect(onExpire).toHaveBeenCalledWith('t1');
  });

  it('does not expire a task again while its expiry still runs, and retries after a failure', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let finish: (() => void) | undefined;
    let fail = true;
    const onExpire = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () => (fail ? reject(new Error('busy')) : resolve());
        }),
    );
    const f = fakeTimers();
    scheduleExpiry(
      () => [task('t1', 'production', new Date(T0 - 1).toISOString())],
      () => T0,
      onExpire,
      f.timers,
    );
    f.intervals[0]!.fn();
    expect(onExpire).toHaveBeenCalledTimes(1);
    finish!();
    await vi.waitFor(() => {
      f.intervals[0]!.fn();
      expect(onExpire).toHaveBeenCalledTimes(2);
    });
    expect(logged).toHaveBeenCalledWith(
      '[secrets] could not end Production',
      expect.any(Error),
    );
    logged.mockRestore();
    fail = false;
    finish!();
  });

  it('stops listening when stopped', () => {
    const f = fakeTimers();
    const stop = scheduleExpiry(
      () => [],
      () => T0,
      vi.fn(),
      f.timers,
    );
    stop();
    expect(f.stopped).toEqual({ interval: 1, resume: 1 });
  });
});
