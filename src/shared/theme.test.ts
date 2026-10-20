import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, defaultSettings } from './usage';
import { schemeOf } from './theme';

describe('theme setting', () => {
  it('defaults to following the system', () => {
    expect(defaultSettings().theme).toBe('system');
  });

  it('fills in system for a settings file written before themes existed', () => {
    const old = { version: 1, receiverPort: 4319, hourlySync: true };
    expect(AppSettingsSchema.parse(old).theme).toBe('system');
  });

  it.each(['system', 'light', 'dark'] as const)('keeps %s', (theme) => {
    expect(AppSettingsSchema.parse({ ...defaultSettings(), theme }).theme).toBe(
      theme,
    );
  });

  it('rejects an unknown theme', () => {
    expect(() =>
      AppSettingsSchema.parse({ ...defaultSettings(), theme: 'sepia' }),
    ).toThrow();
  });
});

describe('schemeOf', () => {
  it('maps nativeTheme.shouldUseDarkColors to a scheme', () => {
    expect(schemeOf(true)).toBe('dark');
    expect(schemeOf(false)).toBe('light');
  });
});
