import { describe, expect, it } from 'vitest';
import {
  environmentOf,
  flattenJson,
  looksSecret,
  parseJsonc,
} from './classify';

describe('environmentOf', () => {
  it.each([
    ['dev', 'development'],
    ['Development', 'development'],
    ['local', 'development'],
    ['.env.local', 'development'],
    ['test', 'test'],
    ['tst', 'test'],
    ['QA', 'test'],
    ['uat', 'uat'],
    ['acc', 'uat'],
    ['Acceptance', 'uat'],
    ['staging', 'uat'],
    ['stg', 'uat'],
    ['prod', 'production'],
    ['PRD', 'production'],
    ['production', 'production'],
    ['live', 'production'],
    ['.env.production.local', 'production'],
    ['appsettings.Uat.json', 'uat'],
    ['docker-compose.prod.yml', 'production'],
    ['Prd', 'production'],
  ])('%s -> %s', (label, env) => {
    expect(environmentOf(label)).toBe(env);
  });

  it.each([
    '',
    '.env',
    'appsettings.json',
    'https',
    'IIS Express',
    'contest',
    'product',
  ])('leaves %j unassigned', (label) => {
    expect(environmentOf(label)).toBeNull();
  });
});

describe('looksSecret', () => {
  it.each([
    ['STRIPE_KEY', 'x'],
    ['Api_Token', 'x'],
    ['DB_PASSWORD', 'x'],
    ['DB_PWD', 'x'],
    ['ConnectionStrings__Db', 'x'],
    ['AZURE_CREDENTIAL', 'x'],
    ['SENTRY_DSN', 'x'],
    ['APP_SECRET', 'x'],
    ['A', 'sk_live_abc123'],
    ['A', 'sk_test_abc123'],
    ['A', 'ghp_abcdefghijkl'],
    ['A', 'npm_abcdefghijkl'],
    ['A', 'xoxb-123-456'],
    ['A', 'xoxp-123-456'],
    ['A', 'AKIAIOSFODNN7EXAMPLE'],
    [
      'A',
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    ],
    ['A', '-----BEGIN PRIVATE KEY-----\nabc'],
    ['A', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij'],
    ['A', 'postgres://u:p@h/db'],
    ['A', 'Endpoint=sb://x;SharedAccessKey=abc='],
    ['A', 'DefaultEndpointsProtocol=https;AccountKey=abc=='],
  ])('%s=%s is a secret', (name, value) => {
    expect(looksSecret(name, value)).toBe(true);
  });

  it.each([
    ['PORT', '5173'],
    ['NODE_ENV', 'development'],
    ['URL', 'https://example.com/path'],
    ['MONKEY', 'banana'],
  ])('%s=%s is a plain setting', (name, value) => {
    // MONKEY contains KEY as a substring; the spec says "contains", so it counts. Only the others are plain.
    expect(looksSecret(name, value)).toBe(name === 'MONKEY');
  });
});

describe('flattenJson', () => {
  it('nests with __ and turns : into __', () => {
    expect(
      flattenJson(
        {
          ConnectionStrings: { Db: 'a=b;c' },
          'Stripe:Key': 'k',
          List: ['x', { y: 'z' }],
          n: 5,
          ok: true,
          nothing: null,
        },
        '',
      ),
    ).toEqual([
      ['ConnectionStrings__Db', 'a=b;c'],
      ['Stripe__Key', 'k'],
      ['List__0', 'x'],
      ['List__1__y', 'z'],
      ['n', '5'],
      ['ok', 'true'],
    ]);
  });
  it('applies a prefix', () => {
    expect(flattenJson({ a: '1' }, 'P')).toEqual([['P__a', '1']]);
  });
});

describe('parseJsonc', () => {
  it('handles comments and trailing commas but leaves strings alone', () => {
    const text = `{
  // line
  "a": "http://x/*not a comment*/,",
  /* block */ "b": [1, 2,],
  "c": {"d": "e",},
}`;
    expect(parseJsonc(text)).toEqual({
      a: 'http://x/*not a comment*/,',
      b: [1, 2],
      c: { d: 'e' },
    });
  });
  it('strips a BOM', () => {
    expect(parseJsonc('﻿{"a":1}')).toEqual({ a: 1 });
  });
});
