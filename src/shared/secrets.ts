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

/** Environments a task only switches to after a confirm, shown with a coloured band. */
export const isGuarded = (env: Environment): boolean =>
  env === 'uat' || env === 'production';

/** What the task's environment chip and its confirm show. Names only, never values. */
export type EnvironmentInfo = {
  /** Per environment: of the task's secrets (`of`), how many have a value (`have`). */
  values: Record<Environment, { have: number; of: number }>;
  /** The running tabs a switch restarts (never agent tabs). */
  tabs: { id: string; label: string; kind: 'run' | 'shell' }[];
  /** Per environment: the names with a value that go into those tabs. */
  keys: Record<Environment, string[]>;
  /** Per environment: launch profiles (`dotnet run`) that set a stored name themselves, so their value wins. */
  overrides: Record<Environment, { profile: string; names: string[] }[]>;
  /** How long Production lasts (setting). */
  productionMinutes: number;
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

/**
 * Leak watch in an agent tab: the names whose values showed up (shown on screen as `[NAME]`), and whether input is
 * paused because a Production value did. Names only, never values.
 */
export type LeakState = { names: string[]; paused: boolean };

/** A `shellie run` on UAT or Production that waits for the developer's approve in Shellie. No values. */
export type PendingRun = {
  id: string;
  taskId: string;
  /** The named command (`test`, `setup`, a `run:` entry). */
  name: string;
  /** What runs: the command line from .shellie.yml, or the setup commands. */
  command: string;
  /** Extra arguments the agent passed after `--`. */
  args: string[];
  environment: Environment;
};

/** Finish's refusal to push a branch whose changes hold a stored value (no name, no value). */
export const LEAK_IN_BRANCH =
  "A stored secret appears in this branch's changes";
/** Finish's refusal to push a branch it could not check for stored values (no base, git failing). */
export const LEAK_UNCHECKED =
  'Shellie could not check this branch for stored secrets';
