import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { trimLocales } from './trimLocales.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An extracted Electron folder with the given files in locales/. */
function build(files: string[] | null): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-locales-'));
  dirs.push(dir);
  if (files) {
    mkdirSync(path.join(dir, 'locales'));
    for (const f of files) writeFileSync(path.join(dir, 'locales', f), 'x');
  }
  return dir;
}
const left = (dir: string) => readdirSync(path.join(dir, 'locales')).sort();

describe('trimLocales', () => {
  it('keeps en-US.pak and nl.pak and removes the other locale packs', () => {
    const dir = build(['de.pak', 'en-GB.pak', 'en-US.pak', 'fr.pak', 'nl.pak']);
    const warnings: string[] = [];
    const r = trimLocales(dir, 'win32', undefined, (w) => warnings.push(w));
    expect(left(dir)).toEqual(['en-US.pak', 'nl.pak']);
    expect(r.removed).toEqual(['de.pak', 'en-GB.pak', 'fr.pak']);
    expect(warnings).toEqual([]);
  });

  it('works the same on linux', () => {
    const dir = build(['de.pak', 'en-US.pak', 'nl.pak']);
    trimLocales(dir, 'linux');
    expect(left(dir)).toEqual(['en-US.pak', 'nl.pak']);
  });

  it('leaves files that are not .pak alone', () => {
    const dir = build([
      'de.pak',
      'en-US.pak',
      'nl.pak',
      'README.txt',
      'x.pak.bak',
    ]);
    trimLocales(dir, 'win32');
    expect(left(dir)).toEqual([
      'README.txt',
      'en-US.pak',
      'nl.pak',
      'x.pak.bak',
    ]);
  });

  it('takes its own keep list', () => {
    const dir = build(['de.pak', 'en-US.pak', 'nl.pak']);
    trimLocales(dir, 'win32', ['de']);
    expect(left(dir)).toEqual(['de.pak']);
  });

  it('does nothing on darwin', () => {
    const dir = build(['de.pak', 'en-US.pak', 'nl.pak']);
    const r = trimLocales(dir, 'darwin');
    expect(left(dir)).toEqual(['de.pak', 'en-US.pak', 'nl.pak']);
    expect(r.removed).toEqual([]);
  });

  it('warns and does not throw when the locales folder is missing', () => {
    const dir = build(null);
    const warnings: string[] = [];
    expect(() =>
      trimLocales(dir, 'win32', undefined, (w) => warnings.push(w)),
    ).not.toThrow();
    expect(warnings.join('\n')).toMatch(/no locales folder/);
  });

  it('warns when a kept locale is missing, and still trims', () => {
    const dir = build(['de.pak', 'en-US.pak']);
    const warnings: string[] = [];
    trimLocales(dir, 'win32', undefined, (w) => warnings.push(w));
    expect(left(dir)).toEqual(['en-US.pak']);
    expect(warnings.join('\n')).toMatch(/nl\.pak/);
  });
});
