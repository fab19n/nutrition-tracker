import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Tabbable descendants of `root`, in DOM order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]'));
}

/**
 * Keeps Tab / Shift+Tab inside `ref` while `active`, calls `onEscape` on Escape (and stops both reaching sheets
 * underneath), focuses `[data-autofocus]` or the first tabbable element on open, and restores focus on close.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = root.querySelector<HTMLElement>('[data-autofocus="true"]') ?? focusableWithin(root)[0] ?? root;
    initial.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // The dialog owns Tab while it's open; a sheet underneath must not pull focus back to itself.
      e.stopPropagation();
      const items = focusableWithin(root);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        root.focus();
        return;
      }
      const current = document.activeElement;
      const outside = !(current instanceof Node) || !root.contains(current);
      if (e.shiftKey && (current === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, ref]);
}
