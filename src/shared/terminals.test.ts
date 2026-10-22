import { describe, expect, it } from 'vitest';
import { setupTabsFrom } from './terminals';
import { AppSettingsSchema, defaultSettings } from './usage';

describe('default terminals', () => {
  it('opens Claude Code and a shell unless changed', () => {
    expect(defaultSettings().defaultTerminals).toEqual({
      claude: true,
      copilot: false,
      opencode: false,
      shell: true,
    });
  });

  it('defaults for settings saved before the choice existed', () => {
    const old: Record<string, unknown> = { ...defaultSettings() };
    delete old.defaultTerminals;
    expect(AppSettingsSchema.parse(old).defaultTerminals).toEqual(
      defaultSettings().defaultTerminals,
    );
  });

  it('fills in a tab that an older settings file does not name', () => {
    const parsed = AppSettingsSchema.parse({
      ...defaultSettings(),
      defaultTerminals: { claude: false, shell: true },
    });
    expect(parsed.defaultTerminals).toEqual({
      claude: false,
      copilot: false,
      opencode: false,
      shell: true,
    });
  });

  it('turns the choice into the task setup flags', () => {
    expect(
      setupTabsFrom({
        claude: false,
        copilot: false,
        opencode: true,
        shell: true,
      }),
    ).toEqual({
      startClaude: false,
      openShell: true,
      openCopilot: false,
      openOpencode: true,
    });
  });
});
