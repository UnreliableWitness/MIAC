import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  currentColorScheme,
  onColorSchemeChange,
  useColorScheme,
} from './colorScheme';
import { setTestColorScheme } from './testColorScheme';

describe('colour scheme', () => {
  it('reads the light-scheme media query', () => {
    expect(currentColorScheme()).toBe('dark');
    setTestColorScheme('light');
    expect(currentColorScheme()).toBe('light');
  });

  it('tells subscribers about a change until they unsubscribe', () => {
    const cb = vi.fn();
    const off = onColorSchemeChange(cb);
    setTestColorScheme('light');
    off();
    setTestColorScheme('dark');
    expect(cb.mock.calls).toEqual([['light']]);
  });

  it('re-renders a component when the OS switches', () => {
    const { result } = renderHook(() => useColorScheme());
    expect(result.current).toBe('dark');
    act(() => setTestColorScheme('light'));
    expect(result.current).toBe('light');
  });
});
