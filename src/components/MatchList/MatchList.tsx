import styles from './MatchList.module.css';

export interface MatchRow {
  id: string;
  name: string;
  /** Muted tail after the name: "your usual here", "your correction", "MyFCD". */
  detail?: string;
  /** Pre-formatted estimate, e.g. "~950". */
  kcalLabel: string;
  onPick: () => void;
}

export interface MatchListProps {
  rows: readonly MatchRow[];
  /** Accessible name for the list. */
  label?: string;
}

/**
 * Instant library matches under the LogInput (no AI): name, muted detail, bold kcal.
 * Also the result list in ItemSearch.
 * @design C16
 */
export function MatchList({ rows, label = 'Matches from your library' }: MatchListProps) {
  if (rows.length === 0) return null;
  return (
    <ul className={styles.list} aria-label={label}>
      {rows.map((r) => (
        <li key={r.id} className={styles.item}>
          <button type="button" className={styles.row} onClick={r.onPick}>
            <span className={styles.text}>
              {r.name}
              {r.detail ? <span className={styles.detail}> · {r.detail}</span> : null}
            </span>
            <span className={styles.kcal}>{r.kcalLabel}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
