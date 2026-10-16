import fs from 'node:fs/promises';
import path from 'node:path';

export type WriteHit = { path: string; via: 'edit' | 'worktree-add' | 'git' };

const EDIT_TOOLS: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};

const WRITING_GIT = new Set([
  'commit',
  'checkout',
  'switch',
  'add',
  'apply',
  'stash',
  'merge',
  'rebase',
  'cherry-pick',
]);

/** git global options that take a separate value (besides -C, handled on its own). */
const GIT_VALUE_OPTIONS = new Set([
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
]);

/** Splits a command into segments of words at `&&`, `||`, `;` and `|` outside quotes. */
function tokenize(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;

  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (
        c === '\\' &&
        i + 1 < command.length &&
        '"\\$`'.includes(command[i + 1])
      ) {
        word += command[++i];
      } else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < command.length) {
      // On Windows a backslash is usually a path separator, so keep it there.
      if (path.sep === '\\') word += c;
      else word += command[++i];
      inWord = true;
    } else if (c === '&' && command[i + 1] === '&') {
      i++;
      endSegment();
    } else if (c === '|' && command[i + 1] === '|') {
      i++;
      endSegment();
    } else if (c === ';' || c === '|' || c === '\n') {
      endSegment();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  if (quote) return []; // unterminated quote: do not guess
  endSegment();
  return segments;
}

/** `p` resolved against `dir`; a relative path with no known dir is null (never guessed from MIAC's own cwd). */
function resolveIn(dir: string | null, p: string): string | null {
  if (path.isAbsolute(p)) return path.resolve(p);
  return dir === null ? null : path.resolve(dir, p);
}

function gitHit(words: string[], cwd: string | null): WriteHit | null {
  let dir = cwd;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i];
    if (w === '-C') {
      if (i + 1 >= words.length) return null;
      dir = resolveIn(dir, words[i + 1]);
      i += 2;
    } else if (GIT_VALUE_OPTIONS.has(w)) {
      i += 2;
    } else {
      i += 1;
    }
  }
  const sub = words[i];
  if (!sub) return null;
  if (sub === 'worktree') {
    if (words[i + 1] !== 'add') return null;
    for (let j = i + 2; j < words.length; j++) {
      const w = words[j];
      if (w === '-b' || w === '-B') j++;
      else if (!w.startsWith('-')) {
        const p = resolveIn(dir, w);
        return p === null ? null : { path: p, via: 'worktree-add' };
      }
    }
    return null;
  }
  return WRITING_GIT.has(sub) && dir !== null
    ? { path: dir, via: 'git' }
    : null;
}

/** Tokenises one Bash command and returns the writes it makes (worktree add, writing git commands). A null cwd keeps only absolute paths. */
export function writeHitsFromBash(
  command: string,
  cwd: string | null,
): WriteHit[] {
  const hits: WriteHit[] = [];
  let dir = cwd;
  for (const words of tokenize(command)) {
    if (words[0] === 'cd' && words[1] && !words[1].startsWith('-')) {
      dir = resolveIn(dir, words[1]);
    } else if (words[0] === 'git') {
      const hit = gitHit(words, dir);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

/** Parses Claude Code JSONL lines; only assistant tool_use blocks count. */
export function writeHitsFromLines(lines: string[]): WriteHit[] {
  const hits: WriteHit[] = [];
  for (const line of lines) {
    if (!line.includes('"tool_use"')) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content))
      continue;
    const cwd = typeof entry.cwd === 'string' && entry.cwd ? entry.cwd : null;
    for (const block of entry.message.content) {
      if (
        block?.type !== 'tool_use' ||
        typeof block.input !== 'object' ||
        !block.input
      )
        continue;
      const key = EDIT_TOOLS[block.name];
      if (key) {
        const p = block.input[key];
        const resolved = typeof p === 'string' && p ? resolveIn(cwd, p) : null;
        if (resolved) hits.push({ path: resolved, via: 'edit' });
      } else if (
        block.name === 'Bash' &&
        typeof block.input.command === 'string'
      ) {
        hits.push(...writeHitsFromBash(block.input.command, cwd));
      }
    }
  }
  return hits;
}

type ReadChunk = (
  file: string,
  from: number,
) => Promise<{ text: string; size: number } | null>;

/** Reads from `from` to the end, cut after the last newline so no multibyte character is split. */
const readFromDisk: ReadChunk = async (file, from) => {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    if (from >= size) return { text: '', size };
    const buf = Buffer.alloc(size - from);
    const { bytesRead } = await handle.read(buf, 0, buf.length, from);
    const end = buf.subarray(0, bytesRead).lastIndexOf(0x0a);
    return {
      text: end < 0 ? '' : buf.subarray(0, end + 1).toString('utf8'),
      size,
    };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
};

/** Reads only what was appended since the last call per file. */
export class SessionLogReader {
  private state = new Map<string, { offset: number; partial: string }>();

  constructor(private readChunk: ReadChunk = readFromDisk) {}

  async readNew(file: string): Promise<string[]> {
    let st = this.state.get(file) ?? { offset: 0, partial: '' };
    let chunk = await this.readChunk(file, st.offset);
    if (!chunk) return [];
    if (chunk.size < st.offset) {
      st = { offset: 0, partial: '' };
      chunk = await this.readChunk(file, 0);
      if (!chunk) return [];
    }
    const text = st.partial + chunk.text;
    const parts = text.split('\n');
    const partial = parts.pop() ?? '';
    this.state.set(file, {
      offset: st.offset + Buffer.byteLength(chunk.text),
      partial,
    });
    return parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  }
}
