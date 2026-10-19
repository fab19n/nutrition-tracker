import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { CircleCheck, Clock, Repeat, SearchX, Trash2 } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { IngredientRow } from '@/components/IngredientRow/IngredientRow';
import { meterCells, servingsLeftText, servingsText } from '@/components/PotCard/PotCard';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useToday } from '@/db/hooks';
import { LOG_SERVING_CHOICES, deletePot, logPotServings, potServingKcal, potState, usePotLookup } from '@/db/pots';
import { fmtDayShort, fmtInt } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import type { Pot } from '@/domain/types';
import { recipeTotal } from '@/estimate/recipe';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { clearsText, cookAgainPath, kcalText, logLabel, servingToast } from './potModel';
import styles from './Pots.module.css';

/** "Cleared on Sun 18 Oct with 3 of 8 left" / "All 8 servings logged". */
function clearedNote(pot: Pot): string {
  if (pot.servingsLeft <= 0) return `All ${fmtInt(pot.servings)} servings logged. Cook it again to start a new pot.`;
  return `Cleared on ${fmtDayShort(pot.expiresOn)} with ${servingsLeftText(pot.servingsLeft, pot.servings)}. Pots keep for 4 days.`;
}

interface PotDetailProps {
  pot: Pot;
  onDeleted: () => void;
}

function PotDetail({ pot, onDeleted }: PotDetailProps) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const today = useToday();
  const inFlight = useInFlight();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const state = potState(pot, today);
  const cleared = state === 'cleared';
  const perServing = potServingKcal(pot);
  const total = recipeTotal(pot.ingredients).kcal;
  const cells = meterCells(pot.servingsLeft, pot.servings);
  const [half, one, two] = LOG_SERVING_CHOICES;
  const logging = inFlight.busy('log');

  const log = (servings: number) =>
    inFlight.run('log', async () => {
      try {
        const result = await logPotServings(pot.id, servings);
        showToast(servingToast(mealMacros(result.meal).kcal, result.pot.servingsLeft), () => {
          void result.undo();
        });
      } catch {
        showToast("Couldn't log that serving. Try again.");
      }
    });

  const remove = async () => {
    setConfirmDelete(false);
    const undo = await deletePot(pot.id);
    showToast('Pot deleted', () => {
      void undo();
    });
    onDeleted();
  };

  const logButton = (servings: number, variant: 'primary' | 'secondary') => (
    <Button
      variant={variant}
      size={variant === 'primary' ? 'lg' : 'md'}
      disabled={logging || servings > pot.servingsLeft}
      onClick={() => void log(servings)}
    >
      {logLabel(servings)}
    </Button>
  );

  return (
    <>
      <Card radius="lg" padding="18px 20px 16px" className={styles.hero}>
        <p className={styles.heroLabel}>{cleared ? 'Pot' : 'In the fridge'}</p>
        {cleared ? (
          <p className={['t-hero-sheet', styles.heroValue].join(' ')}>Cleared</p>
        ) : (
          <p className={['t-hero-sheet', styles.heroValue].join(' ')} aria-live="polite">
            {servingsText(pot.servingsLeft)} <span className={styles.of}>of {fmtInt(pot.servings)} left</span>
          </p>
        )}
        <p className={styles.heroSub}>
          <b>{kcalText(perServing)} kcal</b> a serving
        </p>
        {cells.length > 0 ? (
          <div className={styles.meter} aria-hidden="true">
            {cells.map((cell, i) => (
              <span key={i} className={[styles.cell, styles[cell]].join(' ')} />
            ))}
          </div>
        ) : null}
        {cleared ? <p className={styles.clearedNote}>{clearedNote(pot)}</p> : null}
      </Card>

      <div className={styles.actions}>
        {cleared ? (
          <Button icon={<Repeat size={18} strokeWidth={2} />} onClick={() => navigate(cookAgainPath(pot.id))}>
            Cook again
          </Button>
        ) : (
          <>
            {one !== undefined ? logButton(one, 'primary') : null}
            <div className={styles.secondary}>
              {half !== undefined ? logButton(half, 'secondary') : null}
              {two !== undefined ? logButton(two, 'secondary') : null}
            </div>
          </>
        )}
      </div>

      <SectionHeading>Ingredients</SectionHeading>
      <ul className={styles.rows}>
        {pot.ingredients.map((ingredient) => (
          <li key={ingredient.id}>
            <IngredientRow ingredient={ingredient} readOnly />
          </li>
        ))}
      </ul>
      <p className={styles.wholePot}>
        Whole pot {kcalText(total)} kcal · {fmtInt(pot.servings)} servings
      </p>

      <p className={[styles.clears, state === 'clearsToday' ? styles.clearsSoon : ''].filter(Boolean).join(' ')}>
        {cleared ? (
          <CircleCheck size={18} strokeWidth={2} aria-hidden="true" className={styles.clearsIcon} />
        ) : (
          <Clock size={18} strokeWidth={2} aria-hidden="true" className={styles.clearsIcon} />
        )}
        {clearsText(state, pot.expiresOn, today)}
        <span>· cooked {fmtDayShort(pot.cookedOn)}</span>
      </p>

      <div className={styles.actions}>
        {!cleared ? (
          <Button variant="secondary" size="md" icon={<Repeat size={18} strokeWidth={2} />} onClick={() => navigate(cookAgainPath(pot.id))}>
            Cook again
          </Button>
        ) : null}
        <Button variant="ghost" size="md" className={styles.delete} icon={<Trash2 size={18} strokeWidth={2} />} onClick={() => setConfirmDelete(true)}>
          Delete pot
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this pot?"
        body={`${pot.name}, ${servingsLeftText(pot.servingsLeft, pot.servings)}. Servings you've logged stay in your diary. You can undo straight after.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

/** @design S28 Pot detail — servings left (large), ~kcal a serving, Log ½ / 1 / 2, ingredients, clears, Cook again, Delete. */
export default function PotDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lookup = usePotLookup(id);
  const pot = lookup?.pot ?? null;

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.pots, { replace: true }));

  return (
    <div className={styles.screen}>
      <SubScreenHeader title={pot?.name ?? 'Pot'} onBack={back} backLabel={hasHistory ? 'Back' : 'Back to Pots'} />
      {lookup === undefined ? (
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading the pot" />
        </div>
      ) : pot ? (
        <PotDetail pot={pot} onDeleted={() => navigate(PATHS.pots, { replace: true })} />
      ) : (
        <div className={styles.block}>
          <EmptyState
            icon={<SearchX />}
            headline="This pot isn't here"
            body="It may have been deleted. Servings you logged are still in your diary."
            actionLabel="Open pots"
            onAction={() => navigate(PATHS.pots, { replace: true })}
          />
        </div>
      )}
    </div>
  );
}
