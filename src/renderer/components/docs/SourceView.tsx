import { useEffect, useRef } from 'react';

export function SourceView({
  text,
  highlightLine,
}: {
  text: string;
  highlightLine?: number | null;
}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlightLine) return;
    const el = host.current?.querySelector(`[data-line="${highlightLine}"]`);
    el?.scrollIntoView?.({ block: 'center' });
  }, [highlightLine]);
  return (
    <div className="doc-src mono" ref={host}>
      {/* The line number is drawn by CSS from data-line, so it is never part of a selection or a quote. */}
      {lines.map((l, i) => (
        <div
          key={i}
          className={`src-line${highlightLine === i + 1 ? ' is-hl' : ''}`}
          data-line={i + 1}
        >
          <span className="src-text">{l || ' '}</span>
        </div>
      ))}
    </div>
  );
}
