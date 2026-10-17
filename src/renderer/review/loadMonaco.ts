// src/renderer/review/loadMonaco.ts
type MonacoModule = typeof import('monaco-editor');
let loading: Promise<MonacoModule> | null = null;

/** Monaco is several MB: loaded as its own chunk the first time the Changes tab opens. */
export function loadMonaco(): Promise<MonacoModule> {
  loading ??= import('./monacoSetup').then((m) => m.monaco);
  // A failed load (a broken chunk) can be tried again.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
