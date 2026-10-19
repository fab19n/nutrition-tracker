import type { LucideIcon } from 'lucide-react';
import { ChevronRight, Coffee, House, MapPin, Soup, Store, Utensils } from 'lucide-react';
import { PLACE_TYPE_LABEL } from '@/components/PlacePicker/PlacePicker';
import { Pill } from '@/components/ui/Pill';
import type { PlaceType } from '@/domain/types';
import styles from './PlaceCard.module.css';

const TYPE_ICON: Record<PlaceType, LucideIcon> = {
  mamak: Store,
  economyRice: Utensils,
  kopitiam: Coffee,
  hawker: Soup,
  home: House,
  other: MapPin,
};

/** "Mamak", "Economy rice", "Kopitiam", "Hawker", "Home", "Other". */
export function placeTypeLabel(type: PlaceType): string {
  return PLACE_TYPE_LABEL[type];
}

export interface PlaceTypePillProps {
  type: PlaceType;
  className?: string;
}

/** @design C34 type pill — the Place's kind as a word with its icon (Mamak, Economy rice…). */
export function PlaceTypePill({ type, className }: PlaceTypePillProps) {
  const Icon = TYPE_ICON[type];
  return (
    <Pill tone="neutral" size="md" icon={<Icon size={12} strokeWidth={2} />} className={className}>
      {placeTypeLabel(type)}
    </Pill>
  );
}

export interface PlaceCardProps {
  /** "Nasi kandar near home". */
  name: string;
  type: PlaceType;
  /** Pre-formatted: "14 visits", "No visits yet". */
  visitsLabel: string;
  /** Pre-formatted average kcal of a meal here: "~920". Leave out without visits. */
  avgLabel?: string;
  /** Pre-formatted average kcal of a meal anywhere else: "~640" (shown as "vs ~640"). */
  elsewhereLabel?: string;
  /** Pre-formatted: "RM 58.00 this week". */
  spendLabel?: string;
  /** Fewer than 3 visits: shows "Learning". */
  learning?: boolean;
  onPress: () => void;
  className?: string;
}

/**
 * @design C34 PlaceCard — name, type pill, visits and spend, with the average meal here against
 * elsewhere on the right. The whole card is one button (opens S22).
 */
export function PlaceCard({ name, type, visitsLabel, avgLabel, elsewhereLabel, spendLabel, learning, onPress, className }: PlaceCardProps) {
  return (
    <button type="button" className={[styles.card, className].filter(Boolean).join(' ')} onClick={onPress}>
      <span className={styles.main}>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>
          <PlaceTypePill type={type} />
          {learning ? (
            <Pill tone="accent" size="md">
              Learning
            </Pill>
          ) : null}
          <span className={styles.caption}>{visitsLabel}</span>
        </span>
        {spendLabel ? <span className={styles.caption}>{spendLabel}</span> : null}
      </span>
      {avgLabel ? (
        <span className={styles.avg}>
          <span className={styles.avgValue}>
            {avgLabel}
            <span className="sr-only"> kcal a meal</span>
          </span>
          {elsewhereLabel ? (
            <span className={styles.elsewhere}>
              vs {elsewhereLabel}
              <span className="sr-only"> elsewhere</span>
            </span>
          ) : null}
        </span>
      ) : null}
      <ChevronRight size={18} strokeWidth={2} className={styles.chevron} aria-hidden="true" />
    </button>
  );
}
