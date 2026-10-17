// src/shared/editors.test.ts
import { describe, expect, it } from 'vitest';
import { pickEditor } from './editors';
import { AppSettingsSchema, defaultSettings } from './usage';

describe('pickEditor', () => {
  const both = ['vscode', 'visualstudio'] as const;
  it('takes the repo choice, then the global default, when installed', () => {
    expect(
      pickEditor(
        [...both],
        { repo: 'visualstudio', global: 'vscode' },
        { dotnet: false },
      ),
    ).toBe('visualstudio');
    expect(
      pickEditor(
        [...both],
        { repo: null, global: 'visualstudio' },
        { dotnet: false },
      ),
    ).toBe('visualstudio');
  });
  it('skips a choice that is not installed', () => {
    expect(
      pickEditor(
        ['vscode'],
        { repo: 'visualstudio', global: null },
        { dotnet: true },
      ),
    ).toBe('vscode');
  });
  it('suggests Visual Studio for a .NET repo, else VS Code', () => {
    expect(
      pickEditor([...both], { repo: null, global: null }, { dotnet: true }),
    ).toBe('visualstudio');
    expect(
      pickEditor([...both], { repo: null, global: null }, { dotnet: false }),
    ).toBe('vscode');
  });
  it('is null when nothing is installed', () => {
    expect(
      pickEditor([], { repo: 'vscode', global: 'vscode' }, { dotnet: false }),
    ).toBeNull();
  });
});

describe('editor settings', () => {
  it('defaults for settings saved before editors existed', () => {
    const old: Record<string, unknown> = { ...defaultSettings() };
    delete old.editor;
    expect(AppSettingsSchema.parse(old).editor).toEqual({
      default: null,
      repos: {},
    });
  });
});
