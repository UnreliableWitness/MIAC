import { defineConfig, type Plugin } from 'vite';

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; script-src 'self'";

/** Strict CSP for packaged builds only, as in vite.renderer.config.mts. */
function cspForBuild(): Plugin {
  return {
    name: 'miac-splash-csp',
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
  plugins: [cspForBuild()],
  build: { rollupOptions: { input: 'splash.html' } },
});
