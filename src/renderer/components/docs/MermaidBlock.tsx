import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { openWeb } from '../../docs/linkify';
import { errorMessage } from '../../../shared/errors';

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
const load = () =>
  (ready ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
    });
    return m.default;
  }));

/** A ```mermaid block as a diagram; on a parse error, its source and the message. Loaded on first use. */
export function MermaidBlock({ code }: { code: string }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    setSvg(null);
    load()
      .then((m) => m.render(id, code))
      .then(({ svg }) => live && setSvg(svg))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [id, code]);
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
