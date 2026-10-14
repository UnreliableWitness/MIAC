import { z } from 'zod';
import { RatesFileSchema, type Rate } from '../../shared/usage';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { JsonFileStore } from './JsonFileStore';

type RatesFile = z.infer<typeof RatesFileSchema>;

export class RateStore {
  private readonly store: JsonFileStore<RatesFile>;
  constructor(file: string) {
    this.store = new JsonFileStore(file, RatesFileSchema, () => ({
      version: 1,
      rates: structuredClone(OFFICIAL_RATES),
    }));
  }
  load() {
    return this.store.load();
  }
  list(): Rate[] {
    return this.store.value.rates;
  }
  async save(rates: Rate[]): Promise<Rate[]> {
    const ids = new Set<string>();
    for (const r of rates) {
      if (ids.has(r.id)) throw new Error(`Duplicate rate id ${r.id}`);
      ids.add(r.id);
    }
    return (await this.store.update(() => ({ version: 1, rates }))).rates;
  }
  async reset(): Promise<Rate[]> {
    return (
      await this.store.update(() => ({
        version: 1,
        rates: structuredClone(OFFICIAL_RATES),
      }))
    ).rates;
  }
}
