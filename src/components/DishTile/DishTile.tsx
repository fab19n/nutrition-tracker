import type { ReactNode } from 'react';
import styles from './DishTile.module.css';

export type DishCount = 0 | 1 | 2;

/** A tap cycles 0 → 1 → 2 → 0. */
export function nextDishCount(count: DishCount): DishCount {
  return count === 0 ? 1 : count === 1 ? 2 : 0;
}

export interface DishTileProps {
  /** Sentence case: "Ayam masak merah". */
  name: string;
  /** Pre-formatted per-unit estimate: "~250". */
  kcalLabel: string;
  /** "a piece", "a scoop", "an egg". */
  unit: string;
  count: DishCount;
  /** Shows "Picked often" while the tile is not selected. */
  often?: boolean;
  /** The parent advances the count (see nextDishCount). */
  onTap: () => void;
}

/**
 * Economy-rice tray dish in the plate builder. Tap to add, tap again for 2, a third tap clears.
 * @design C27
 */
export function DishTile({ name, kcalLabel, unit, count, often, onTap }: DishTileProps) {
  const selected = count > 0;
  const perUnit = `${kcalLabel} ${unit}`;
  // Screen readers say "tilde" for "~", so the label spells it out.
  const spoken = `${kcalLabel.replace(/^~/, 'about ')} kcal ${unit}`;
  const label = [name, spoken, selected ? `${count} on your plate` : often ? 'picked often' : null]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      type="button"
      className={[styles.tile, selected ? styles.selected : ''].join(' ')}
      aria-pressed={selected}
      aria-label={label}
      onClick={onTap}
    >
      <span className={styles.name}>{name}</span>
      <span className={styles.kcal}>{perUnit}</span>
      {selected ? (
        <span className={styles.badge} aria-hidden="true">
          ×{count}
        </span>
      ) : often ? (
        <span className={styles.often}>Picked often</span>
      ) : null}
    </button>
  );
}

export interface DishGridProps {
  children: ReactNode;
  /** Accessible name, e.g. "Protein". */
  label?: string;
}

/** Two-column grid of DishTiles, gap 8. */
export function DishGrid({ children, label }: DishGridProps) {
  return (
    <div role="group" aria-label={label} className={styles.grid}>
      {children}
    </div>
  );
}
