// src/renderer/review/monacoSetup.ts
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

// Bundled workers only: no CDN, and the packaged CSP allows scripts from 'self'.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less')
      return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor')
      return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// A diff is read, not compiled: no squiggles from missing imports or types.
type Diagnostics = {
  setDiagnosticsOptions?: (o: Record<string, boolean>) => void;
};
const ts = (
  monaco as unknown as {
    typescript?: {
      typescriptDefaults?: Diagnostics;
      javascriptDefaults?: Diagnostics;
    };
  }
).typescript;
for (const d of [ts?.typescriptDefaults, ts?.javascriptDefaults])
  d?.setDiagnosticsOptions?.({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
(
  monaco as unknown as { json?: { jsonDefaults?: Diagnostics } }
).json?.jsonDefaults?.setDiagnosticsOptions?.({ validate: false });

// The ADO dark palette (src/renderer/styles/tokens.css).
monaco.editor.defineTheme('shellie-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#201f1e',
    'editorGutter.background': '#201f1e',
    'editor.lineHighlightBackground': '#ffffff0a',
    'editorLineNumber.foreground': '#ffffff59',
    'editorLineNumber.activeForeground': '#ffffffe6',
    'diffEditor.insertedTextBackground': '#6ccb5f33',
    'diffEditor.removedTextBackground': '#f1707b33',
    'diffEditor.insertedLineBackground': '#6ccb5f14',
    'diffEditor.removedLineBackground': '#f1707b14',
    'diffEditor.unchangedRegionBackground': '#252423',
    'scrollbarSlider.background': '#ffffff1f',
  },
});

// The ADO light palette (the prefers-color-scheme: light block of tokens.css).
monaco.editor.defineTheme('shellie-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#faf9f8',
    'editorGutter.background': '#faf9f8',
    'editor.lineHighlightBackground': '#0000000a',
    'editorLineNumber.foreground': '#00000073',
    'editorLineNumber.activeForeground': '#000000e6',
    'diffEditor.insertedTextBackground': '#107c1026',
    'diffEditor.removedTextBackground': '#a4262c26',
    'diffEditor.insertedLineBackground': '#107c1012',
    'diffEditor.removedLineBackground': '#a4262c12',
    'diffEditor.unchangedRegionBackground': '#f3f2f1',
    'scrollbarSlider.background': '#0000001f',
  },
});

export { monaco };
