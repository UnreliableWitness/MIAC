import { beforeEach, describe, expect, it } from 'vitest';
import {
  readDocState,
  readSendTarget,
  writeDocState,
  writeSendTarget,
} from './docsPrefs';

beforeEach(() => localStorage.clear());
describe('docsPrefs', () => {
  it('defaults and round-trips per task', () => {
    expect(readDocState('t')).toEqual({
      path: null,
      view: 'rendered',
      scroll: 0,
    });
    writeDocState('t', { path: 'a.md', view: 'source', scroll: 120 });
    expect(readDocState('t')).toEqual({
      path: 'a.md',
      view: 'source',
      scroll: 120,
    });
    expect(readDocState('other').path).toBeNull();
  });
  it('ignores garbage', () => {
    localStorage.setItem('shellie.docs.t', '{nope');
    expect(readDocState('t').view).toBe('rendered');
  });
  it('remembers the send target', () => {
    writeSendTarget('t', 'term-1');
    expect(readSendTarget('t')).toBe('term-1');
  });
});
