import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './BottomSheet.module.css';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Scrim tap, Escape and the grab handle close the sheet. False for the morning check-in. */
  dismissible?: boolean;
  /** CSS max-height of the panel, relative to the viewport. */
  maxHeight?: string;
  /**
   * Accessible name when the sheet has no visible `SheetTitle` (the Log sheet). A SheetTitle
   * inside the content names the dialog instead, so the name matches what's on screen.
   */
  title?: string;
  /**
   * The sheet has a history entry of its own (the shell's ?sheet= sheets), so the phone's back
   * button pops it. Any other sheet is closed by the shell's back handler (see `topLocalSheet`).
   */
  routed?: boolean;
  className?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

interface OpenSheetEntry {
  /** 1 for a sheet over a screen, 2 for a sheet opened inside it… */
  depth: number;
  /** Opening order among sheets at the same depth. */
  seq: number;
  routed: boolean;
  dismissible: () => boolean;
  close: () => void;
}

/** Open sheets; only the top one reacts to keys and to the back button. */
const openSheets: OpenSheetEntry[] = [];
let sheetSeq = 0;

/**
 * The sheet on top: the most deeply nested, newest first. Depth decides because a parent and the
 * sheet inside it can open in the same commit, where the child's effects run first.
 */
function topSheet(): OpenSheetEntry | undefined {
  let top: OpenSheetEntry | undefined;
  for (const entry of openSheets) {
    if (!top || entry.depth > top.depth || (entry.depth === top.depth && entry.seq > top.seq)) top = entry;
  }
  return top;
}

/** How deep the current sheet is (0 outside any sheet), so nested sheets stack above their parent. */
const SheetDepthContext = createContext(0);
const sheetListeners = new Set<() => void>();

function notifySheets() {
  for (const listener of sheetListeners) listener();
}

function subscribeSheets(listener: () => void): () => void {
  sheetListeners.add(listener);
  return () => {
    sheetListeners.delete(listener);
  };
}

function anySheetOpen(): boolean {
  return openSheets.length > 0;
}

function noSheetOpen(): boolean {
  return false;
}

/** True while any BottomSheet is open (the toast host moves the toast off the sheet's actions). */
export function useAnySheetOpen(): boolean {
  return useSyncExternalStore(subscribeSheets, anySheetOpen, noSheetOpen);
}

/**
 * The newest open sheet when it has no history entry of its own (a picker, Usuals, Add an item…):
 * the phone's back button should close it instead of leaving the screen under it.
 */
export function topLocalSheet(): { dismissible: boolean; close: () => void } | undefined {
  const top = topSheet();
  if (!top || top.routed) return undefined;
  return { dismissible: top.dismissible(), close: top.close };
}

/*
 * The page scroll lock is counted, not saved per sheet: when nested sheets unmount in the same
 * commit (the Log sheet and its Pots sheet), the parent's cleanup runs first, so a per-sheet
 * save/restore would put "hidden" back and leave the whole app unscrollable.
 */
let scrollLocks = 0;
let overflowBeforeLock = '';

function lockPageScroll() {
  if (scrollLocks === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockPageScroll() {
  if (scrollLocks === 0) return;
  scrollLocks -= 1;
  if (scrollLocks === 0) document.body.style.overflow = overflowBeforeLock;
}

/*
 * Sheets unmount at once on close, so the second tap of a double tap on a closing action would
 * land on whatever lay under the sheet (usually the bottom nav). Real pointer clicks right after a
 * close are dropped; keyboard clicks (detail 0) and synthetic ones (tests) go through.
 */
const GHOST_CLICK_MS = 350;
let lastSheetClosedAt = Number.NEGATIVE_INFINITY;
let ghostGuardInstalled = false;

function dropGhostClick(event: MouseEvent) {
  if (!event.isTrusted || event.detail === 0) return;
  if (performance.now() - lastSheetClosedAt >= GHOST_CLICK_MS) return;
  event.preventDefault();
  event.stopPropagation();
}

function installGhostClickGuard() {
  if (ghostGuardInstalled) return;
  ghostGuardInstalled = true;
  document.addEventListener('click', dropGhostClick, true);
}

/** Fields that bring up the on-screen keyboard. */
const TEXT_ENTRY =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]';
/** About how long the on-screen keyboard takes to slide up. */
const KEYBOARD_SETTLE_MS = 320;

/** Lets the sheet's SheetTitle name the dialog (aria-labelledby). One SheetTitle per sheet. */
interface SheetTitleLink {
  id: string;
  register: () => () => void;
}

const SheetTitleContext = createContext<SheetTitleLink | null>(null);

/** True while focus sits in another modal (a ConfirmDialog over the sheet), which handles its own keys. */
function focusInOtherModal(panel: HTMLElement): boolean {
  const active = document.activeElement;
  const modal = active instanceof Element ? active.closest('[aria-modal="true"]') : null;
  return modal !== null && modal !== panel;
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[aria-hidden="true"]'));
}

/** Keeps Tab and Shift+Tab cycling inside the panel. */
function trapTab(event: KeyboardEvent, panel: HTMLElement) {
  const items = focusables(panel);
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    panel.focus();
    return;
  }
  if (!panel.contains(active)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * @design C04 BottomSheet — anchored to the bottom of the app column over a --sheet scrim.
 * Rendered through a portal; focus moves into the sheet and returns to the opener on close.
 */
export function BottomSheet(props: BottomSheetProps) {
  return props.open ? <OpenSheet {...props} /> : null;
}

function OpenSheet({ onClose, dismissible = true, maxHeight = '88%', title, routed = false, className, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Captured during the first render, before any autoFocus inside the sheet moves focus.
  const [returnFocusTo] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });
  const depth = useContext(SheetDepthContext) + 1;
  const titleId = useId();
  const [titleCount, setTitleCount] = useState(0);
  const titleLink = useMemo<SheetTitleLink>(
    () => ({
      id: titleId,
      register: () => {
        setTitleCount((n) => n + 1);
        return () => setTitleCount((n) => n - 1);
      },
    }),
    [titleId],
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    lockPageScroll();
    installGhostClickGuard();
    return () => {
      unlockPageScroll();
      lastSheetClosedAt = performance.now();
      if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);

  // Registered once per open; nested sheets stack above their parent, then in opening order.
  useEffect(() => {
    sheetSeq += 1;
    const entry: OpenSheetEntry = {
      depth,
      seq: sheetSeq,
      routed,
      dismissible: () => dismissibleRef.current,
      close: () => onCloseRef.current(),
    };
    openSheets.push(entry);
    notifySheets();
    const onKeyDown = (event: KeyboardEvent) => {
      if (topSheet() !== entry) return;
      const panel = panelRef.current;
      if (!panel || focusInOtherModal(panel)) return;
      if (event.key === 'Escape' && dismissibleRef.current) {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        trapTab(event, panel);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = openSheets.indexOf(entry);
      if (index >= 0) openSheets.splice(index, 1);
      notifySheets();
    };
  }, [depth, routed]);

  // The on-screen keyboard: neither iOS Safari nor Android Chrome shrinks the layout viewport the
  // panel is pinned to, so the panel follows the visual viewport (--kb lifts it above the
  // keyboard, --vvh caps its height) and a focused field is scrolled into view once it settles.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const vv = window.visualViewport ?? undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const revealFocused = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && panel.contains(active) && active.matches(TEXT_ENTRY)) {
          active.scrollIntoView?.({ block: 'nearest' });
        }
      }, KEYBOARD_SETTLE_MS);
    };
    const update = () => {
      if (!vv) return;
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      panel.style.setProperty('--kb', `${Math.round(keyboard)}px`);
      panel.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      revealFocused();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.matches(TEXT_ENTRY)) revealFocused();
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    panel.addEventListener('focusin', onFocusIn);
    return () => {
      clearTimeout(settle);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      panel.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  return createPortal(
    <div className={styles.root}>
      <div className={styles.scrim} aria-hidden="true" onClick={dismissible ? () => onCloseRef.current() : undefined} />
      <div className={styles.column}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleCount > 0 ? titleId : undefined}
          aria-label={titleCount > 0 ? undefined : title}
          tabIndex={-1}
          className={[styles.panel, className].filter(Boolean).join(' ')}
          // Capped by the visible height too, so an open keyboard never pushes the top off-screen.
          style={{ maxHeight: `min(${maxHeight}, calc(var(--vvh, 100%) - env(safe-area-inset-top, 0px) - 8px))` }}
        >
          {dismissible ? (
            <button type="button" className={styles.handleButton} aria-label="Close" onClick={() => onCloseRef.current()}>
              <span className={styles.handle} />
            </button>
          ) : (
            <div className={styles.handleStatic} aria-hidden="true">
              <span className={styles.handle} />
            </div>
          )}
          <SheetDepthContext.Provider value={depth}>
            <SheetTitleContext.Provider value={titleLink}>{children}</SheetTitleContext.Provider>
          </SheetDepthContext.Provider>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 22px/700 sheet heading: "This week's budget", "Plan a makan day". It also names the sheet's dialog. */
export function SheetTitle({ children, className }: { children: ReactNode; className?: string }) {
  const link = useContext(SheetTitleContext);
  useLayoutEffect(() => link?.register(), [link]);
  return (
    <h2 id={link?.id} className={['t-sheet-title', styles.title, className].filter(Boolean).join(' ')}>
      {children}
    </h2>
  );
}
