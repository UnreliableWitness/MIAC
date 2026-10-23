import { describe, expect, it } from 'vitest';
import { parseDotenv } from './dotenv';

const parse = (t: string) =>
  Object.fromEntries(
    parseDotenv(t, '.env', 'development').map((i) => [i.name, i.value]),
  );

describe('parseDotenv', () => {
  it('reads plain, export, spaces and comments', () => {
    expect(
      parse(
        '# c\nA=1\nexport B = two words # trailing\n\nC=\nnoequals\n  D=x#y\n',
      ),
    ).toEqual({ A: '1', B: 'two words', C: '', D: 'x#y' });
  });

  it('keeps =, #, $ and quotes in values unchanged', () => {
    expect(
      parse(
        [
          'CS=Server=h;Password=p#1;Key=a=b==',
          `S='it is "x" # $HOME \\n'`,
          'D="a=b # $HOME \\"q\\" end" # comment',
          'B=`back tick $x`',
        ].join('\n'),
      ),
    ).toEqual({
      CS: 'Server=h;Password=p#1;Key=a=b==',
      S: 'it is "x" # $HOME \\n',
      D: 'a=b # $HOME "q" end',
      B: 'back tick $x',
    });
  });

  it('reads a multi-line PEM in double and single quotes', () => {
    const pem =
      '-----BEGIN PRIVATE KEY-----\nMIIE=\nabc+/==\n-----END PRIVATE KEY-----';
    const r = parse(`A="${pem}"\nB='${pem}'\nC=after`);
    expect(r.A).toBe(pem);
    expect(r.B).toBe(pem);
    expect(r.C).toBe('after');
  });

  it('expands \\n only in double quotes', () => {
    expect(parse('A="l1\\nl2"')).toEqual({ A: 'l1\nl2' });
  });

  it('carries the source and environment', () => {
    expect(parseDotenv('A=1', 'api/.env.uat', 'uat')).toEqual([
      { name: 'A', value: '1', env: 'uat', source: 'api/.env.uat' },
    ]);
  });

  it('copes with CRLF', () => {
    expect(parse('A=1\r\nB="x"\r\n')).toEqual({ A: '1', B: 'x' });
  });
});
