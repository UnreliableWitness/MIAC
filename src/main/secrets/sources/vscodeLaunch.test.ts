import { describe, expect, it } from 'vitest';
import { parseVscodeLaunch } from './vscodeLaunch';

describe('parseVscodeLaunch', () => {
  it('reads env and envFile of each configuration (JSONC)', () => {
    const text = `{
  // comment
  "version": "0.2.0",
  "configurations": [
    { "name": "Run Prod", "env": { "A": "a=b", "N": 5 }, "envFile": "\${workspaceFolder}/.env.local", },
    { "name": "Other", "env": { "B": "b" } }
  ]
}`;
    const r = parseVscodeLaunch(text, '.vscode/launch.json');
    expect(r.items).toEqual([
      {
        name: 'A',
        value: 'a=b',
        env: 'production',
        source: '.vscode/launch.json',
      },
      { name: 'B', value: 'b', env: null, source: '.vscode/launch.json' },
    ]);
    expect(r.envFiles).toEqual(['.env.local']);
  });
});
