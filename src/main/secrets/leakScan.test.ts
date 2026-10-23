import { describe, expect, it } from 'vitest';
import { parseAddedLines } from './leakScan';

describe('parseAddedLines', () => {
  it('collects added lines per new path, never removed lines or headers', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,0 +2,2 @@',
      '+const key = "added-one";',
      '++++ an added line that starts with pluses',
      '@@ -9 +10,0 @@',
      '-const old = "removed";',
      'diff --git a/old name.txt b/new name.txt',
      'similarity index 90%',
      'rename from old name.txt',
      'rename to new name.txt',
      '--- a/old name.txt',
      '+++ b/new name.txt',
      '@@ -1 +1 @@',
      '-before',
      '+after',
      '\\ No newline at end of file',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git "a/tab\\there.txt" "b/tab\\there.txt"',
      '--- "a/tab\\there.txt"',
      '+++ "b/tab\\there.txt"',
      '@@ -0,0 +1 @@',
      '+quoted',
      '',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual(
      new Map([
        [
          'src/app.ts',
          'const key = "added-one";\n+++ an added line that starts with pluses\n',
        ],
        ['new name.txt', 'after\n'],
        ['tab\there.txt', 'quoted\n'],
      ]),
    );
  });
});
