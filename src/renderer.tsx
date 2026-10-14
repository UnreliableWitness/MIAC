import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import './renderer/styles/app.css';

createRoot(document.getElementById('root')!).render(<App />);
