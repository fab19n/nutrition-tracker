import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { useSheet } from '@/app/navigation';
import { SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { OneOffBonus, type OneOffBonusValue } from '@/components/OneOffBonus/OneOffBonus';
import { Button } from '@/components/ui/Button';
import { addBonus, deleteBonus } from '@/db/actions';
import { useWeekBudget } from '@/db/hooks';
import { compareDays } from '@/domain/day';
import { fmtInt, fmtSigned } from '@/domain/format';
import { useUiStore } from '@/state/ui';
import { shortfallLine, soFarRange, targetsBreakdown, targetsTotal } from '@/screens/Today/budgetText';
import styles from './BudgetSheet.module.css';

type Tone = 'good' | 'over' | 'muted' | undefined;

function Row({ label, sub, value, tone, total }: { label: string; sub?: string; value: string; tone?: Tone; total?: boolean }) {
  return (
    <div className={[styles.row, total ? styles.total : ''].filter(Boolean).join(' ')}>
      <dt className={styles.label}>
        {label}
        {sub ? <span className={styles.sub}> {sub}</span> : null}
      </dt>
      <dd className={[styles.value, tone ? styles[tone] : ''].filter(Boolean).join(' ')}>{value}</dd>
    </div>
  );
}

function plus(n: number): string {
  return n < 0 ? fmtInt(n) : `+${fmtInt(n)}`;
}

/** @design S17 Budget breakdown — the week's maths in plain words, the makan day and a one-off bonus. */
export default function BudgetSheet(_props: { close: () => void }) {
  const view = useWeekBudget();
  const { open } = useSheet();
  const showToast = useUiStore((s) => s.showToast);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  if (!view) {
    return (
      <>
        <SheetTitle className={styles.title}>This week&apos;s budget</SheetTitle>
        <div className={styles.placeholder} role="status">
          <span className="sr-only">Loading the budget</span>
        </div>
      </>
    );
  }

  const { budget, days, dailyMinimumKcal, goal } = view;
  const paused = goal.template === 'pause';
  const saved = budget.savedKcal;
  const left = budget.leftThisWeekKcal;
  const planned = budget.makanDay && compareDays(budget.makanDay, budget.today) >= 0 ? budget.makanDay : undefined;
  const shortfall = shortfallLine(budget, dailyMinimumKcal);

  // OneOffBonus (C52) checks the amount (1–3,000 kcal) and the reason; this saves it to today.
  const submitBonus = async ({ kcal, reason }: OneOffBonusValue) => {
    if (saving) return;
    setSaving(true);
    try {
      const bonus = await addBonus(kcal, reason);
      showToast(`Bonus added · +${fmtInt(bonus.kcal)} kcal today`, () => void deleteBonus(bonus.id));
      setBonusOpen(false);
    } catch {
      showToast("Couldn't add the bonus. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SheetTitle className={styles.title}>This week&apos;s budget</SheetTitle>

      <dl className={styles.rows}>
        <Row label="Weekly budget" sub={targetsBreakdown(days)} value={fmtInt(targetsTotal(days))} />
        <Row label="Workouts added" value={plus(budget.workoutsKcal)} />
        {budget.bonusKcal > 0 ? <Row label="One-off bonus" value={plus(budget.bonusKcal)} /> : null}
        <Row label="Eaten so far" sub={soFarRange(budget.weekStart, budget.today)} value={fmtInt(budget.eatenSoFarKcal)} />
        <Row
          label="Saved from finished days"
          value={fmtSigned(saved)}
          tone={saved > 0 ? 'good' : saved < 0 ? 'over' : undefined}
        />
        {budget.pendingSavedKcal > 0 ? (
          <Row label="Waiting for check-in" sub="saved once confirmed" value={fmtSigned(budget.pendingSavedKcal)} tone="muted" />
        ) : null}
        <Row label="Left this week" value={fmtInt(left)} tone={left < 0 ? 'over' : undefined} total />
      </dl>

      <p className={styles.explain}>
        {paused
          ? 'Your budget is off for now. Logging is optional, and these days stay out of trends.'
          : `Unspent calories from finished days are saved for later in the week. Each week starts fresh on Monday. No day goes below your ${fmtInt(dailyMinimumKcal)} minimum.`}
        {!paused && budget.pendingSavedKcal > 0 ? " Savings from a day you haven't confirmed are added once you confirm it." : null}
      </p>
      {shortfall ? <p className={[styles.explain, styles.shortfall].join(' ')}>{shortfall}</p> : null}

      {paused ? null : (
        <Button className={styles.makan} onClick={() => open('makan')}>
          {planned ? 'Change makan day' : 'Plan a makan day'}
        </Button>
      )}

      <div className={styles.bonus}>
        <button
          type="button"
          className={styles.bonusToggle}
          aria-expanded={bonusOpen}
          aria-controls={formId}
          onClick={() => setBonusOpen((v) => !v)}
        >
          <span>One-off bonus today</span>
          <span className={styles.bonusAction}>
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" /> kcal
          </span>
        </button>
      </div>
      {bonusOpen ? <OneOffBonus id={formId} className={styles.bonusForm} busy={saving} autoFocus onSubmit={(b) => void submitBonus(b)} /> : null}
    </>
  );
}
