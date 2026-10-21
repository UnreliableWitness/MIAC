import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeThemeFor,
  claudeThemeSettingsFile,
  colorFgBg,
  readClaudeTheme,
} from './claudeTheme';

describe('claudeThemeFor', () => {
  it('lets Claude Code follow the terminal for its plain themes and none set', () => {
    for (const t of [undefined, 'dark', 'light', 'auto', 42])
      expect(claudeThemeFor(t, 'light')).toBe('auto');
  });

  it('keeps a colour-blind or ANSI-only choice, in the variant for the scheme on screen', () => {
    expect(claudeThemeFor('dark-daltonized', 'light')).toBe('light-daltonized');
    expect(claudeThemeFor('light-daltonized', 'dark')).toBe('dark-daltonized');
    expect(claudeThemeFor('dark-ansi', 'light')).toBe('light-ansi');
    expect(claudeThemeFor('light-ansi', 'light')).toBe('light-ansi');
  });

  it('leaves a custom theme alone', () => {
    expect(claudeThemeFor('custom:solar', 'light')).toBeNull();
  });
});

describe('readClaudeTheme', () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), 'shellie-ctheme-'));

  it('reads the theme from settings.json in the config dir', () => {
    const d = dir();
    writeFileSync(path.join(d, 'settings.json'), '{"theme":"dark-ansi"}');
    expect(readClaudeTheme({ CLAUDE_CONFIG_DIR: d })).toBe('dark-ansi');
  });

  it('falls back to the older global config, and to nothing', () => {
    const d = dir();
    expect(readClaudeTheme({ CLAUDE_CONFIG_DIR: d })).toBeUndefined();
    writeFileSync(path.join(d, '.claude.json'), '{"theme":"light"}');
    expect(readClaudeTheme({ CLAUDE_CONFIG_DIR: d })).toBe('light');
    writeFileSync(path.join(d, 'settings.json'), 'not json');
    expect(readClaudeTheme({ CLAUDE_CONFIG_DIR: d })).toBe('light');
  });
});

describe('claudeThemeSettingsFile', () => {
  it('writes a settings file with only the theme and returns its path', () => {
    const d = path.join(
      mkdtempSync(path.join(os.tmpdir(), 'shellie-ctheme-')),
      'claude',
    );
    const p = claudeThemeSettingsFile(d, 'auto');
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ theme: 'auto' });
    expect(claudeThemeSettingsFile(d, 'auto')).toBe(p);
    const q = claudeThemeSettingsFile(d, 'light-ansi');
    expect(q).not.toBe(p);
    expect(JSON.parse(readFileSync(q, 'utf8'))).toEqual({
      theme: 'light-ansi',
    });
  });

  it('rewrites a file that was changed', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'shellie-ctheme-'));
    mkdirSync(d, { recursive: true });
    const p = claudeThemeSettingsFile(d, 'auto');
    writeFileSync(p, '{}');
    claudeThemeSettingsFile(d, 'auto');
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ theme: 'auto' });
  });
});

describe('colorFgBg', () => {
  it('says dark text on a light ground in light, the other way round in dark', () => {
    expect(colorFgBg('light')).toBe('0;15');
    expect(colorFgBg('dark')).toBe('15;0');
  });
});
