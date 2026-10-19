import { useId, useState, type FormEvent } from 'react';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { PermissionPrimer } from '@/components/PermissionPrimer/PermissionPrimer';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import { Toggle } from '@/components/ui/Toggle';
import { guessPlaceType, type LatLng } from '@/db/logging';
import { addPlace, cleanPlaceName, type AddedPlace } from '@/db/places';
import type { PlaceType } from '@/domain/types';
import { LOCATION_FAILED, LOCATION_PRIMER, useHereNow } from './location';
import { PLACE_TYPE_OPTIONS } from './placeModel';
import styles from './Places.module.css';

export interface NewPlaceSheetProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fills the name (what was typed in the search). */
  initialName?: string;
  onSaved: (result: AddedPlace) => void;
}

/** S21 "+ New place": name, type and, if you're there, the Place's own spot. */
export function NewPlaceSheet({ open, onClose, initialName = '', onSaved }: NewPlaceSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxHeight="92%">
      <SheetTitle>New place</SheetTitle>
      <NewPlaceForm initialName={initialName} onSaved={onSaved} onCancel={onClose} />
    </BottomSheet>
  );
}

type HereStatus = 'off' | 'locating' | 'found' | 'failed';

function NewPlaceForm({ initialName, onSaved, onCancel }: { initialName: string; onSaved: (result: AddedPlace) => void; onCancel: () => void }) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<PlaceType>(() => guessPlaceType(initialName));
  const [typeTouched, setTypeTouched] = useState(false);
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [hereStatus, setHereStatus] = useState<HereStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const here = useHereNow(
    (at) => {
      setCoords(at);
      setHereStatus('found');
    },
    () => {
      setCoords(null);
      setHereStatus('failed');
    },
  );
  const useHere = hereStatus === 'locating' || hereStatus === 'found' || here.state !== 'idle';

  const onName = (value: string) => {
    setName(value);
    setError(null);
    // Until a type is picked, it follows the name ("Mamak Ali" → Mamak).
    if (!typeTouched) setType(guessPlaceType(value));
  };

  const onHereToggle = (on: boolean) => {
    if (!on) {
      setCoords(null);
      setHereStatus('off');
      return;
    }
    setHereStatus('locating');
    here.ask();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    const clean = cleanPlaceName(name);
    if (!clean) {
      setError('Give it a name');
      return;
    }
    setSaving(true);
    try {
      onSaved(await addPlace(clean, type, coords ?? undefined));
    } catch {
      setSaving(false);
      setError("Couldn't save this Place. Try again.");
    }
  };

  const hereSub =
    hereStatus === 'found'
      ? 'Got it. Only this spot is saved.'
      : hereStatus === 'failed'
        ? LOCATION_FAILED
        : hereStatus === 'locating' && here.state === 'locating'
          ? 'Finding where you are…'
          : 'If you’re there now, Log can pick this Place next time.';

  return (
    <form className={styles.sheetBody} noValidate onSubmit={(e) => void submit(e)}>
      <div className={styles.field}>
        <label htmlFor={`${id}-name`} className={styles.fieldLabel}>
          Name
        </label>
        <input
          id={`${id}-name`}
          className={[styles.input, error ? styles.inputInvalid : ''].filter(Boolean).join(' ')}
          type="text"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          maxLength={60}
          placeholder="Kedai near the office"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onName(e.target.value)}
          autoFocus
        />
        {error ? (
          <p id={`${id}-error`} className={styles.fieldError}>
            {error}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel} aria-hidden="true">
          Type
        </span>
        <ChipGroup
          kind="portion"
          label="Type of place"
          options={PLACE_TYPE_OPTIONS}
          selectedIndex={PLACE_TYPE_OPTIONS.findIndex((o) => o.value === type)}
          getLabel={(o) => o.label}
          onSelect={(i) => {
            const option = PLACE_TYPE_OPTIONS[i];
            if (!option) return;
            setType(option.value);
            setTypeTouched(true);
          }}
        />
      </div>

      {here.available ? (
        here.state === 'primer' ? (
          <PermissionPrimer
            kind="location"
            title={LOCATION_PRIMER.title}
            body={LOCATION_PRIMER.body}
            allowLabel={LOCATION_PRIMER.allowLabel}
            onAllow={here.allow}
            onNotNow={() => {
              here.notNow();
              setHereStatus('off');
            }}
          />
        ) : (
          <div className={styles.toggleRow}>
            <span className={styles.toggleText}>
              <span className={styles.toggleLabel} aria-hidden="true">
                Use where I am now
              </span>
              <span className={hereStatus === 'failed' ? styles.toggleSubWarn : styles.toggleSub} aria-live="polite">
                {hereSub}
              </span>
            </span>
            <Toggle checked={useHere} onChange={onHereToggle} label="Use where I am now" />
          </div>
        )
      ) : null}

      <Button type="submit" disabled={saving || here.state !== 'idle'}>
        Save place
      </Button>
      <Button variant="ghost" size="md" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
