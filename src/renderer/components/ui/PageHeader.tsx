import type { ReactNode } from 'react';

/** A page's title row, with optional pivots and a command bar below it. */
export function PageHeader({
  title,
  before,
  after,
  pivots,
  commands,
}: {
  title: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
  pivots?: ReactNode;
  commands?: ReactNode;
}) {
  return (
    <header className="pagehead">
      <div className="pagehead-title">
        {before}
        <h1>{title}</h1>
        {after}
      </div>
      {(pivots || commands) && (
        <div className="pagehead-bar">
          {pivots}
          {commands && <div className="commandbar">{commands}</div>}
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
