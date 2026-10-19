import { CookingPot, Plus } from 'lucide-react';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Button } from '@/components/ui/Button';
import { fmtApprox, fmtInt, fmtWeekday, roundTo10 } from '@/domain/format';
import { sumMacros } from '@/domain/meal';
import type { Pot } from '@/domain/types';
import styles from './LogSheet.module.css';

/** kcal in one serving of a pot (its ingredients ÷ servings). */
export function potServingKcal(pot: Pot): number {
  if (pot.servings <= 0) return 0;
  return sumMacros(pot.ingredients.map((i) => i.macros)).kcal / pot.servings;
}

/** 3 → "3", 2.5 → "2½". */
export function servingsText(n: number): string {
  const whole = Math.floor(n);
  const half = Math.abs(n - whole - 0.5) < 1e-9;
  if (half) return whole === 0 ? '½' : `${fmtInt(whole)}½`;
  return fmtInt(n);
}

export interface PotsSheetProps {
  open: boolean;
  onClose: () => void;
  pots: readonly Pot[];
  onLog: (pot: Pot) => void;
  /** A serving is being saved: the buttons wait, so a double tap logs one serving. */
  busy?: boolean;
  /** Opens S27 New pot. The main action when nothing is in the fridge. */
  onNewPot?: () => void;
  /** Opens S26 Pots (saved recipes, Cook again). */
  onAllPots?: () => void;
}

/** Pots still in the fridge (C38), each logged a serving at a time. */
export function PotsSheet({ open, onClose, pots, onLog, busy = false, onNewPot, onAllPots }: PotsSheetProps) {
  const empty = pots.length === 0;
  return (
    <BottomSheet open={open} onClose={onClose} title="Pots in the fridge">
      <SheetTitle>Pots in the fridge</SheetTitle>
      <div className={styles.sheetBody}>
        {empty ? (
          <EmptyState
            icon={<CookingPot size={24} strokeWidth={2} />}
            headline="No pots right now"
            body="Cook a pot at home and log it a serving at a time."
            actionLabel={onNewPot ? 'New pot' : undefined}
            onAction={onNewPot}
          />
        ) : (
          <ul className={styles.cards}>
            {pots.map((pot) => (
              <li key={pot.id} className={styles.card}>
                <div className={styles.orderText}>
                  <div className={styles.cardName}>{pot.name}</div>
                  <div className={styles.orderDetail}>
                    {servingsText(pot.servingsLeft)} of {fmtInt(pot.servings)} servings left · {fmtApprox(roundTo10(potServingKcal(pot)))} each
                  </div>
                  <div className={styles.orderDetail}>Clears {fmtWeekday(pot.expiresOn)}</div>
                </div>
                <Button size="sm" aria-label={`Log 1 serving of ${pot.name}`} disabled={busy} onClick={() => onLog(pot)}>
                  Log 1 serving
                </Button>
              </li>
            ))}
          </ul>
        )}
        {(!empty && onNewPot) || onAllPots ? (
          <div className={styles.sheetActions}>
            {!empty && onNewPot ? (
              <Button variant="secondary" size="md" icon={<Plus size={18} strokeWidth={2} />} onClick={onNewPot}>
                New pot
              </Button>
            ) : null}
            {onAllPots ? (
              <Button variant="secondary" size="md" onClick={onAllPots}>
                All pots
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
