import { describe, expect, it } from 'vitest';
import { parseCompose } from './compose';

describe('parseCompose', () => {
  it('reads map and list environment forms and env_file', () => {
    const text = `
services:
  api:
    env_file: ./api.env
    environment:
      DB: "Server=h;Password=a=b#c"
      EMPTY:
      PORT: 80
      REF: \${FROM_HOST}
  web:
    env_file:
      - .env
      - path: web.env
    environment:
      - KEY=v=1
      - NOVALUE
      - Q="quoted"
`;
    const r = parseCompose(text, 'docker-compose.prod.yml');
    expect(r.items).toEqual([
      {
        name: 'DB',
        value: 'Server=h;Password=a=b#c',
        env: 'production',
        source: 'docker-compose.prod.yml',
      },
      {
        name: 'PORT',
        value: '80',
        env: 'production',
        source: 'docker-compose.prod.yml',
      },
      {
        name: 'KEY',
        value: 'v=1',
        env: 'production',
        source: 'docker-compose.prod.yml',
      },
      {
        name: 'Q',
        value: '"quoted"',
        env: 'production',
        source: 'docker-compose.prod.yml',
      },
    ]);
    expect(r.envFiles).toEqual(['./api.env', '.env', 'web.env']);
  });
  it('is quiet about bad YAML', () => {
    expect(parseCompose(': : :\n\t- [', 'c.yml')).toEqual({
      items: [],
      envFiles: [],
    });
  });
});
