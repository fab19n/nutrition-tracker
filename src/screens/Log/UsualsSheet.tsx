import { Repeat } from 'lucide-react';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Button } from '@/components/ui/Button';
import { fmtApprox, fmtInt, roundTo10 } from '@/domain/format';
import type { Id, Usual } from '@/domain/types';
import { itemsKcal } from './library';
import styles from './LogSheet.module.css';

export interface UsualsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Most used first. */
  usuals: readonly Usual[];
  /** The chosen Place: its Usuals come first. */
  placeId?: Id;
  onPick: (usual: Usual) => void;
  /** Opens S23 Usuals (edit, reorder, new). */
  onManage?: () => void;
}

function usualDetail(usual: Usual): string {
  const kcal = `${fmtApprox(roundTo10(itemsKcal(usual.items)))} kcal`;
  return usual.useCount >= 2 ? `${kcal} · ${fmtInt(usual.useCount)} times` : kcal;
}

/** Your one-tap meals (C37); a tap opens the review, pre-filled. */
export function UsualsSheet({ open, onClose, usuals, placeId, onPick, onManage }: UsualsSheetProps) {
  const sorted = placeId ? [...usuals].sort((a, b) => Number(b.placeId === placeId) - Number(a.placeId === placeId)) : usuals;
  return (
    <BottomSheet open={open} onClose={onClose} title="Your usuals">
      <SheetTitle>Your usuals</SheetTitle>
      <div className={styles.sheetBody}>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<Repeat size={24} strokeWidth={2} />}
            headline="No usuals yet"
            body="Turn on “Also save as a Usual” when you review a meal you have often."
          />
        ) : (
          <ul className={styles.cards}>
            {sorted.map((usual) => (
              <li key={usual.id} className={styles.card}>
                <div className={styles.orderText}>
                  <div className={styles.cardName}>{usual.name}</div>
                  <div className={styles.orderDetail}>{usualDetail(usual)}</div>
                </div>
                <Button variant="secondary" size="sm" aria-label={`Log ${usual.name}`} onClick={() => onPick(usual)}>
                  Log
                </Button>
              </li>
            ))}
          </ul>
        )}
        {onManage ? (
          <div className={styles.sheetActions}>
            <Button variant="secondary" size="md" onClick={onManage}>
              Manage usuals
            </Button>
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
