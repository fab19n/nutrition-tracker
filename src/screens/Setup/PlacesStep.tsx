import { useId, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { SetupStep } from '@/components/SetupStep/SetupStep';
import { ChipGroup } from '@/components/ui/Chip';
import { PLACE_TYPES, newPlaceDraft, type PlaceDraft, type StepProps } from './draft';
import styles from './Setup.module.css';

const MAX_PLACES = 6;

function PlaceCard({
  place,
  onChange,
  onRemove,
  inputRef,
}: {
  place: PlaceDraft;
  onChange: (patch: Partial<PlaceDraft>) => void;
  onRemove: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const id = useId();
  const typeIndex = PLACE_TYPES.findIndex((t) => t.type === place.type);
  return (
    <section className={styles.placeCard} aria-labelledby={`${id}-role`}>
      <div className={styles.placeHeader}>
        <label id={`${id}-role`} htmlFor={`${id}-name`} className={styles.fieldLabel}>
          {place.role}
        </label>
        <button type="button" className={styles.iconButton} aria-label={`Remove ${place.name.trim() || place.role}`} onClick={onRemove}>
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <input
        ref={inputRef}
        id={`${id}-name`}
        className={styles.placeInput}
        type="text"
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="next"
        maxLength={60}
        placeholder={place.placeholder}
        value={place.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <ChipGroup
        kind="portion"
        label={`Type of place: ${place.role}`}
        options={PLACE_TYPES}
        selectedIndex={typeIndex}
        getLabel={(t) => t.label}
        onSelect={(i) => {
          const option = PLACE_TYPES[i];
          if (option) onChange({ type: option.type });
        }}
      />
    </section>
  );
}

/** S06 Your main Places: Home pre-added, your mamak, your economy-rice stall, each with a type. */
export function PlacesStep({ step, total, draft, update, onNext, onBack }: StepProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const named = draft.places.filter((p) => p.name.trim()).length;

  const change = (key: string, patch: Partial<PlaceDraft>) =>
    update({ places: draft.places.map((p) => (p.key === key ? { ...p, ...patch } : p)) });

  const remove = (key: string) => update({ places: draft.places.filter((p) => p.key !== key) });

  const add = () => {
    const place = newPlaceDraft();
    update({ places: [...draft.places, place] });
    // Focus the new name field once it renders.
    requestAnimationFrame(() => inputs.current.get(place.key)?.focus());
  };

  return (
    <SetupStep
      step={step}
      total={total}
      title="Your main Places"
      helper="Add the 2–3 places you eat at most. Location is set later, when you're there."
      onNext={onNext}
      onBack={onBack}
    >
      <div className={styles.stack}>
        {draft.places.map((p) => (
          <PlaceCard
            key={p.key}
            place={p}
            onChange={(patch) => change(p.key, patch)}
            onRemove={() => remove(p.key)}
            inputRef={(el) => {
              if (el) inputs.current.set(p.key, el);
              else inputs.current.delete(p.key);
            }}
          />
        ))}
        {draft.places.length < MAX_PLACES ? (
          <button type="button" className={styles.addRow} onClick={add}>
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
            Add another place
          </button>
        ) : null}
      </div>
      <p className={styles.caption} aria-live="polite">
        {named === 0 ? 'No Places yet. They also appear as you log.' : 'Places without a name are skipped.'}
      </p>
    </SetupStep>
  );
}
