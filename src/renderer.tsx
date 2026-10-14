import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import './renderer/styles/app.css';

createRoot(document.getElementById('root')!).render(<App />);
