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
