import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ShellieConfig } from '../../shared/types';
import { pathExists } from '../fsRetry';

export const DEFAULT_BRANCH_TEMPLATE = '{type}/{id}-{slug}';

export class ShellieConfigError extends Error {
  constructor(
    public readonly file: string,
    detail: string,
  ) {
    super(`${file}: ${detail}`);
    this.name = 'ShellieConfigError';
  }
}

const listOrString = z.union([
  z.string().transform((s) => [s]),
  z.array(z.string()),
]);

export const ShellieYmlSchema = z.strictObject({
  base: z.string().default('main'),
  branch: z.string().default(DEFAULT_BRANCH_TEMPLATE),
  copy: listOrString.default([]),
  setup: listOrString.optional(),
  run: z.record(z.string(), z.string()).default({}),
  apm: z.union([z.literal(false), listOrString]).optional(),
  review: z.strictObject({ collapse: listOrString.default([]) }).optional(),
});

/** `.shellie.yml`, else the pre-rename `.miac.yml`, else null. */
export async function configFileFor(repoPath: string): Promise<string | null> {
  for (const name of ['.shellie.yml', '.miac.yml']) {
    const file = path.join(repoPath, name);
    if (await pathExists(file)) return file;
  }
  return null;
}

export async function loadShellieConfig(
  repoPath: string,
): Promise<ShellieConfig> {
  const file = await configFileFor(repoPath);
  const defaultSetup = (await pathExists(
    path.join(repoPath, 'package-lock.json'),
  ))
    ? ['npm ci']
    : [];

  if (file === null)
    return toConfig(ShellieYmlSchema.parse({}), defaultSetup, false);

  const text = await fs.readFile(file, 'utf8');
  let doc: unknown;
  try {
    doc = parseYaml(text) ?? {};
  } catch (e) {
    throw new ShellieConfigError(
      file,
      `not valid YAML: ${(e as Error).message}`,
    );
  }
  const parsed = ShellieYmlSchema.safeParse(doc);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(
        (i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`,
      )
      .join('; ');
    throw new ShellieConfigError(file, detail);
  }
  return toConfig(parsed.data, defaultSetup, true);
}

function toConfig(
  c: z.infer<typeof ShellieYmlSchema>,
  defaultSetup: string[],
  found: boolean,
): ShellieConfig {
  return {
    base: c.base,
    branch: c.branch,
    copy: c.copy,
    setup: c.setup ?? defaultSetup,
    run: c.run,
    ...(c.apm !== undefined ? { apm: c.apm } : {}),
    ...(c.review ? { reviewCollapse: c.review.collapse } : {}),
    found,
  };
}
