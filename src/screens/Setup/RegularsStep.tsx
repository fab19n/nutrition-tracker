import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ItemSearch, type ItemSearchResult } from '@/components/ItemSearch/ItemSearch';
import { SetupStep } from '@/components/SetupStep/SetupStep';
import { Chip } from '@/components/ui/Chip';
import { byId, defaultVariantOf, searchCatalogue } from '@/data/catalogue';
import { fmtApprox, roundTo10 } from '@/domain/format';
import { regularKcal, regularOptions, type RegularOption, type StepProps } from './draft';
import styles from './Setup.module.css';

function searchResults(query: string): ItemSearchResult[] {
  return searchCatalogue(query, 8).map((item) => ({
    id: item.id,
    name: item.name,
    detail: item.unit,
    kcalLabel: fmtApprox(roundTo10(defaultVariantOf(item).macros.kcal)),
  }));
}

/** S05 Your regulars: tap common meals to make them Usuals; "+ Add your own" searches the catalogue. */
export function RegularsStep({ step, total, draft, update, onNext, onBack }: StepProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchResults(query), [query]);
  const options = regularOptions(draft);
  const picked = new Set(draft.regulars);

  const toggle = (key: string) => {
    update({ regulars: picked.has(key) ? draft.regulars.filter((k) => k !== key) : [...draft.regulars, key] });
  };

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  const pickFromCatalogue = (catalogueId: string) => {
    const entry = byId(catalogueId);
    if (!entry) return;
    const key = `cat:${catalogueId}`;
    const existing = options.find(
      (o) => o.key === key || (o.foods.length === 1 && o.foods[0]?.catalogueId === catalogueId && o.foods[0].variant === undefined),
    );
    if (existing) {
      if (!picked.has(existing.key)) update({ regulars: [...draft.regulars, existing.key] });
    } else {
      const option: RegularOption = { key, name: entry.name, foods: [{ catalogueId }] };
      update({ customRegulars: [...draft.customRegulars, option], regulars: [...draft.regulars, key] });
    }
    closeSearch();
  };

  const count = picked.size;

  return (
    <>
      <SetupStep
        step={step}
        total={total}
        title="Your regulars"
        helper="Tap what you eat often. Each one becomes a one-tap Usual, so ideas work from day 1."
        onNext={onNext}
        onBack={onBack}
        nextDisabled={count === 0}
        onSkip={count === 0 ? onNext : undefined}
      >
        <div className={styles.chips} role="group" aria-label="Your regulars">
          {options.map((o) => {
            const selected = picked.has(o.key);
            return (
              <Chip
                key={o.key}
                kind="context"
                selected={selected}
                aria-pressed={selected}
                className={styles.regular}
                icon={selected ? <Check size={16} strokeWidth={2} /> : undefined}
                onClick={() => toggle(o.key)}
              >
                {o.name}{' '}
                <span className={styles.regularKcal}>{fmtApprox(regularKcal(o))}</span>
              </Chip>
            );
          })}
          <Chip
            kind="context"
            className={[styles.regular, styles.addRegular].join(' ')}
            icon={<Plus size={16} strokeWidth={2} />}
            onClick={() => setSearching(true)}
          >
            Add your own
          </Chip>
        </div>
        <p className={styles.caption} aria-live="polite">
          {count === 0 ? 'Nothing picked yet. You can add Usuals later too.' : `${count} picked`}
        </p>
      </SetupStep>

      <BottomSheet open={searching} onClose={closeSearch}>
        <SheetTitle>Add your own</SheetTitle>
        <ItemSearch
          query={query}
          onQuery={setQuery}
          results={results}
          onPick={pickFromCatalogue}
          label="Search food"
          placeholder="roti telur, kopi o, mee rebus"
          autoFocus
        />
      </BottomSheet>
    </>
  );
}
