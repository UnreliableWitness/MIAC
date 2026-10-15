import { useEffect, useRef } from 'react';

/**
 * Calls `onEscape` for an Escape that nothing else handled, such as an open callout or menu. An Escape that
 * cancels an IME composition, or that a select takes to close its list, belongs to that control, not the page.
 */
export function useEscape(onEscape: () => void): void {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (e.target instanceof HTMLSelectElement) return;
      ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
