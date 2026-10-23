import { describe, expect, it } from 'vitest';
import { parseAppsettings } from './appsettings';

describe('parseAppsettings', () => {
  it('takes ConnectionStrings and secret-named keys, flattened', () => {
    const text = JSON.stringify({
      Logging: { Level: 'Info' },
      ConnectionStrings: { Db: 'Server=h;Password="p=1";x=$y' },
      Stripe: { ApiKey: 'sk_live_abc', Mode: 'live' },
      Port: 5000,
    });
    expect(parseAppsettings(text, 'api/appsettings.Uat.json', 'uat')).toEqual([
      {
        name: 'ConnectionStrings__Db',
        value: 'Server=h;Password="p=1";x=$y',
        env: 'uat',
        source: 'api/appsettings.Uat.json',
      },
      {
        name: 'Stripe__ApiKey',
        value: 'sk_live_abc',
        env: 'uat',
        source: 'api/appsettings.Uat.json',
      },
    ]);
  });
  it('tolerates comments and bad JSON', () => {
    expect(
      parseAppsettings('{ // c\n "A": {"Token": "t",} }', 'a.json', null)[0]
        ?.name,
    ).toBe('A__Token');
    expect(parseAppsettings('not json', 'a.json', null)).toEqual([]);
  });
});
