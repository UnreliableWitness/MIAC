import { z } from 'zod';
import type { ServerBudgets } from '../../shared/costServer';
import type { TokenCrypto } from '../services/ConnectionStore';
import { JsonFileStore } from '../usage/JsonFileStore';

const BudgetSchema = z
  .object({ monthlyEur: z.number(), monthStartDay: z.number() })
  .nullable();
const BudgetsSchema = z.object({
  claude: BudgetSchema,
  copilot: BudgetSchema,
});
const FileSchema = z.object({
  version: z.literal(1),
  connection: z
    .object({ url: z.string(), email: z.string(), keyCiphertext: z.string() })
    .nullable(),
  budgets: BudgetsSchema.nullable(),
});
type CostServerFile = z.infer<typeof FileSchema>;

export type CostServerConnection = { url: string; email: string; key: string };

const empty = (): CostServerFile => ({
  version: 1,
  connection: null,
  budgets: null,
});

/** The cost server's address, the developer's email and the company key (encrypted with safeStorage via TokenCrypto). */
export class CostServerStore {
  private readonly store: JsonFileStore<CostServerFile>;

  constructor(
    file: string,
    private readonly crypto: TokenCrypto,
  ) {
    this.store = new JsonFileStore(file, FileSchema, empty);
  }

  load(): Promise<{ recovered: boolean; backup?: string }> {
    return this.store.load();
  }

  /** The connection with its key decrypted; null when none is saved or the key cannot be read. */
  get(): CostServerConnection | null {
    const c = this.store.value.connection;
    if (!c) return null;
    try {
      const key = this.crypto.decrypt(Buffer.from(c.keyCiphertext, 'base64'));
      return { url: c.url, email: c.email, key };
    } catch {
      return null;
    }
  }

  async set(c: CostServerConnection): Promise<void> {
    if (!this.crypto.available())
      throw new Error(
        'Encryption is not available on this machine; the key was not saved',
      );
    const keyCiphertext = this.crypto.encrypt(c.key).toString('base64');
    await this.store.update((f) => {
      f.connection = { url: c.url, email: c.email, keyCiphertext };
    });
  }

  async clear(): Promise<void> {
    await this.store.update((f) => {
      f.connection = null;
      f.budgets = null;
    });
  }

  /** The last `hello` answer. */
  get budgets(): ServerBudgets | null {
    return this.store.value.budgets;
  }

  async setBudgets(b: ServerBudgets | null): Promise<void> {
    await this.store.update((f) => {
      f.budgets = b;
    });
  }
}
