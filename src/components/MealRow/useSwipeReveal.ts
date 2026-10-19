import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** Movement (px) before a press becomes a swipe or a scroll. */
const SLOP = 8;

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  /** Offset when the gesture started (0 closed, −width open). */
  base: number;
  mode: 'pending' | 'drag';
}

export interface SwipeReveal {
  /** Current translateX of the row in px (0 … −width). */
  offset: number;
  open: boolean;
  dragging: boolean;
  /** True while any part of the actions is uncovered. */
  revealed: boolean;
  setOpen: (open: boolean) => void;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  /** Call from the row's click handler: true when the click is the tail of a swipe and should be ignored. */
  consumeSwipeClick: () => boolean;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Swipe-left-to-reveal for ledger rows. Horizontal drags move the row; vertical movement is left to the
 * page scroll (pair with `touch-action: pan-y`). Releasing past half the width snaps open.
 * Tapping or pressing outside `containerRef` closes it again.
 */
export function useSwipeReveal(width: number, enabled: boolean, containerRef: RefObject<HTMLElement | null>): SwipeReveal {
  const [open, setOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const el = containerRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open, containerRef]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      swallowClick.current = false;
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      gesture.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, base: open ? -width : 0, mode: 'pending' };
    },
    [enabled, open, width],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (g.mode === 'pending') {
        if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) {
          gesture.current = null; // a scroll, not a swipe
          return;
        }
        if (Math.abs(dx) <= SLOP) return;
        g.mode = 'drag';
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // Capture is a nicety; the swipe still works without it.
        }
      }
      setDragOffset(clamp(g.base + dx, -width, 0));
    },
    [width],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.pointerId !== e.pointerId || g.mode !== 'drag') return;
      const final = clamp(g.base + (e.clientX - g.startX), -width, 0);
      setOpen(final < -width / 2);
      setDragOffset(null);
      swallowClick.current = true;
    },
    [width],
  );

  const onPointerCancel = useCallback(() => {
    gesture.current = null;
    setDragOffset(null);
  }, []);

  const consumeSwipeClick = useCallback(() => {
    const swallow = swallowClick.current;
    swallowClick.current = false;
    return swallow;
  }, []);

  const offset = dragOffset ?? (open ? -width : 0);
  return {
    offset,
    open,
    dragging: dragOffset !== null,
    revealed: offset < 0,
    setOpen,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    consumeSwipeClick,
  };
}
