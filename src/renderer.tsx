import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import { migratePrefs } from './renderer/migratePrefs';
import { installErrorTracking } from './renderer/telemetry';
import { installWindowChrome } from './renderer/windowChrome';
import './renderer/styles/app.css';
import './renderer/styles/review.css';

try {
  migratePrefs(window.localStorage);
} catch {
  // Prefs stay under their old keys; the app still runs.
}
installErrorTracking();
if (window.shellie) installWindowChrome(window.shellie);
createRoot(document.getElementById('root')!).render(<App />);
