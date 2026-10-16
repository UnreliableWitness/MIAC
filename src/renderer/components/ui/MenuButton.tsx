import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

export type MenuItem = {
  key: string;
  title: string;
  note?: string;
  onSelect: () => void;
};

/**
 * A button that opens a menu under it. The menu is fixed-positioned, so rows that clip their overflow (the
 * tab row, grid cells) do not cut it off. Arrow keys, Home, End and Escape work as in a native menu.
 */
export function MenuButton({
  label,
  menuLabel = label,
  className,
  title,
  disabled,
  items,
  align = 'left',
  children,
}: {
  label: string;
  menuLabel?: string;
  className: string;
  title?: string;
  disabled?: boolean;
  items: MenuItem[];
  /** Which edge of the button the menu lines up with. */
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const [at, setAt] = useState<{
    left?: number;
    right?: number;
    top: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setAt(null);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t))
        setAt(null);
    };
    const onResize = () => setAt(null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [at]);

  const onKey = (e: KeyboardEvent) => {
    const all = [
      ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i < 0 ? -1 : i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(-1);
    else if (e.key === 'Tab') setAt(null);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        title={title}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (at) return close(false);
          const r = trigger.current?.getBoundingClientRect();
          if (!r) return;
          setAt(
            align === 'right'
              ? { right: window.innerWidth - r.right, top: r.bottom + 2 }
              : { left: r.left, top: r.bottom + 2 },
          );
        }}
      >
        {children}
      </button>
      {at && (
        <div
          ref={menu}
          role="menu"
          aria-label={menuLabel}
          className="menu menu-fixed"
          style={{ left: at.left ?? 'auto', right: at.right, top: at.top }}
          onKeyDown={onKey}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((t) => (
            <button
              key={t.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="menu-item"
              onClick={() => {
                close(false);
                t.onSelect();
              }}
            >
              <span className="menu-title">{t.title}</span>
              {t.note && <span className="small muted">{t.note}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
