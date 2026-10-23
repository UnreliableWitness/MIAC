export const ENVIRONMENTS = [
  'development',
  'test',
  'uat',
  'production',
] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  development: 'Development',
  test: 'Test',
  uat: 'UAT',
  production: 'Production',
};

/** Which tabs get a secret: Setup, dev server/run tabs, test runs, the user's shell tab. Agent tabs never do. */
export type GivenTo = 'setup' | 'run' | 'tests' | 'shell';

export type SecretScope = { repoId: string } | 'all';

/** The mask of a stored value that cannot be decrypted. */
export const UNREADABLE_MASK = '⚠ unreadable';

/** What the renderer sees: masks only. */
export type SecretView = {
  id: string;
  scope: SecretScope;
  name: string;
  givenTo: GivenTo[];
  values: Partial<
    Record<
      Environment,
      { mask: string; source: string | null; changedAt: string }
    >
  >;
};

export type SecretInput = {
  id?: string;
  scope: SecretScope;
  name: string;
  givenTo: GivenTo[];
  /** A value sets or replaces that environment; null deletes it; an absent environment is kept. */
  values: Partial<
    Record<Environment, { value: string; source?: string | null } | null>
  >;
};

/** Environment-variable safe; `__` (.NET nesting) is covered by `_`. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const KNOWN_PREFIX = /^(sk_live_|sk_test_|ghp_|npm_|xox[bp]-|AKIA)/;

/** `sk_live_••••0b3d`: a known prefix (up to 8 characters) and the last 4, only for values of 12+ characters. */
export function maskValue(value: string): string {
  if (value.length < 12) return '••••';
  const prefix = KNOWN_PREFIX.exec(value)?.[0].slice(0, 8) ?? '';
  return `${prefix}••••${value.slice(-4)}`;
}

/** One value discovery found in the repo (or in .NET user secrets). Stays in main: the renderer gets a `FoundView`. */
export type Found = {
  name: string;
  value: string;
  /** Null when the file or profile name maps to no environment (the Unassigned lane). */
  env: Environment | null;
  /** A repo-relative path with `/`, or "user secrets" / "launch profile <name>". */
  source: string;
  /** The file is committed to git. */
  tracked: boolean;
  secretLike: boolean;
};

/** A `Found` as the renderer sees it: a mask and a key that main resolves back to the value at import. */
export type FoundView = Omit<Found, 'value'> & { key: string; mask: string };

/** `skipped`: values whose names cannot be environment variables. */
export type DiscoverResult = {
  found: FoundView[];
  sources: string[];
  skipped: number;
};

/** Why a repo's secrets are not yet fully protected. */
export type SecretsReason =
  | { kind: 'copy'; files: string[] }
  | { kind: 'tracked'; files: string[] }
  | { kind: 'worktrees'; taskIds: string[] };

/** The manager's status panel: green when protected, amber with reasons, nothing when the repo has no secrets. */
export type SecretsStatus = {
  state: 'empty' | 'protected' | 'attention';
  reasons: SecretsReason[];
  given: GivenTo[];
};

/** One found value the import page can pick: a mask and the key main resolves at import. */
export type ImportCandidate = {
  source: string;
  mask: string;
  key: string;
  tracked: boolean;
  /** In a `changed` cell: this source holds the value stored already. */
  matchesStored?: boolean;
};

/**
 * One environment of a found name, against what is stored for the repo: `new` (nothing stored), `changed` (another
 * value stored; `was` is its source), `same` (that value is stored already) or `missing` (not found).
 */
export type ImportCell = {
  candidates: ImportCandidate[];
  state: 'new' | 'changed' | 'same' | 'missing';
  was?: string | null;
  /** In a `missing` cell: the repo has a value stored for it, which the import keeps. */
  stored?: boolean;
};

export type ImportRow = {
  name: string;
  secretLike: boolean;
  cells: Record<Environment, ImportCell>;
  /** Values from files or profiles whose names map to no environment. */
  unassigned: ImportCandidate[];
};

/** A source the import lists; `removable` when Shellie may take imported keys out of it (untracked `.env` style). */
export type ImportSource = {
  path: string;
  tracked: boolean;
  removable: boolean;
};

export type ImportPlan = {
  rows: ImportRow[];
  sources: ImportSource[];
  skipped: number;
};

export type ImportRequest = {
  repoId: string;
  /** Keys only: main resolves each to the value it found. Names as found; a stored spelling wins on save. */
  picks: { name: string; env: Environment; key: string }[];
  rewriteWorktreeCopies: boolean;
  /** Repo-relative `.env`-style files (untracked) to take the imported keys out of. */
  removeFromMainCheckout: string[];
};

export type ImportResult = {
  values: number;
  worktreesRewritten: number;
  filesChanged: string[];
};

/** A row with nothing new: every value it found is stored already (re-discovery hides it by default). */
export function isUnchanged(row: ImportRow): boolean {
  const states = ENVIRONMENTS.map((e) => row.cells[e].state);
  return (
    row.unassigned.length === 0 &&
    states.includes('same') &&
    states.every((s) => s === 'same' || s === 'missing')
  );
}
