import { describe, expect, it } from 'vitest';
import { parseLaunchSettings } from './launchSettings';

const text = `{
  // JSONC
  "profiles": {
    "Prd": { "commandName": "Project", "environmentVariables": { "Db": "a=b", "X": "1" } },
    "https": { "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Staging", "Key": "k" } },
    "Plain": { "environmentVariables": { "Y": "2" } },
    "NoVars": {},
  }
}`;

describe('parseLaunchSettings', () => {
  it('maps a profile by name, else by ASPNETCORE_ENVIRONMENT', () => {
    const r = parseLaunchSettings(text);
    const by = (n: string) => r.find((i) => i.name === n);
    expect(by('Db')).toEqual({
      name: 'Db',
      value: 'a=b',
      env: 'production',
      source: 'launch profile Prd',
    });
    expect(by('Key')).toMatchObject({
      env: 'uat',
      source: 'launch profile https',
    });
    expect(by('Y')).toMatchObject({
      env: null,
      source: 'launch profile Plain',
    });
  });
});
