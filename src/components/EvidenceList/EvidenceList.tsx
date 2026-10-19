import { MealRow } from '@/components/MealRow/MealRow';
import styles from './EvidenceList.module.css';

export interface EvidenceDayBar {
  /** Day letter, "M". */
  label: string;
  /** kcal that day from the meals behind the insight. */
  kcal: number;
}

export interface EvidenceItem {
  /** Meal id (opens the entry). */
  id: string;
  /** Group heading: "Mon 5 Oct". */
  dayLabel: string;
  slotLabel: string;
  timeLabel: string;
  placeName?: string;
  /** "Teh tarik · Kurang" or the meal name. */
  name: string;
  /** Pre-formatted: "~140". */
  kcalLabel: string;
}

export interface EvidenceListProps {
  /** "11 drinks last week · ~2,170 kcal". */
  summary: string;
  bars?: EvidenceDayBar[];
  /** Screen-reader summary of the bars, e.g. "Drinks by day: most on Saturday". */
  barsLabel?: string;
  items: EvidenceItem[];
  onOpen?: (id: string) => void;
  /** Shown when there are no items. */
  emptyText?: string;
}

/** Minimum visible stub for a day with nothing, so the week still reads as 7 days. */
const STUB_PCT = 4;

/** Mini bar chart of evidence kcal by day. */
export function EvidenceBars({ bars, label }: { bars: EvidenceDayBar[]; label: string }) {
  const max = Math.max(1, ...bars.map((b) => b.kcal));
  return (
    <div className={styles.bars} role="img" aria-label={label}>
      <div className={styles.chart}>
        {bars.map((bar, i) => (
          <div key={i} className={styles.col}>
            <div
              className={[styles.bar, bar.kcal > 0 ? '' : styles.empty].filter(Boolean).join(' ')}
              style={{ height: `${bar.kcal > 0 ? Math.max(STUB_PCT * 2, (bar.kcal / max) * 100) : STUB_PCT}%` }}
            />
          </div>
        ))}
      </div>
      <div className={styles.letters} aria-hidden="true">
        {bars.map((bar, i) => (
          <span key={i}>{bar.label}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * @design C42 EvidenceSheet content — a summary line, an optional mini chart by day and the
 * MealRows behind an insight, grouped by day.
 */
export function EvidenceList({ summary, bars, barsLabel, items, onOpen, emptyText = 'No meals behind this one yet.' }: EvidenceListProps) {
  const groups: { dayLabel: string; items: EvidenceItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.dayLabel === item.dayLabel) last.items.push(item);
    else groups.push({ dayLabel: item.dayLabel, items: [item] });
  }
  return (
    <div className={styles.root}>
      <p className={styles.summary}>{summary}</p>
      {bars && bars.length > 0 ? <EvidenceBars bars={bars} label={barsLabel ?? summary} /> : null}
      {groups.length === 0 ? <p className={styles.emptyText}>{emptyText}</p> : null}
      {groups.map((group) => (
        <section key={group.dayLabel} className={styles.group} aria-label={group.dayLabel}>
          <h3 className={styles.day}>{group.dayLabel}</h3>
          <div className={styles.rows}>
            {group.items.map((item, i) => (
              <MealRow
                key={`${item.id}-${i}`}
                slotLabel={item.slotLabel}
                timeLabel={item.timeLabel}
                placeName={item.placeName}
                name={item.name}
                kcalLabel={item.kcalLabel}
                animateIn={false}
                onPress={() => onOpen?.(item.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
