import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { openWeb } from '../../docs/linkify';
import { errorMessage } from '../../../shared/errors';
import type { ColorScheme } from '../../../shared/theme';
import { useColorScheme } from '../../colorScheme';

const XLINK = 'http://www.w3.org/1999/xlink';

/**
 * Mermaid's strict mode still renders `click A "url"` as an `<a>` with an author-chosen target.
 * Links in a diagram never navigate Shellie: an allowed web link goes to the browser, anything else does nothing.
 */
function followDiagramLink(e: MouseEvent<HTMLDivElement>): void {
  const a = (e.target as Element | null)?.closest?.('a');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.type === 'auxclick' && e.button !== 1) return;
  const href =
    a.getAttribute('href') ??
    a.getAttributeNS(XLINK, 'href') ??
    a.getAttribute('xlink:href');
  if (href) openWeb(href);
}

let ready: Promise<typeof import('mermaid').default> | null = null;
let initializedFor: ColorScheme | null = null;
/** Mermaid's theme is global to initialize(): set it again whenever the scheme on screen changes. */
const load = (scheme: ColorScheme) =>
  (ready ??= import('mermaid').then((m) => m.default)).then((m) => {
    if (initializedFor !== scheme) {
      m.initialize({
        startOnLoad: false,
        theme: scheme === 'light' ? 'default' : 'dark',
        securityLevel: 'strict',
      });
      initializedFor = scheme;
    }
    return m;
  });

/** A ```mermaid block as a diagram; on a parse error, its source and the message. Loaded on first use. */
export function MermaidBlock({ code }: { code: string }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const scheme = useColorScheme();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    setSvg(null);
    load(scheme)
      .then((m) => m.render(id, code))
      .then(({ svg }) => live && setSvg(svg))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [id, code, scheme]);
  useEffect(() => {
    // innerHTML is safe here: Mermaid's strict security level sanitizes its own SVG with DOMPurify.
    if (host.current && svg !== null) {
      host.current.innerHTML = svg;
      for (const el of host.current.querySelectorAll('[target]'))
        el.removeAttribute('target');
    }
  }, [svg, error]);
  if (error)
    return (
      <div className="doc-mermaid-error">
        <pre>
          <code>{code}</code>
        </pre>
        <p className="doc-error">{error}</p>
      </div>
    );
  return (
    <div
      className="doc-mermaid"
      ref={host}
      onClickCapture={followDiagramLink}
      onAuxClickCapture={followDiagramLink}
    />
  );
}
