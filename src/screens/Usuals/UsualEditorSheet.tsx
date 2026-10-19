import { useId, useState, type FormEvent } from 'react';
import { AddItemRow } from '@/components/AddItemRow/AddItemRow';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ReviewItemRow } from '@/components/ReviewItemRow/ReviewItemRow';
import { Button } from '@/components/ui/Button';
import { defaultMealName } from '@/db/actions';
import { USUAL_NAME_MAX } from '@/db/usuals';
import { fmtApprox, roundTo10 } from '@/domain/format';
import { itemMacros, selectVariant } from '@/domain/meal';
import type { MealItem, Usual } from '@/domain/types';
import { ItemSearchSheet } from '@/screens/Log/ItemSearchSheet';
import type { LibraryContext } from '@/screens/Log/library';
import { usualTotalLabel } from './usualsModel';
import styles from './UsualsScreen.module.css';

export interface UsualEditorValue {
  name: string;
  items: MealItem[];
}

export interface UsualEditorSheetProps {
  open: boolean;
  /** The Usual being edited; leave out for "+ New Usual". */
  usual?: Usual;
  /** Library for "+ Add item": your corrections and the catalogue, with the Usual's Place applied. */
  ctx: LibraryContext;
  onClose: () => void;
  /** Rejects when the save failed; the sheet stays open. */
  onSave: (value: UsualEditorValue) => Promise<void>;
}

/** Name placeholder: what the items would be called, or an example. */
const EXAMPLE_NAME = 'Roti canai + teh tarik';

/** S23 Edit / New Usual: a name, the items with their chips, + Add item, Save. */
export function UsualEditorSheet({ open, usual, ctx, onClose, onSave }: UsualEditorSheetProps) {
  const title = usual ? 'Edit Usual' : 'New Usual';
  return (
    <BottomSheet open={open} onClose={onClose} title={title} maxHeight="92%">
      <SheetTitle>{title}</SheetTitle>
      <EditorBody key={usual?.id ?? 'new'} usual={usual} ctx={ctx} onSave={onSave} />
    </BottomSheet>
  );
}

/** An answered chip closes the item's open question. */
function answered(item: MealItem): MealItem {
  if (item.question === undefined) return item;
  const { question: _question, ...rest } = item;
  return rest;
}

function EditorBody({ usual, ctx, onSave }: Pick<UsualEditorSheetProps, 'usual' | 'ctx' | 'onSave'>) {
  const nameId = useId();
  const hintId = useId();
  const [name, setName] = useState(usual?.name ?? '');
  const [items, setItems] = useState<MealItem[]>(() => usual?.items.map((i) => ({ ...i, unitMacros: { ...i.unitMacros } })) ?? []);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const canSave = items.length > 0 && !saving;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim() || defaultMealName(items), items });
    } catch {
      setSaving(false);
    }
  };

  const update = (index: number, item: MealItem) => setItems((list) => list.map((it, i) => (i === index ? item : it)));
  const remove = (index: number) => setItems((list) => list.filter((_, i) => i !== index));

  return (
    <>
      <form className={styles.editor} onSubmit={(e) => void submit(e)} noValidate>
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.fieldLabel}>
            Name
          </label>
          <input
            id={nameId}
            className={styles.input}
            type="text"
            value={name}
            maxLength={USUAL_NAME_MAX}
            autoComplete="off"
            autoCapitalize="sentences"
            enterKeyHint="done"
            autoFocus={!usual}
            placeholder={items.length > 0 ? defaultMealName(items) : EXAMPLE_NAME}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <h3 className={['t-section', styles.itemsHeading].join(' ')}>Items</h3>
        <div className={styles.editorItems}>
          {items.length === 0 ? <p className={styles.editorEmpty}>Add what you usually have.</p> : null}
          {items.map((item, index) => (
            <ReviewItemRow
              key={item.id}
              item={item}
              kcalLabel={fmtApprox(roundTo10(itemMacros(item).kcal))}
              onSelectVariant={(i) => update(index, answered(selectVariant(item, i)))}
              onRemove={() => remove(index)}
              pendingReason="unavailable"
            />
          ))}
          <AddItemRow onAdd={() => setSearching(true)} />
        </div>

        {items.length > 0 ? (
          <p className={styles.editorTotal}>
            Best guess <b>{usualTotalLabel(items)}</b>
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={!canSave} aria-describedby={items.length === 0 ? hintId : undefined}>
          Save
        </Button>
        {items.length === 0 ? (
          <p id={hintId} className={styles.editorHint}>
            Add at least one item to save.
          </p>
        ) : null}
      </form>

      <ItemSearchSheet
        open={searching}
        onClose={() => setSearching(false)}
        title="Add an item"
        ctx={ctx}
        onPick={(picked) => {
          setItems((list) => [...list, ...picked]);
          setSearching(false);
        }}
      />
    </>
  );
}
