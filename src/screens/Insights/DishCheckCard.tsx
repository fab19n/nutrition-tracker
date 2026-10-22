import { useNavigate } from 'react-router';
import { ListChecks } from 'lucide-react';
import { PATHS } from '@/app/paths';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { DishCheckStatus } from '@/db/dishCheck';
import { cardCopy } from './dishCheckModel';
import { useDishCheckActions } from './useDishCheckActions';
import styles from './DishCheckCard.module.css';

/**
 * @design S34 entry — "Check your top dishes" on Insights, under the weekly review. Quiet: Start (or
 * Continue) opens the check, Not now hides the card for 4 weeks. The Unlock list keeps a way back.
 */
export function DishCheckCard({ status }: { status: DishCheckStatus }) {
  const navigate = useNavigate();
  const { dismiss, busy } = useDishCheckActions();
  const copy = cardCopy(status);
  if (!copy) return null;
  return (
    <Card radius="card" padding="14px 16px" className={styles.card}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <ListChecks size={20} strokeWidth={2} />
        </span>
        <div className={styles.text}>
          <h2 className={['t-insight', styles.title].join(' ')}>{copy.title}</h2>
          <p className={styles.body}>{copy.body}</p>
        </div>
      </div>
      <div className={styles.actions}>
        <Button size="sm" onClick={() => navigate(PATHS.dishes)}>
          {copy.primaryLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy()} onClick={() => void dismiss()}>
          Not now
        </Button>
      </div>
    </Card>
  );
}
