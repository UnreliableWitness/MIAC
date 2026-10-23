import { describe, expect, it } from 'vitest';
import { parseSecretsFile } from './secretsFolder';

describe('parseSecretsFile', () => {
  it('reads JSON', () => {
    expect(
      parseSecretsFile(
        '{"key":"sk_live_x","n":{"a":"b"}}',
        'secrets/stripe.json',
      ),
    ).toEqual([
      {
        name: 'key',
        value: 'sk_live_x',
        env: null,
        source: 'secrets/stripe.json',
      },
      { name: 'n__a', value: 'b', env: null, source: 'secrets/stripe.json' },
    ]);
  });
  it('reads KEY=VALUE and takes the environment from the file name', () => {
    expect(parseSecretsFile('A=1\nB="x y"', 'secrets/prod.secrets')).toEqual([
      {
        name: 'A',
        value: '1',
        env: 'production',
        source: 'secrets/prod.secrets',
      },
      {
        name: 'B',
        value: 'x y',
        env: 'production',
        source: 'secrets/prod.secrets',
      },
    ]);
  });
});
