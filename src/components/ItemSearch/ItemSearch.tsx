import { Plus } from 'lucide-react';
import { MatchList } from '@/components/MatchList/MatchList';
import { SearchField } from './SearchField';
import styles from './ItemSearch.module.css';

export interface ItemSearchResult {
  id: string;
  name: string;
  /** "Catalogue", "your correction", "a piece". */
  detail?: string;
  /** Pre-formatted estimate, e.g. "~300". */
  kcalLabel: string;
}

export interface ItemSearchProps {
  query: string;
  onQuery: (query: string) => void;
  results: readonly ItemSearchResult[];
  onPick: (id: string) => void;
  /** Offers "Add 'X'" for something the library doesn't have (it becomes an AI guess). */
  onCustom?: (name: string) => void;
  /** Accessible name of the search box. */
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Sheet body for "+ Add item" and swapping an item on Review: search the library, pick a
 * result, or add what was typed. Enter picks the top result (or adds the text when nothing matches).
 * @design C21
 */
export function ItemSearch({
  query,
  onQuery,
  results,
  onPick,
  onCustom,
  label = 'Search food',
  placeholder = 'Search your library',
  autoFocus,
}: ItemSearchProps) {
  const q = query.trim();
  const hasExact = results.some((r) => r.name.toLocaleLowerCase() === q.toLocaleLowerCase());

  const onEnter = () => {
    const first = results[0];
    if (first) onPick(first.id);
    else if (q && onCustom) onCustom(q);
  };

  return (
    <div className={styles.body}>
      <SearchField
        value={query}
        onChange={onQuery}
        label={label}
        placeholder={placeholder}
        onEnter={onEnter}
        autoFocus={autoFocus}
      />
      <MatchList
        label="Results"
        rows={results.map((r) => ({ ...r, onPick: () => onPick(r.id) }))}
      />
      {q && results.length === 0 ? <p className={styles.empty}>No matches in your library</p> : null}
      {q && onCustom && !hasExact ? (
        <button type="button" className={styles.custom} onClick={() => onCustom(q)}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" className={styles.customIcon} />
          <span className={styles.customText}>
            <span className={styles.customLabel}>Add '{q}'</span>
            <span className={styles.customDetail}>Not in your library yet</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}
