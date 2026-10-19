import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import styles from './ItemMenu.module.css';

export interface ItemMenuAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}

export interface ItemMenuProps {
  /** Accessible name of the trigger, e.g. "More for Rice". */
  label: string;
  actions: readonly ItemMenuAction[];
  onOpenChange?: (open: boolean) => void;
}

/**
 * Small overflow menu (swap / remove). Arrow keys move, Escape closes and returns focus,
 * a tap outside closes.
 */
export function ItemMenu({ label, actions, onOpenChange }: ItemMenuProps) {
  const [open, setOpenState] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChangeRef.current?.(next);
  };

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) {
        setOpenState(false);
        onOpenChangeRef.current?.(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = items.findIndex((el) => el === document.activeElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(at + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(at - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // don't also close the surrounding sheet
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={label} className={styles.menu} onKeyDown={onMenuKeyDown}>
          {actions.map((a, i) => (
            <button
              key={a.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={[styles.item, a.destructive ? styles.destructive : ''].join(' ')}
              onClick={() => {
                // Back on the trigger first, so a sheet the action opens (Swap) returns focus here.
                close(true);
                a.onSelect();
              }}
            >
              <span className={styles.icon} aria-hidden="true">
                {a.icon}
              </span>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
