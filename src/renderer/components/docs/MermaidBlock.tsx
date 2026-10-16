import { useEffect, useId, useRef, useState } from 'react';

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
      .catch(
        (e: unknown) =>
          live && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
  }, [id, code]);
  useEffect(() => {
    // innerHTML is safe here: Mermaid's strict security level sanitizes its own SVG with DOMPurify.
    if (host.current && svg !== null) host.current.innerHTML = svg;
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
  return <div className="doc-mermaid" ref={host} />;
}
