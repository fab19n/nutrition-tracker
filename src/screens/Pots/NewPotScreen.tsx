import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Plus, Scissors } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { IngredientRow, type IngredientEdit } from '@/components/IngredientRow/IngredientRow';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/Chip';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { newId } from '@/db/db';
import { DEFAULT_SERVINGS, SERVING_CHOICES, SERVINGS_LIMIT, createPot, potServingKcal, usePotLookup } from '@/db/pots';
import { fmtInt } from '@/domain/format';
import type { Pot, PotIngredient } from '@/domain/types';
import { OIL_TBSP_CHOICES, kcalPerServing, oilTbsp, recipeTotal, splitRecipe } from '@/estimate/recipe';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { Stepper } from '@/screens/Setup/Stepper';
import { RECIPE_PLACEHOLDER, SPLIT_DELAY_MS, applyIngredientEdit, blankIngredient, kcalText, withOilTbsp } from './potModel';
import styles from './Pots.module.css';

interface Draft {
  name: string;
  recipeText: string;
  /** null until the recipe has been split. */
  ingredients: PotIngredient[] | null;
  servings: number;
}

function draftFrom(pot: Pot | null | undefined): Draft {
  if (!pot) return { name: '', recipeText: '', ingredients: null, servings: DEFAULT_SERVINGS };
  return {
    name: pot.name,
    recipeText: pot.recipeText,
    // Fresh ids: this is a new pot.
    ingredients: pot.ingredients.map((i) => ({ ...i, id: newId(), macros: { ...i.macros } })),
    servings: pot.servings,
  };
}

interface NewPotFormProps {
  initial: Draft;
  /** Cook again: the recipe it came from ("From your Kari ayam recipe"). */
  fromRecipe?: string;
  /** ?recipe= pointed at a pot that isn't there. */
  recipeMissing?: boolean;
}

function NewPotForm({ initial, fromRecipe, recipeMissing }: NewPotFormProps) {
  const id = useId();
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const inFlight = useInFlight();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initial.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [recipeText, setRecipeText] = useState(initial.recipeText);
  const [splitText, setSplitText] = useState<string | null>(initial.ingredients ? initial.recipeText : null);
  const [ingredients, setIngredients] = useState<PotIngredient[] | null>(initial.ingredients);
  const [servings, setServings] = useState(initial.servings);
  const [splitting, setSplitting] = useState(false);
  /** Rows added with "+ Add ingredient" that haven't been named yet. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const split = () => {
    const text = recipeText;
    const title = name;
    if (!text.trim() || splitting) return;
    setSplitting(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // The pot's name tells a pasted title line ("Kari ayam" above the ingredients) from an ingredient.
      setIngredients(splitRecipe(text, { makeId: () => newId(), title }));
      setSplitText(text);
      setFresh(new Set());
      setSplitting(false);
    }, SPLIT_DELAY_MS);
  };

  const replace = (rowId: string, next: PotIngredient | null) => {
    setIngredients((list) => (list ?? []).flatMap((row) => (row.id !== rowId ? [row] : next ? [next] : [])));
  };

  const markOld = (rowId: string) =>
    setFresh((set) => {
      const next = new Set(set);
      next.delete(rowId);
      return next;
    });

  const saveEdit = (row: PotIngredient, edit: IngredientEdit) => {
    replace(row.id, applyIngredientEdit(row, edit, fresh.has(row.id)));
    markOld(row.id);
  };

  const cancelEdit = (row: PotIngredient) => {
    if (fresh.has(row.id) && !row.name) replace(row.id, null);
    markOld(row.id);
  };

  const remove = (row: PotIngredient) => {
    const index = (ingredients ?? []).findIndex((r) => r.id === row.id);
    replace(row.id, null);
    showToast(`Removed ${row.name || 'ingredient'}`, () => {
      setIngredients((list) => {
        if (!list || list.some((r) => r.id === row.id)) return list;
        const next = [...list];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, row);
        return next;
      });
    });
  };

  const add = () => {
    const row = blankIngredient(newId());
    setIngredients((list) => [...(list ?? []), row]);
    setFresh((set) => new Set(set).add(row.id));
  };

  const rows = (ingredients ?? []).filter((row) => row.name.trim().length > 0);
  const total = recipeTotal(rows).kcal;
  const perServing = kcalPerServing(rows, servings);
  const recipeChanged = splitText !== null && recipeText.trim() !== splitText.trim();
  const showSplit = splitText === null || recipeChanged;

  const save = () =>
    inFlight.run('save', async () => {
      if (!name.trim()) {
        setNameError('Name the pot first');
        nameRef.current?.focus();
        return;
      }
      const pot = await createPot({ name, recipeText, ingredients: rows, servings });
      showToast(`Pot saved · ${kcalText(potServingKcal(pot))} kcal a serving`);
      navigate(PATHS.pot(pot.id), { replace: true });
    });

  const nameNoteId = `${id}-name-note`;
  const recipeNoteId = `${id}-recipe-note`;

  return (
    <>
      <div className={styles.form}>
        {fromRecipe ? <p className={styles.hint}>From your {fromRecipe} recipe. Change anything for this pot.</p> : null}
        {recipeMissing ? <p className={styles.hint}>That recipe isn't here any more. Start this one fresh.</p> : null}
        <div className={styles.field}>
          <label htmlFor={`${id}-name`} className={styles.fieldLabel}>
            Name
          </label>
          <input
            ref={nameRef}
            id={`${id}-name`}
            className={[styles.input, nameError ? styles.invalid : ''].filter(Boolean).join(' ')}
            value={name}
            placeholder="Kari ayam"
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? nameNoteId : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError && e.target.value.trim()) setNameError(null);
            }}
          />
          {nameError ? (
            <p id={nameNoteId} className={styles.error}>
              {nameError}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor={`${id}-recipe`} className={styles.fieldLabel}>
            Recipe
          </label>
          <textarea
            id={`${id}-recipe`}
            className={styles.recipeInput}
            value={recipeText}
            placeholder={RECIPE_PLACEHOLDER}
            rows={3}
            aria-describedby={recipeNoteId}
            onChange={(e) => setRecipeText(e.target.value)}
          />
          <p id={recipeNoteId} className={styles.hint}>
            Type it the way you'd text it. Rough amounts are fine.
          </p>
        </div>

        {showSplit ? (
          <Button
            variant={ingredients ? 'secondary' : 'primary'}
            size="md"
            icon={<Scissors size={18} strokeWidth={2} />}
            disabled={!recipeText.trim() || splitting}
            onClick={split}
          >
            {splitText === null ? 'Split into ingredients' : 'Split again'}
          </Button>
        ) : null}
      </div>

      {splitting ? (
        <div className={styles.splitting}>
          <SkeletonList count={4} label="Splitting the recipe" />
          <p className={styles.status} aria-hidden="true">
            Reading the recipe… matching to your library
          </p>
        </div>
      ) : ingredients ? (
        <>
          <SectionHeading>Ingredients</SectionHeading>
          {ingredients.length > 0 ? (
            <ul className={styles.rows}>
              {ingredients.map((row) => (
                <li key={row.id}>
                  <IngredientRow
                    ingredient={row}
                    defaultEditing={fresh.has(row.id)}
                    onSave={(edit) => saveEdit(row, edit)}
                    onCancel={() => cancelEdit(row)}
                    onRemove={() => remove(row)}
                    oil={
                      row.isOil
                        ? {
                            choices: OIL_TBSP_CHOICES,
                            selected: oilTbsp(row),
                            onSelect: (tbsp) => replace(row.id, withOilTbsp(row, tbsp)),
                          }
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Card radius="card" padding="14px 16px" dashed className={styles.unread}>
              No ingredients found in that. Try one per line, like &ldquo;1 tin santan&rdquo;, or add them below.
            </Card>
          )}
          <button type="button" className={styles.addRow} onClick={add}>
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
            Add ingredient
          </button>

          <SectionHeading>Servings</SectionHeading>
          <Card radius="card" padding="14px 16px" className={styles.totals}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Whole pot</span>
              <output className={['t-metric-sm', styles.totalValue].join(' ')} aria-live="polite">
                {kcalText(total)} kcal
              </output>
            </div>
            <div className={styles.servings}>
              <Stepper
                label="Servings"
                sub="How many the pot makes"
                value={servings}
                onChange={setServings}
                min={SERVINGS_LIMIT.min}
                max={SERVINGS_LIMIT.max}
                step={1}
                unit={servings === 1 ? 'serving' : 'servings'}
              />
              <div className={styles.servingChips}>
                <ChipGroup
                  kind="portion"
                  label="Common servings"
                  options={SERVING_CHOICES}
                  selectedIndex={(SERVING_CHOICES as readonly number[]).indexOf(servings)}
                  getLabel={(n) => fmtInt(n)}
                  onSelect={(index) => {
                    const n = SERVING_CHOICES[index];
                    if (n !== undefined) setServings(n);
                  }}
                />
              </div>
            </div>
            <div className={styles.perServing}>
              <output className={['t-metric', styles.perServingValue].join(' ')} aria-live="polite">
                {kcalText(perServing)} kcal a serving
              </output>
              <p className={styles.perServingSub}>
                The whole pot ÷ {fmtInt(servings)}. Log a serving in one tap.
              </p>
            </div>
          </Card>

          <div className={styles.actions}>
            <Button onClick={() => void save()} disabled={rows.length === 0 || inFlight.busy('save')}>
              Save pot
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}

/** @design S27 New pot — name, recipe text, Split into ingredients (C39 rows, oil chips), whole pot, servings and ~kcal a serving. */
export default function NewPotScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const recipeId = params.get('recipe') ?? undefined;
  const recipe = usePotLookup(recipeId);

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.pots, { replace: true }));

  return (
    <div className={styles.screen}>
      <SubScreenHeader title={recipeId ? 'Cook again' : 'New pot'} onBack={back} backLabel={hasHistory ? 'Back' : 'Back to Pots'} />
      {recipeId && recipe === undefined ? (
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading the recipe" />
        </div>
      ) : (
        <NewPotForm
          key={recipeId ?? 'new'}
          initial={draftFrom(recipe?.pot)}
          fromRecipe={recipe?.pot?.name}
          recipeMissing={recipeId !== undefined && recipe?.pot === null}
        />
      )}
    </div>
  );
}
