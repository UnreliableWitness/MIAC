import { describe, expect, it } from 'vitest';
import { parseLocalSettings } from './localSettings';

describe('parseLocalSettings', () => {
  it('reads Values and ConnectionStrings as Development', () => {
    const text = JSON.stringify({
      IsEncrypted: false,
      Values: { AzureWebJobsStorage: 'UseDevelopmentStorage=true', K: 'a=b' },
      ConnectionStrings: { Sql: 'Server=h;Password=p' },
    });
    expect(parseLocalSettings(text, 'fn/local.settings.json')).toEqual([
      {
        name: 'AzureWebJobsStorage',
        value: 'UseDevelopmentStorage=true',
        env: 'development',
        source: 'fn/local.settings.json',
      },
      {
        name: 'K',
        value: 'a=b',
        env: 'development',
        source: 'fn/local.settings.json',
      },
      {
        name: 'ConnectionStrings__Sql',
        value: 'Server=h;Password=p',
        env: 'development',
        source: 'fn/local.settings.json',
      },
    ]);
  });
});
