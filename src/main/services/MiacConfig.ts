import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { MiacConfig } from '../../shared/types';

export const DEFAULT_BRANCH_TEMPLATE = '{type}/{id}-{slug}';

export class MiacConfigError extends Error {
  constructor(
    public readonly file: string,
    detail: string,
  ) {
    super(`${file}: ${detail}`);
    this.name = 'MiacConfigError';
  }
}

const listOrString = z.union([
  z.string().transform((s) => [s]),
  z.array(z.string()),
]);

const MiacYmlSchema = z.strictObject({
  base: z.string().default('main'),
  branch: z.string().default(DEFAULT_BRANCH_TEMPLATE),
  copy: listOrString.default([]),
  setup: listOrString.optional(),
  run: z.record(z.string(), z.string()).default({}),
  apm: z.union([z.literal(false), listOrString]).optional(),
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadMiacConfig(repoPath: string): Promise<MiacConfig> {
  const file = path.join(repoPath, '.miac.yml');
  const defaultSetup = (await exists(path.join(repoPath, 'package-lock.json')))
    ? ['npm ci']
    : [];

  let text: string | null = null;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (text === null) {
    return {
      base: 'main',
      branch: DEFAULT_BRANCH_TEMPLATE,
      copy: [],
      setup: defaultSetup,
      run: {},
      found: false,
    };
  }

  let doc: unknown;
  try {
    doc = parseYaml(text) ?? {};
  } catch (e) {
    throw new MiacConfigError(file, `not valid YAML: ${(e as Error).message}`);
  }
  const parsed = MiacYmlSchema.safeParse(doc);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(
        (i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`,
      )
      .join('; ');
    throw new MiacConfigError(file, detail);
  }
  const c = parsed.data;
  return {
    base: c.base,
    branch: c.branch,
    copy: c.copy,
    setup: c.setup ?? defaultSetup,
    run: c.run,
    ...(c.apm !== undefined ? { apm: c.apm } : {}),
    found: true,
  };
}
