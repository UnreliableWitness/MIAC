import type { Environment } from '../../shared/secrets';

/** Shorter values are not matched: they turn up in ordinary output by chance. */
export const MIN_LEAK_LENGTH = 8;

export type LeakHit = { name: string; env: Environment };
type Value = { name: string; value: string; env: Environment };

const SEVERITY: Record<Environment, number> = {
  development: 0,
  test: 1,
  uat: 2,
  production: 3,
};

/**
 * The value's forms worth looking for: itself, its base64 with padding, and for each of the three byte alignments
 * the base64 characters that only the value's own bits decide (so it is found inside a longer base64 string too),
 * in standard and URL-safe alphabets.
 */
function formsOf(value: string): string[] {
  const bytes = Buffer.from(value, 'utf8');
  const forms = new Set([value, bytes.toString('base64')]);
  for (let k = 0; k < 3; k++) {
    const enc = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
    const core = enc.slice(
      Math.ceil((8 * k) / 6),
      Math.floor((8 * (k + bytes.length)) / 6),
    );
    forms.add(core);
    forms.add(core.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return [...forms].filter((f) => f.length >= MIN_LEAK_LENGTH);
}

type Match = { start: number; end: number; hit: LeakHit };

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;

/**
 * Finds stored values (and their base64) in text with one Aho-Corasick automaton, so a chunk is scanned once
 * whatever the number of values. Holds plaintext: it lives in main, in memory only, and nothing it matched is
 * ever logged or returned; callers get `[NAME]` and the hit's name and environment.
 */
export class LeakMatcher {
  /** Child node per (node, UTF-16 code unit), keyed `node * 65536 + code`. */
  private readonly next = new Map<number, number>();
  private readonly fail: number[] = [0];
  private readonly depth: number[] = [0];
  /** Per node: the hit of the pattern ending exactly there, else null. */
  private readonly term: (LeakHit | null)[] = [null];
  /** Per node: the nearest node down its fail chain (not itself) where a pattern ends, else -1. */
  private readonly dict: number[] = [-1];
  private readonly hasChildren: boolean[] = [false];
  readonly empty: boolean;

  private constructor(patterns: Map<string, LeakHit>) {
    this.empty = patterns.size === 0;
    for (const [p, hit] of patterns) {
      let node = 0;
      for (let i = 0; i < p.length; i++) {
        const key = node * 65536 + p.charCodeAt(i);
        let child = this.next.get(key);
        if (child === undefined) {
          child = this.depth.length;
          this.next.set(key, child);
          this.fail.push(0);
          this.depth.push(this.depth[node]! + 1);
          this.term.push(null);
          this.dict.push(-1);
          this.hasChildren.push(false);
          this.hasChildren[node] = true;
        }
        node = child;
      }
      this.term[node] = hit;
    }
    // Breadth first, so a node's fail target is done before the node.
    const kids: [number, number][][] = this.depth.map(() => []);
    for (const [key, child] of this.next)
      kids[Math.floor(key / 65536)]!.push([key % 65536, child]);
    const queue: number[] = [];
    for (const [, child] of kids[0]!) queue.push(child);
    for (let q = 0; q < queue.length; q++) {
      const node = queue[q]!;
      for (const [code, child] of kids[node]!) {
        let f = this.fail[node]!;
        while (f !== 0 && !this.next.has(f * 65536 + code)) f = this.fail[f]!;
        const target = this.next.get(f * 65536 + code);
        this.fail[child] =
          target !== undefined && target !== child ? target : 0;
        const ft = this.fail[child]!;
        this.dict[child] = this.term[ft] ? ft : this.dict[ft]!;
        queue.push(child);
      }
    }
  }

  /**
   * A matcher of these values (every environment given), skipping values under 8 characters and the `exempt`
   * ones. When two values share a form, the graver environment's hit is reported.
   */
  static from(values: Value[], o: { exempt?: Iterable<string> } = {}) {
    const exempt = new Set(o.exempt ?? []);
    const patterns = new Map<string, LeakHit>();
    for (const v of values) {
      if (v.value.length < MIN_LEAK_LENGTH || exempt.has(v.value)) continue;
      for (const form of formsOf(v.value)) {
        const had = patterns.get(form);
        if (!had || SEVERITY[v.env] > SEVERITY[had.env])
          patterns.set(form, { name: v.name, env: v.env });
      }
    }
    return new LeakMatcher(patterns);
  }

  /** Leftmost-longest matches that do not overlap, and the node the scan ended on. */
  private scan(s: string): { matches: Match[]; node: number } {
    const all: Match[] = [];
    let node = 0;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      let child = this.next.get(node * 65536 + code);
      while (child === undefined && node !== 0) {
        node = this.fail[node]!;
        child = this.next.get(node * 65536 + code);
      }
      node = child ?? 0;
      for (
        let n = this.term[node] ? node : this.dict[node]!;
        n !== -1;
        n = this.dict[n]!
      )
        all.push({
          start: i + 1 - this.depth[n]!,
          end: i + 1,
          hit: this.term[n]!,
        });
    }
    if (all.length > 1) all.sort((a, b) => a.start - b.start || b.end - a.end);
    const matches: Match[] = [];
    let end = 0;
    for (const m of all)
      if (m.start >= end) {
        matches.push(m);
        end = m.end;
      }
    return { matches, node };
  }

  /** The hits in a finished text (a diff's added lines), in order. */
  find(text: string): LeakHit[] {
    if (this.empty) return [];
    return this.scan(text).matches.map((m) => ({ ...m.hit }));
  }

  /**
   * Masks a chunk of a stream: `carry` is what the previous call held back. The end of the chunk that could still
   * become a value with the next chunk is held back as the new carry; `final` (no next chunk) holds nothing.
   */
  mask(
    text: string,
    carry = '',
    final = false,
  ): { text: string; carry: string; hits: LeakHit[] } {
    const s = carry + text;
    if (this.empty || s === '') return { text: s, carry: '', hits: [] };
    const { matches, node } = this.scan(s);
    let cut = s.length;
    if (!final) {
      // The longest end of s that some value can still grow from.
      let n = node;
      while (n !== 0 && !this.hasChildren[n]) n = this.fail[n]!;
      cut = s.length - this.depth[n]!;
      // A match running into the held part is held whole, so it is masked once it is complete.
      for (const m of matches)
        if (m.end > cut) {
          if (m.start < cut) cut = m.start;
          break;
        }
      if (cut > 0 && cut < s.length && isHighSurrogate(s.charCodeAt(cut - 1)))
        cut--;
    }
    let out = '';
    let pos = 0;
    const hits: LeakHit[] = [];
    for (const m of matches) {
      if (m.end > cut) break;
      out += `${s.slice(pos, m.start)}[${m.hit.name}]`;
      pos = m.end;
      hits.push({ ...m.hit });
    }
    out += s.slice(pos, cut);
    return { text: out, carry: s.slice(cut), hits };
  }
}
