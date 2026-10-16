import type { ReactNode } from 'react';

/**
 * A page's title row, with optional pivots and a command bar below it. `inline` puts the command bar on the
 * title row instead, at its right end, for pages without pivots that want a single compact row.
 */
export function PageHeader({
  title,
  before,
  after,
  pivots,
  commands,
  inline = false,
}: {
  title: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
  pivots?: ReactNode;
  commands?: ReactNode;
  inline?: boolean;
}) {
  const bar = commands && <div className="commandbar">{commands}</div>;
  return (
    <header className={inline ? 'pagehead pagehead-inline' : 'pagehead'}>
      <div className="pagehead-title">
        {before}
        <h1>{title}</h1>
        {after}
        {inline && bar}
      </div>
      {(pivots || (!inline && commands)) && (
        <div className="pagehead-bar">
          {pivots}
          {!inline && bar}
        </div>
      )}
    </header>
  );
}

/** ADO pivot tabs: text with a blue underline under the selected one. */
export function Pivots<K extends string>({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: { key: K; label: string; disabled?: boolean }[];
  selected: K;
  onSelect: (key: K) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="pivots">
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          role="tab"
          className="pivot"
          aria-selected={selected === i.key}
          disabled={i.disabled}
          onClick={() => onSelect(i.key)}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
