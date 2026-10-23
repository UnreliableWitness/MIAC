import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  ENVIRONMENTS,
  SECRET_NAME,
  maskValue,
  type Environment,
  type GivenTo,
  type SecretInput,
  type SecretScope,
  type SecretView,
} from '../../shared/secrets';
import type { TokenCrypto } from '../services/ConnectionStore';
import { JsonFileStore } from '../usage/JsonFileStore';

const EnvironmentSchema = z.enum(ENVIRONMENTS);
const ScopeSchema = z.union([
  z.literal('all'),
  z.object({ repoId: z.string() }),
]);
const StoredValueSchema = z.object({
  ciphertext: z.string(),
  source: z.string().nullable(),
  changedAt: z.string(),
});
const SecretsFileSchema = z.object({
  version: z.literal(1),
  secrets: z.array(
    z.object({
      id: z.string(),
      scope: ScopeSchema,
      name: z.string(),
      givenTo: z.array(z.enum(['setup', 'run', 'tests', 'shell'])),
      values: z.partialRecord(EnvironmentSchema, StoredValueSchema),
    }),
  ),
  repoDefaults: z.record(
    z.string(),
    z.object({ environment: EnvironmentSchema }),
  ),
});
type SecretsFile = z.infer<typeof SecretsFileSchema>;
type Stored = SecretsFile['secrets'][number];

const empty = (): SecretsFile => ({
  version: 1,
  secrets: [],
  repoDefaults: {},
});

const sameScope = (a: SecretScope, b: SecretScope) =>
  a === 'all' || b === 'all' ? a === b : a.repoId === b.repoId;

/** Secrets encrypted at rest (safeStorage via TokenCrypto). Decrypted values leave this class only through main-side calls. */
export class SecretStore {
  private readonly store: JsonFileStore<SecretsFile>;

  constructor(
    filePath: string,
    private readonly crypto: TokenCrypto,
    /** One line per reveal: time, name, environment. Never the value. */
    private readonly revealLog: string = path.join(
      path.dirname(filePath),
      'secrets-reveals.log',
    ),
  ) {
    this.store = new JsonFileStore(filePath, SecretsFileSchema, empty);
  }

  private get current(): SecretsFile {
    return this.store.value;
  }

  async load(): Promise<{ recovered: boolean; backup?: string }> {
    return this.store.load();
  }

  /** Masked views; with a repo id, that repo's secrets and the All ones, with 'all' only the All ones. */
  list(scope?: SecretScope): SecretView[] {
    return this.current.secrets
      .filter(
        (s) =>
          scope === undefined ||
          sameScope(s.scope, scope) ||
          (scope !== 'all' && s.scope === 'all'),
      )
      .map((s) => this.view(s));
  }

  async save(input: SecretInput): Promise<SecretView> {
    const name = input.name.trim();
    if (!SECRET_NAME.test(name))
      throw new Error(
        'A secret name can use letters, digits and underscores, and cannot start with a digit',
      );
    const adds = Object.entries(input.values).some(([, v]) => v);
    if (adds && !this.crypto.available())
      throw new Error(
        'Encryption is not available on this machine; the secret was not saved',
      );
    const clash = this.current.secrets.find(
      (s) =>
        s.id !== input.id && s.name === name && sameScope(s.scope, input.scope),
    );
    if (clash) throw new Error(`There is already a secret named ${name} here`);
    const now = new Date().toISOString();
    let saved!: Stored;
    await this.store.update((f) => {
      const existing = input.id
        ? f.secrets.find((s) => s.id === input.id)
        : undefined;
      if (input.id && !existing) throw new Error(`Unknown secret ${input.id}`);
      const record: Stored = existing ?? {
        id: randomUUID(),
        scope: input.scope,
        name,
        givenTo: [],
        values: {},
      };
      record.scope = input.scope;
      record.name = name;
      record.givenTo = [...new Set(input.givenTo)];
      for (const env of ENVIRONMENTS) {
        const v = input.values[env];
        if (v === undefined) continue;
        if (v === null) delete record.values[env];
        else
          record.values[env] = {
            ciphertext: this.crypto.encrypt(v.value).toString('base64'),
            source: v.source ?? null,
            changedAt: now,
          };
      }
      if (!existing) f.secrets.push(record);
      saved = record;
    });
    return this.view(saved);
  }

  async delete(id: string): Promise<void> {
    await this.store.update((f) => {
      f.secrets = f.secrets.filter((s) => s.id !== id);
    });
  }

  /** The plain value, for an explicit reveal; leaves a record (without the value) in the reveal log. */
  reveal(id: string, env: Environment): string {
    const s = this.find(id);
    const value = this.decrypt(s, env);
    if (value === null) throw new Error(`${s.name} has no ${env} value`);
    mkdirSync(path.dirname(this.revealLog), { recursive: true });
    appendFileSync(
      this.revealLog,
      `${new Date().toISOString()} ${s.name} ${env}\n`,
      'utf8',
    );
    return value;
  }

  /** What a repo's tabs get for an environment; a repo's own secret beats an All one of the same name. */
  valuesFor(
    repoId: string,
    env: Environment,
  ): Record<string, { value: string; givenTo: GivenTo[] }> {
    const out: Record<string, { value: string; givenTo: GivenTo[] }> = {};
    const pick = (secrets: Stored[]) => {
      for (const s of secrets) {
        const value = this.decrypt(s, env);
        if (value !== null) out[s.name] = { value, givenTo: [...s.givenTo] };
      }
    };
    pick(this.current.secrets.filter((s) => s.scope === 'all'));
    pick(
      this.current.secrets.filter(
        (s) => s.scope !== 'all' && s.scope.repoId === repoId,
      ),
    );
    return out;
  }

  /** Every stored value that applies to these repos, in every environment (for leak watch). */
  allValues(
    repoIds: string[],
  ): { name: string; value: string; env: Environment }[] {
    const out: { name: string; value: string; env: Environment }[] = [];
    for (const s of this.current.secrets) {
      if (s.scope !== 'all' && !repoIds.includes(s.scope.repoId)) continue;
      for (const env of ENVIRONMENTS) {
        const value = this.decrypt(s, env);
        if (value !== null) out.push({ name: s.name, value, env });
      }
    }
    return out;
  }

  repoDefault(repoId: string): Environment {
    return this.current.repoDefaults[repoId]?.environment ?? 'development';
  }

  async setRepoDefault(repoId: string, env: Environment): Promise<void> {
    if (env !== 'development' && env !== 'test')
      throw new Error('A repo can default to Development or Test only');
    await this.store.update((f) => {
      f.repoDefaults[repoId] = { environment: env };
    });
  }

  private find(id: string): Stored {
    const s = this.current.secrets.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown secret ${id}`);
    return s;
  }

  private decrypt(s: Stored, env: Environment): string | null {
    const v = s.values[env];
    if (!v) return null;
    try {
      return this.crypto.decrypt(Buffer.from(v.ciphertext, 'base64'));
    } catch {
      return null;
    }
  }

  private view(s: Stored): SecretView {
    const values: SecretView['values'] = {};
    for (const env of ENVIRONMENTS) {
      const v = s.values[env];
      if (!v) continue;
      const plain = this.decrypt(s, env);
      values[env] = {
        mask: plain === null ? '••••' : maskValue(plain),
        source: v.source,
        changedAt: v.changedAt,
      };
    }
    return {
      id: s.id,
      scope: s.scope,
      name: s.name,
      givenTo: [...s.givenTo],
      values,
    };
  }
}
