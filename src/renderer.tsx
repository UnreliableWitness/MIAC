import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import { installErrorTracking } from './renderer/telemetry';
import './renderer/styles/app.css';

installErrorTracking();
createRoot(document.getElementById('root')!).render(<App />);
