import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { afterThis, type AfterThisInput } from './afterThis';
import styles from './RangeTotal.module.css';

export type { AfterThisInput } from './afterThis';

export interface RangeTotalProps {
  /** Best guess with unit, e.g. "880 kcal" (fmtKcal). */
  totalKcalLabel: string;
  /** Likely range, e.g. "750–1,010" (fmtRange); shown as "likely 750–1,010". */
  rangeLabel: string;
  actionLabel: 'Save' | 'Review';
  onAction: () => void;
  disabled?: boolean;
  /** Review only: shows the effect on today as a three-part bar and an "After this" line. */
  after?: AfterThisInput;
  /** 'floating' (default) pins it above the bottom edge of the app column; 'inline' for previews. */
  placement?: 'floating' | 'inline';
  /** 'plate' is the plate builder's smaller action (15px, 16px 20px); 'save' is Review's (16px, 16px 22px). */
  actionSize?: 'save' | 'plate';
}

/** The CSS variable a floating footer sets on :root: its height plus its offset from the bottom edge. */
export const FOOTER_SPACE_VAR = '--footer-space';

/**
 * While floating, publishes how much of the bottom edge the footer covers, so the screen can pad
 * its content and the toast can sit above it (the footer grows with the "After this" line and
 * larger text).
 */
function useFooterSpace(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const root = document.documentElement;
    const update = () => {
      // offsetHeight ignores the enter animation's transform; bottom resolves the safe area.
      const bottom = Number.parseFloat(getComputedStyle(el).bottom) || 0;
      root.style.setProperty(FOOTER_SPACE_VAR, `${Math.round(el.offsetHeight + bottom)}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined;
    observer?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty(FOOTER_SPACE_VAR);
    };
  }, [enabled]);
  return ref;
}

/**
 * The dark footer on Review, Plate and Pot: best guess, likely range and the main action.
 * @design C23
 */
export function RangeTotal({
  totalKcalLabel,
  rangeLabel,
  actionLabel,
  onAction,
  disabled,
  after,
  placement = 'floating',
  actionSize = 'save',
}: RangeTotalProps) {
  const effect = after ? afterThis(after) : null;
  const ref = useFooterSpace(placement === 'floating');
  return (
    <div ref={ref} className={[styles.footer, placement === 'floating' ? styles.floating : ''].join(' ')}>
      <div className={styles.top}>
        <div className={styles.numbers} aria-live="polite" aria-atomic="true">
          <div className={styles.caption}>Best guess</div>
          <div className={styles.total}>{totalKcalLabel}</div>
          <div className={styles.caption}>likely {rangeLabel}</div>
        </div>
        <Button size="footer" className={actionSize === 'plate' ? styles.plateAction : undefined} onClick={onAction} disabled={disabled}>
          {actionLabel}
        </Button>
      </div>
      {after && effect ? (
        <>
          <div className={styles.bar} aria-hidden="true">
            <Segment kcal={after.eatenTodayKcal} className={styles.eaten} />
            <Segment kcal={effect.fitKcal} className={styles.fit} />
            <Segment kcal={effect.overKcal} className={styles.over} />
          </div>
          <div className={styles.after} aria-live="polite">
            {effect.line}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Segment({ kcal, className }: { kcal: number; className: string | undefined }) {
  if (kcal <= 0) return null;
  return <span className={[styles.segment, className].join(' ')} style={{ flexGrow: kcal }} />;
}
