import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// frame-src: HTML files opened in a tab load in a sandboxed iframe from shellie-view: (src/main/htmlView.ts).
const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'self'; frame-src shellie-view:";

/** Strict CSP for packaged builds only. The dev server needs inline scripts (React refresh) and a websocket (HMR). */
function cspForBuild(): Plugin {
  return {
    name: 'shellie-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), cspForBuild()],
  // Monaco's workers are ES modules with imports.
  worker: { format: 'es' },
});
