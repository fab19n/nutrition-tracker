import { fmtInt } from '@/domain/format';
import styles from './CategoryBar.module.css';

export interface CategoryBarProps {
  /** "Rice dishes", "Drinks". */
  name: string;
  /** Share of the week's calories, 0–100. */
  pct: number;
  /** The category an insight is about: bold name and an accent fill. */
  highlighted?: boolean;
  className?: string;
}

/** @design C14 CategoryBar — name, share and a thin bar. */
export function CategoryBar({ name, pct, highlighted, className }: CategoryBarProps) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className={[styles.row, highlighted ? styles.highlighted : '', className].filter(Boolean).join(' ')}>
      <div className={styles.text}>
        <span className={styles.name}>{name}</span>
        <span className={styles.pct}>{fmtInt(pct)}%</span>
      </div>
      <div className={styles.track} aria-hidden="true">
        <div className={styles.fill} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export interface CategoryListProps {
  items: CategoryBarProps[];
  /** Accessible name of the list, e.g. "Where it came from". */
  label?: string;
  className?: string;
}

/** @design C14 CategoryBar list — the "Where it came from" card. */
export function CategoryList({ items, label, className }: CategoryListProps) {
  return (
    <ul className={[styles.list, className].filter(Boolean).join(' ')} aria-label={label}>
      {items.map((item) => (
        <li key={item.name}>
          <CategoryBar {...item} />
        </li>
      ))}
    </ul>
  );
}
