import { useState, type ReactNode } from 'react';
import { Check, House, MapPin, MapPinOff, Plus, Store } from 'lucide-react';
import { SearchField } from '@/components/ItemSearch/SearchField';
import type { PlaceType } from '@/domain/types';
import styles from './PlacePicker.module.css';

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  mamak: 'Mamak',
  economyRice: 'Economy rice',
  kopitiam: 'Kopitiam',
  hawker: 'Hawker',
  home: 'Home',
  other: 'Other',
};

export interface PlaceOption {
  id: string;
  name: string;
  type: PlaceType;
  /** Within ~150 m of a saved Place. */
  nearby?: boolean;
}

export interface PlacePickerProps {
  /** Any order: nearby ones are grouped first; the rest keep the given (most recent first) order. */
  places: readonly PlaceOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Creates a new Place from the typed name. */
  onCreate: (name: string) => void;
  /** Shows a "No place" row to clear the choice. */
  onClear?: () => void;
  /** Pre-fills the search, e.g. with a name typed in "Where?". */
  initialQuery?: string;
  autoFocus?: boolean;
}

const normalise = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/**
 * Sheet body for choosing where the meal was eaten: search, Nearby and Recent groups, and
 * "Create 'X'" for a new Place.
 * @design C18
 */
export function PlacePicker({ places, selectedId, onSelect, onCreate, onClear, initialQuery = '', autoFocus }: PlacePickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const q = normalise(query);
  const typed = query.trim().replace(/\s+/g, ' ');

  const matches = q ? places.filter((p) => normalise(p.name).includes(q)) : places;
  const exact = q ? places.find((p) => normalise(p.name) === q) : undefined;
  const nearby = matches.filter((p) => p.nearby);
  const recent = matches.filter((p) => !p.nearby);
  const canCreate = q.length > 0 && !exact;

  // Enter: the exact or only match; a new Place when nothing matches; nothing when it's ambiguous.
  const onEnter = () => {
    const pick = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (pick) onSelect(pick.id);
    else if (canCreate && matches.length === 0) onCreate(typed);
  };

  const row = (p: PlaceOption) => (
    <PlaceRow
      key={p.id}
      icon={iconFor(p.type)}
      name={p.name}
      sub={PLACE_TYPE_LABEL[p.type]}
      selected={p.id === selectedId}
      onPress={() => onSelect(p.id)}
    />
  );

  return (
    <div className={styles.body}>
      <SearchField
        value={query}
        onChange={setQuery}
        label="Search places"
        placeholder="Search or add a place"
        onEnter={onEnter}
        autoFocus={autoFocus}
      />

      {canCreate ? (
        <button type="button" className={styles.create} onClick={() => onCreate(typed)}>
          <Plus size={20} strokeWidth={2} aria-hidden="true" />
          Create '{typed}'
        </button>
      ) : null}

      {nearby.length > 0 ? <Group title="Nearby">{nearby.map(row)}</Group> : null}
      {recent.length > 0 ? <Group title={q ? 'Other places' : 'Recent'}>{recent.map(row)}</Group> : null}

      {!q && places.length === 0 ? <p className={styles.empty}>No places yet. Type a name to add one.</p> : null}

      {onClear && !q && places.length > 0 ? (
        <div className={styles.list}>
          <PlaceRow
            icon={<MapPinOff size={20} strokeWidth={2} />}
            name="No place"
            selected={selectedId === undefined}
            onPress={onClear}
          />
        </div>
      ) : null}
    </div>
  );
}

function iconFor(type: PlaceType): ReactNode {
  if (type === 'home') return <House size={20} strokeWidth={2} />;
  if (type === 'other') return <MapPin size={20} strokeWidth={2} />;
  return <Store size={20} strokeWidth={2} />;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group} aria-label={title}>
      <h3 className={`t-section ${styles.heading}`}>{title}</h3>
      <div className={styles.list}>{children}</div>
    </section>
  );
}

interface PlaceRowProps {
  icon: ReactNode;
  name: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
}

function PlaceRow({ icon, name, sub, selected, onPress }: PlaceRowProps) {
  return (
    <button type="button" className={styles.row} aria-pressed={selected} onClick={onPress}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {sub ? <span className={styles.sub}>{sub}</span> : null}
      </span>
      {selected ? <Check size={20} strokeWidth={2} aria-hidden="true" className={styles.check} /> : null}
    </button>
  );
}
