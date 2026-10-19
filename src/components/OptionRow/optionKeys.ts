const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);
const PREV_KEYS = new Set(['ArrowUp', 'ArrowLeft']);

/** Index the arrow/Home/End key moves to, wrapping at both ends; null for other keys. */
export function nextOptionIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (NEXT_KEYS.has(key)) return (current + 1) % count;
  if (PREV_KEYS.has(key)) return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
