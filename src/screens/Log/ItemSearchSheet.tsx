import { useMemo, useState } from 'react';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ItemSearch } from '@/components/ItemSearch/ItemSearch';
import { fmtApprox, roundTo10 } from '@/domain/format';
import type { MealItem } from '@/domain/types';
import { customItems, searchLibrary, type LibraryContext } from './library';
import styles from './MealContextChips.module.css';

export interface ItemSearchSheetProps {
  open: boolean;
  onClose: () => void;
  /** "Add an item", "Swap item", "Pick from your library". */
  title: string;
  ctx: LibraryContext;
  /** The picked items (a Usual brings all of its items). */
  onPick: (items: MealItem[]) => void;
  initialQuery?: string;
}

/** ItemSearch (C21) in a nested sheet, over your corrections, Usuals and the catalogue. */
export function ItemSearchSheet({ open, onClose, title, ctx, onPick, initialQuery }: ItemSearchSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title} maxHeight="92%">
      <SheetTitle>{title}</SheetTitle>
      <div className={styles.sheetBody}>
        <SearchBody ctx={ctx} onPick={onPick} initialQuery={initialQuery ?? ''} />
      </div>
    </BottomSheet>
  );
}

function SearchBody({ ctx, onPick, initialQuery }: { ctx: LibraryContext; onPick: (items: MealItem[]) => void; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const found = useMemo(() => searchLibrary(query, ctx), [query, ctx]);
  return (
    <ItemSearch
      query={query}
      onQuery={setQuery}
      autoFocus
      results={found.map((r) => ({ id: r.id, name: r.name, detail: r.detail, kcalLabel: fmtApprox(roundTo10(r.kcal)) }))}
      onPick={(id) => {
        const picked = found.find((r) => r.id === id);
        if (picked) onPick(picked.build());
      }}
      onCustom={(name) => {
        const items = customItems(name, ctx);
        if (items.length > 0) onPick(items);
      }}
    />
  );
}
