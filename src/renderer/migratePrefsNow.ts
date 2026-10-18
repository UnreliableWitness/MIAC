import { migratePrefs } from './migratePrefs';

// A side-effect module: imported first by the renderer entry so the copy runs before the store reads its prefs.
try {
  migratePrefs(window.localStorage);
} catch {
  // Prefs stay under their old keys; the app still runs.
}
