import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../shared/usage';
import {
  afterStep,
  firstScreen,
  nextStep,
  onboardingSteps,
} from './onboardingState';

const onboarding = (
  o: Partial<ReturnType<typeof defaultSettings>['onboarding']> = {},
) => ({
  onboarding: { dismissedAt: null, agentsCheckedAt: null, tracker: null, ...o },
});
const connection = { id: 'c1' };
const repo = { id: 'r1' };

describe('onboardingSteps', () => {
  it('a fresh install has every step to do, Agents first', () => {
    expect(
      onboardingSteps({ settings: onboarding(), connections: [], repos: [] }),
    ).toEqual({
      agents: 'todo',
      connect: 'todo',
      repository: 'todo',
      current: 'agents',
    });
  });

  it('agents checked and no tracker chosen: Repository is next', () => {
    expect(
      onboardingSteps({
        settings: onboarding({ agentsCheckedAt: 'x', tracker: 'none' }),
        connections: [],
        repos: [],
      }),
    ).toEqual({
      agents: 'done',
      connect: 'done',
      repository: 'todo',
      current: 'repository',
    });
  });

  it('a connection counts as connected; everything done leaves no current step', () => {
    expect(
      onboardingSteps({
        settings: onboarding({ agentsCheckedAt: 'x' }),
        connections: [connection],
        repos: [repo],
      }),
    ).toEqual({
      agents: 'done',
      connect: 'done',
      repository: 'done',
      current: null,
    });
  });
});

describe('firstScreen', () => {
  it('opens Get started without a repository until it is dismissed', () => {
    expect(firstScreen({ settings: onboarding(), repos: [] })).toBe(
      'get-started',
    );
    expect(
      firstScreen({ settings: onboarding({ dismissedAt: 'x' }), repos: [] }),
    ).toBe('home');
    expect(firstScreen({ settings: onboarding(), repos: [repo] })).toBe('home');
  });
});

describe('after a step page', () => {
  const steps = (o: Parameters<typeof onboarding>[0], c = 0, r = 0) =>
    onboardingSteps({
      settings: onboarding(o),
      connections: Array(c).fill(connection),
      repos: Array(r).fill(repo),
    });

  it('Continue goes to the next unfinished step page, else Home', () => {
    expect(nextStep(steps({ agentsCheckedAt: 'x' }), 'agents')).toEqual({
      kind: 'connect',
      from: 'get-started',
    });
    expect(nextStep(steps({ agentsCheckedAt: 'x' }, 1), 'agents')).toEqual({
      kind: 'add-repo',
      from: 'get-started',
    });
    expect(nextStep(steps({ agentsCheckedAt: 'x' }, 1, 1), 'agents')).toEqual({
      kind: 'home',
    });
  });

  it('Continue never returns to the step just left, even before its save lands', () => {
    expect(nextStep(steps({}), 'agents')).toEqual({
      kind: 'connect',
      from: 'get-started',
    });
  });

  it('a finished step returns to Get started while steps are left, else Home', () => {
    expect(afterStep(steps({}, 1))).toEqual({ kind: 'get-started' });
    expect(afterStep(steps({ agentsCheckedAt: 'x' }, 1, 1))).toEqual({
      kind: 'home',
    });
  });
});
