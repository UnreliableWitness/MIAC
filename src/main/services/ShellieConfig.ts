import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ShellieConfig } from '../../shared/types';
import { pathExists } from '../fsRetry';
import { GitClient } from './GitClient';
import {
  DEFAULT_BRANCH_TEMPLATE,
  ShellieYmlSchema,
} from '../../shared/shellieYml';

export { DEFAULT_BRANCH_TEMPLATE, ShellieYmlSchema };

export class ShellieConfigError extends Error {
  constructor(
    public readonly file: string,
    detail: string,
  ) {
    super(`${file}: ${detail}`);
    this.name = 'ShellieConfigError';
  }
}

/** `.shellie.yml`, else the pre-rename `.miac.yml`, else null. */
export async function configFileFor(repoPath: string): Promise<string | null> {
  for (const name of ['.shellie.yml', '.miac.yml']) {
    const file = path.join(repoPath, name);
    if (await pathExists(file)) return file;
  }
  return null;
}

type BaseGit = Pick<GitClient, 'defaultBaseRef' | 'currentBranch'>;
let defaultGit: GitClient | undefined;

/** The repo's own default branch (origin/HEAD, main, master, ...), for a config that sets no `base`. */
export async function defaultBaseBranch(
  repoPath: string,
  git: BaseGit = (defaultGit ??= new GitClient()),
): Promise<string> {
  const ref = await git.defaultBaseRef(repoPath);
  if (ref === 'HEAD') return (await git.currentBranch(repoPath)) ?? 'main';
  return ref.replace(/^origin\//, '');
}

export async function loadShellieConfig(
  repoPath: string,
  git?: BaseGit,
): Promise<ShellieConfig> {
  const file = await configFileFor(repoPath);
  const defaultSetup = (await pathExists(
    path.join(repoPath, 'package-lock.json'),
  ))
    ? ['npm ci']
    : [];

  if (file === null)
    return toConfig(
      ShellieYmlSchema.parse({}),
      defaultSetup,
      false,
      await defaultBaseBranch(repoPath, git),
    );

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
  return toConfig(
    parsed.data,
    defaultSetup,
    true,
    parsed.data.base ?? (await defaultBaseBranch(repoPath, git)),
  );
}

function toConfig(
  c: z.infer<typeof ShellieYmlSchema>,
  defaultSetup: string[],
  found: boolean,
  base: string,
): ShellieConfig {
  return {
    base,
    branch: c.branch,
    copy: c.copy,
    setup: c.setup ?? defaultSetup,
    run: c.run,
    ...(c.apm !== undefined ? { apm: c.apm } : {}),
    ...(c.review ? { reviewCollapse: c.review.collapse } : {}),
    found,
  };
}
