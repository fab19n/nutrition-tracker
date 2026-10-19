import { useLocation, useNavigate } from 'react-router';
import { CookingPot, Plus, Repeat } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PotCard } from '@/components/PotCard/PotCard';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { usePots, useToday } from '@/db/hooks';
import { logPotServings, potServingKcal, potState, useSavedRecipes, type SavedRecipe } from '@/db/pots';
import { fmtInt } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import type { LogicalDay, Pot } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { clearsText, cookAgainPath, cookedText, kcalText, servingToast } from './potModel';
import styles from './Pots.module.css';

function RecipeRow({ recipe, today, onCookAgain }: { recipe: SavedRecipe; today: LogicalDay; onCookAgain: () => void }) {
  return (
    <li className={styles.recipe}>
      <div className={styles.recipeText}>
        <h3 className={styles.recipeName}>{recipe.name}</h3>
        <p className={styles.recipeDetail}>
          {fmtInt(recipe.servings)} servings · {kcalText(recipe.kcalPerServing)} kcal a serving · {cookedText(recipe.cookedOn, today)}
        </p>
      </div>
      <Button variant="secondary" size="sm" icon={<Repeat size={16} strokeWidth={2} />} aria-label={`Cook ${recipe.name} again`} onClick={onCookAgain}>
        Cook again
      </Button>
    </li>
  );
}

/** @design S26 Pots list — active pots (C38) with Log 1 serving, saved recipes with Cook again, and New pot. */
export default function PotsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useUiStore((s) => s.showToast);
  const today = useToday();
  const pots = usePots();
  const recipes = useSavedRecipes();
  // One serving per tap: a double tap while the first save runs is ignored.
  const inFlight = useInFlight();

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.more, { replace: true }));

  const logOne = (pot: Pot) =>
    inFlight.run(pot.id, async () => {
      try {
        const result = await logPotServings(pot.id, Math.min(1, pot.servingsLeft));
        showToast(servingToast(mealMacros(result.meal).kcal, result.pot.servingsLeft), () => {
          void result.undo();
        });
      } catch {
        showToast("Couldn't log that serving. Try again.");
      }
    });

  const loading = pots === undefined || recipes === undefined;
  const empty = !loading && pots.length === 0 && recipes.length === 0;

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Pots" onBack={back} backLabel={hasHistory ? 'Back' : 'Back to More'} />

      {loading ? (
        <div className={styles.block}>
          <SkeletonList count={2} label="Loading your pots" />
        </div>
      ) : empty ? (
        <div className={styles.block}>
          <EmptyState
            icon={<CookingPot />}
            headline="Cooked a big pot?"
            body="Type the recipe once and log servings in one tap."
            actionLabel="New pot"
            onAction={() => navigate(PATHS.potNew)}
          />
        </div>
      ) : (
        <>
          <SectionHeading>Active pots</SectionHeading>
          {pots.length > 0 ? (
            <ul className={styles.cards}>
              {pots.map((pot) => {
                const state = potState(pot, today);
                return (
                  <li key={pot.id}>
                    <PotCard
                      name={pot.name}
                      servings={pot.servings}
                      servingsLeft={pot.servingsLeft}
                      kcalPerServing={potServingKcal(pot)}
                      state={state}
                      clearsText={clearsText(state, pot.expiresOn, today)}
                      busy={inFlight.busy(pot.id)}
                      onLog={() => void logOne(pot)}
                      onOpen={() => navigate(PATHS.pot(pot.id))}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <Card radius="card" padding="14px 16px" dashed className={styles.none}>
              Nothing in the fridge right now. Cook a saved recipe again, or start a new pot.
            </Card>
          )}

          {recipes.length > 0 ? (
            <>
              <SectionHeading>Saved recipes</SectionHeading>
              <Card radius="card" padding="4px 14px" className={styles.listCard}>
                <ul className={styles.list}>
                  {recipes.map((recipe) => (
                    <RecipeRow key={recipe.potId} recipe={recipe} today={today} onCookAgain={() => navigate(cookAgainPath(recipe.potId))} />
                  ))}
                </ul>
              </Card>
            </>
          ) : null}
        </>
      )}

      {!loading && !empty ? (
        <div className={styles.footer}>
          <Button icon={<Plus size={18} strokeWidth={2} />} onClick={() => navigate(PATHS.potNew)}>
            New pot
          </Button>
        </div>
      ) : null}
    </div>
  );
}
