import { describe, expect, it } from 'vitest';
import { parseUserSecrets, userSecretsId } from './userSecrets';

describe('userSecretsId', () => {
  it('reads the id from a csproj', () => {
    expect(
      userSecretsId(
        '<Project><PropertyGroup><UserSecretsId> abc-123 </UserSecretsId></PropertyGroup></Project>',
      ),
    ).toBe('abc-123');
    expect(userSecretsId('<Project/>')).toBeNull();
  });
  it('rejects ids that could climb out of the folder', () => {
    expect(userSecretsId('<UserSecretsId>../../x</UserSecretsId>')).toBeNull();
  });
});

describe('parseUserSecrets', () => {
  it('flattens colon keys as Development', () => {
    expect(parseUserSecrets('{"Stripe:Key":"sk","A":{"B":"c"}}')).toEqual([
      {
        name: 'Stripe__Key',
        value: 'sk',
        env: 'development',
        source: 'user secrets',
      },
      { name: 'A__B', value: 'c', env: 'development', source: 'user secrets' },
    ]);
  });
  it('is quiet about bad JSON', () => {
    expect(parseUserSecrets('x')).toEqual([]);
  });
});
