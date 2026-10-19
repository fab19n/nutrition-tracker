import styles from './RecurringRow.module.css';

export interface RecurringRowProps {
  /** "Teh tarik". */
  name: string;
  /** Pre-formatted: "~8 a week". */
  frequencyLabel: string;
  /** Pre-formatted: "≈ 1,450". */
  kcalLabel: string;
  className?: string;
}

/** @design C43 RecurringRow — item, how often, kcal a week. */
export function RecurringRow({ name, frequencyLabel, kcalLabel, className }: RecurringRowProps) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      <span className={styles.name}>
        {name} <span className={styles.frequency}>· {frequencyLabel}</span>
      </span>
      <b className={styles.kcal}>
        {kcalLabel}
        <span className="sr-only"> kcal a week</span>
      </b>
    </div>
  );
}

export interface RecurringListProps {
  items: (RecurringRowProps & { key?: string })[];
  /** Accessible name of the list, e.g. "Recurring calories". */
  label?: string;
  className?: string;
}

/** @design C43 RecurringRow list — the "Recurring calories" card, hairlines between rows. */
export function RecurringList({ items, label, className }: RecurringListProps) {
  return (
    <ul className={[styles.list, className].filter(Boolean).join(' ')} aria-label={label}>
      {items.map(({ key, ...item }) => (
        <li key={key ?? item.name} className={styles.item}>
          <RecurringRow {...item} />
        </li>
      ))}
    </ul>
  );
}
