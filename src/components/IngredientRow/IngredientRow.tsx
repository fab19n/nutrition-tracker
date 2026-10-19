import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { SourceTag } from '@/components/SourceTag/SourceTag';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/Chip';
import { fmtApprox, fmtInt, roundTo10 } from '@/domain/format';
import type { PotIngredient } from '@/domain/types';
import styles from './IngredientRow.module.css';

export const AI_GUESS_NOTE = 'Not in the catalogue. A rough guess you can edit.';

/** What the editor hands back. `kcal` is only there when the kcal field was changed. */
export interface IngredientEdit {
  name: string;
  amount: string;
  kcal?: number;
}

/** "2,150" → 2150; undefined for anything that isn't a whole, non-negative number. */
export function parseKcalInput(text: string): number | undefined {
  const cleaned = text.replace(/[,\s~]/g, '').replace(/kcal$/i, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** The editor's result, given what it started with: kcal only when it changed. */
export function editResult(start: { name: string; amount: string; kcal: string }, now: { name: string; amount: string; kcal: string }): IngredientEdit {
  const edit: IngredientEdit = { name: now.name.trim(), amount: now.amount.trim() };
  const kcal = parseKcalInput(now.kcal);
  if (kcal !== undefined && now.kcal.trim() !== start.kcal.trim()) edit.kcal = kcal;
  return edit;
}

export interface OilChips {
  /** Tablespoon choices, 2 / 4 / 6. */
  choices: readonly number[];
  /** The selected tablespoons; none selected when it's not one of the choices. */
  selected: number | undefined;
  onSelect: (tbsp: number) => void;
}

export interface IngredientRowProps {
  ingredient: PotIngredient;
  /** Pot detail (S28): no edit, remove or chips. */
  readOnly?: boolean;
  /** Opens with the editor showing (a just-added ingredient). */
  defaultEditing?: boolean;
  onSave?: (edit: IngredientEdit) => void;
  /** Cancel in the editor (a blank new row can go away). */
  onCancel?: () => void;
  onRemove?: () => void;
  /** Oil rows: the spoon chips. */
  oil?: OilChips;
  /** Move focus into the editor when it opens (off for static previews). */
  focusOnOpen?: boolean;
}

/**
 * One ingredient of a pot: name, amount, ~kcal and its source. Editable rows have Edit and
 * Remove; the editor sets the name, amount and kcal. The oil row adds spoon chips (2 / 4 / 6 tbsp).
 * An AI guess gets the amber ring and a note.
 * @design C39 IngredientRow
 */
export function IngredientRow({
  ingredient,
  readOnly = false,
  defaultEditing = false,
  onSave,
  onCancel,
  onRemove,
  oil,
  focusOnOpen = true,
}: IngredientRowProps) {
  const id = useId();
  const [editing, setEditing] = useState(defaultEditing && !readOnly);
  const start = useRef({ name: ingredient.name, amount: ingredient.amount, kcal: String(Math.round(ingredient.macros.kcal)) });
  const [name, setName] = useState(ingredient.name);
  const [amount, setAmount] = useState(ingredient.amount);
  const [kcal, setKcal] = useState(start.current.kcal);
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    editButton.current?.focus();
  }, [editing]);

  const label = ingredient.name || 'New ingredient';
  const guess = ingredient.source === 'aiGuess';
  const kcalText = fmtApprox(roundTo10(ingredient.macros.kcal));

  const openEditor = () => {
    start.current = { name: ingredient.name, amount: ingredient.amount, kcal: String(Math.round(ingredient.macros.kcal)) };
    setName(start.current.name);
    setAmount(start.current.amount);
    setKcal(start.current.kcal);
    setEditing(true);
  };

  const closeEditor = () => {
    // Back to the Edit button, so keyboard users keep their place.
    returnFocus.current = true;
    setEditing(false);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave?.(editResult(start.current, { name, amount, kcal }));
    closeEditor();
  };

  const cancel = () => {
    onCancel?.();
    closeEditor();
  };

  if (editing) {
    const kcalInvalid = kcal.trim() !== '' && parseKcalInput(kcal) === undefined;
    return (
      <Card radius="card" padding="12px 14px" ring="accent" className={styles.row}>
        <form className={styles.editor} onSubmit={submit} noValidate aria-label={`Edit ${label}`}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Ingredient</span>
            <input
              className={styles.input}
              value={name}
              placeholder="Kentang"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              autoFocus={focusOnOpen}
            />
          </label>
          <div className={styles.pair}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Amount</span>
              <input className={styles.input} value={amount} placeholder="3 biji" autoComplete="off" onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>kcal</span>
              <input
                className={[styles.input, kcalInvalid ? styles.invalid : ''].filter(Boolean).join(' ')}
                value={kcal}
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={kcalInvalid ? true : undefined}
                aria-describedby={kcalInvalid ? `${id}-kcal` : undefined}
                onChange={(e) => setKcal(e.target.value)}
              />
            </label>
          </div>
          {kcalInvalid ? (
            <p id={`${id}-kcal`} className={styles.error}>
              Enter kcal as a number, like 350
            </p>
          ) : (
            <p className={styles.hint}>Change the amount and kcal follows. Or set the kcal yourself.</p>
          )}
          <div className={styles.actions}>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={kcalInvalid}>
              Done
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card radius="card" padding="12px 14px" ring={guess ? 'amberThin' : null} className={styles.row}>
      <div className={styles.header}>
        <span className={styles.name}>
          {label}
          <SourceTag source={ingredient.source} className={styles.tag} />
        </span>
        <span className={styles.end}>
          <span className={styles.kcal}>
            {kcalText}
            <span className="sr-only"> kcal</span>
          </span>
          {!readOnly && onSave ? (
            <button ref={editButton} type="button" className={styles.iconButton} aria-label={`Edit ${label}`} onClick={openEditor}>
              <Pencil size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          {!readOnly && onRemove ? (
            <button type="button" className={styles.iconButton} aria-label={`Remove ${label}`} onClick={onRemove}>
              <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </div>
      {ingredient.amount ? <p className={styles.amount}>{ingredient.amount}</p> : !readOnly ? <p className={styles.amount}>No amount yet</p> : null}
      {guess && !readOnly ? <p className={styles.note}>{AI_GUESS_NOTE}</p> : null}
      {ingredient.isOil && oil && !readOnly ? (
        <div className={styles.chips}>
          <ChipGroup
            kind="portion"
            label={`${label} amount`}
            options={oil.choices}
            selectedIndex={oil.selected === undefined ? -1 : oil.choices.indexOf(oil.selected)}
            getLabel={(tbsp) => `${fmtInt(tbsp)} tbsp`}
            onSelect={(index) => {
              const tbsp = oil.choices[index];
              if (tbsp !== undefined) oil.onSelect(tbsp);
            }}
          />
        </div>
      ) : null}
    </Card>
  );
}
