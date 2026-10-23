import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeThemeFor,
  claudeSettingsFile,
  claudeThemeSettingsFile,
  colorFgBg,
  fixedScheme,
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

describe('fixedScheme', () => {
  it('names the scheme of a -daltonized or -ansi variant, nothing for auto or a theme left alone', () => {
    expect(fixedScheme('light-daltonized')).toBe('light');
    expect(fixedScheme('dark-ansi')).toBe('dark');
    expect(fixedScheme('auto')).toBeNull();
    expect(fixedScheme(null)).toBeNull();
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

describe('claudeSettingsFile', () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), 'shellie-csf-'));

  it('is the theme file itself when nothing is denied', () => {
    const d = dir();
    expect(claudeSettingsFile(d, { theme: 'auto', deny: [] })).toBe(
      claudeThemeSettingsFile(d, 'auto'),
    );
    expect(
      readFileSync(claudeSettingsFile(d, { theme: 'auto' })!, 'utf8'),
    ).toBe('{"theme":"auto"}\n');
  });

  it('adds permissions.deny next to the theme, in a file of its own', () => {
    const d = dir();
    const p = claudeSettingsFile(d, { theme: 'auto', deny: ['Read(./.env)'] })!;
    expect(p).not.toBe(claudeThemeSettingsFile(d, 'auto'));
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({
      theme: 'auto',
      permissions: { deny: ['Read(./.env)'] },
    });
    // Same rules, same file; other rules, another file.
    expect(
      claudeSettingsFile(d, { theme: 'auto', deny: ['Read(./.env)'] }),
    ).toBe(p);
    expect(
      claudeSettingsFile(d, { theme: 'auto', deny: ['Read(./x)'] }),
    ).not.toBe(p);
  });

  it('writes only the deny rules for a custom theme, and nothing when both are absent', () => {
    const d = dir();
    const p = claudeSettingsFile(d, { theme: null, deny: ['Read(./.env)'] })!;
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({
      permissions: { deny: ['Read(./.env)'] },
    });
    expect(claudeSettingsFile(d, { theme: null, deny: [] })).toBeNull();
  });
});

describe('colorFgBg', () => {
  it('says dark text on a light ground in light, the other way round in dark', () => {
    expect(colorFgBg('light')).toBe('0;15');
    expect(colorFgBg('dark')).toBe('15;0');
  });
});
