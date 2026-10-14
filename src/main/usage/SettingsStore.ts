import {
  AppSettingsSchema,
  defaultSettings,
  type AppSettings,
} from '../../shared/usage';
import { JsonFileStore } from './JsonFileStore';

export class SettingsStore {
  private readonly store: JsonFileStore<AppSettings>;
  constructor(file: string) {
    this.store = new JsonFileStore(file, AppSettingsSchema, defaultSettings);
  }
  load() {
    return this.store.load();
  }
  get(): AppSettings {
    return this.store.value;
  }
  save(next: AppSettings): Promise<AppSettings> {
    return this.store.update(() => next);
  }
}
