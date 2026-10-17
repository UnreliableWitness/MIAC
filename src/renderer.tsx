import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import { installErrorTracking } from './renderer/telemetry';
import { installWindowChrome } from './renderer/windowChrome';
import './renderer/styles/app.css';
import './renderer/styles/review.css';

installErrorTracking();
if (window.miac) installWindowChrome(window.miac);
createRoot(document.getElementById('root')!).render(<App />);
