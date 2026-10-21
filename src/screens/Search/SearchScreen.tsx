import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router';
import { ChevronRight, MapPin, Search, X } from 'lucide-react';
import { goBack } from '@/app/history';
import { useSheet } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SearchField } from '@/components/ItemSearch/SearchField';
import { MealRow } from '@/components/MealRow/MealRow';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { MEAL_SLOTS, SLOT_LABEL } from '@/components/SlotPicker/slots';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Chip, ChipGroup } from '@/components/ui/Chip';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { usePhotoUrl } from '@/db/diary';
import { useProfile, useToday } from '@/db/hooks';
import { useSearchIndex } from '@/db/search';
import { DEFAULT_TZ } from '@/domain/day';
import { fmtApprox, fmtRm, fmtTime, roundTo10 } from '@/domain/format';
import {
  groupByDay,
  isEmptyQuery,
  matchNote,
  oftenLogged,
  parseQuery,
  searchMeals,
  type MealSearchEntry,
  type ParsedQuery,
} from '@/domain/search';
import type { Id, MealSlot } from '@/domain/types';
import { diaryDayPath } from '@/screens/Diary/diaryModel';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
  cleanQuery,
  countLabel,
  dayHeading,
  forgetSearchView,
  noResultsCopy,
  parseSearchParams,
  peekSearchView,
  rememberSearchView,
  shownCaption,
  showMoreLabel,
  withSearchView,
  type SearchView,
} from './searchModel';
import styles from './Search.module.css';

/** "All", then each slot; the first option clears the slot filter. */
const SLOT_OPTIONS: readonly (MealSlot | undefined)[] = [undefined, ...MEAL_SLOTS];

interface SearchResultRowProps {
  entry: MealSearchEntry;
  parsed: ParsedQuery;
  tz: string;
  onOpen: (id: Id) => void;
}

/** One result: the Diary's MealRow, read-only (no swipe actions, timing tag or sync badge). */
function SearchResultRow({ entry, parsed, tz, onOpen }: SearchResultRowProps) {
  const thumbUrl = usePhotoUrl(entry.photoId);
  return (
    <MealRow
      slotLabel={SLOT_LABEL[entry.slot]}
      timeLabel={fmtTime(entry.eatenAt, tz)}
      placeName={entry.placeName}
      priceLabel={entry.priceRm !== undefined ? fmtRm(entry.priceRm) : undefined}
      name={entry.name}
      note={matchNote(entry, parsed)}
      kcalLabel={fmtApprox(roundTo10(entry.kcal))}
      thumbUrl={thumbUrl}
      finished={entry.finished}
      isGuess={entry.isGuess}
      animateIn={false}
      onPress={() => onOpen(entry.id)}
    />
  );
}

/** @design S49 Search — find any meal by name, item or Place; newest first, grouped by day. */
export default function SearchScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseSearchParams(params), [params]);
  const sheet = useSheet();

  const profile = useProfile();
  const today = useToday();
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const index = useSearchIndex();

  // Decided once: every commit is a replace, which gives the location a new key, so a Search opened directly would
  // turn from "Back to Diary" into a Back with nothing before it.
  const [hasHistory] = useState(() => location.key !== 'default');
  // Coming back from a meal or a day (POP to the same address) puts the list as it was.
  const [restored] = useState(() => peekSearchView(location.search, navigationType));
  // The keyboard opens for a fresh search, not over results returned to.
  const [autoFocus] = useState(() => view.q === '' && !restored);

  // draft is the text box; view.q is what the results use.
  const [draft, setDraft] = useState(view.q);
  const lastCommitted = useRef(view.q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The committed search lives in the address, written with replace: typing never grows history.
  const commit = (next: SearchView) => {
    clearTimeout(timer.current);
    lastCommitted.current = next.q;
    const nextParams = withSearchView(params, next);
    if (nextParams.toString() === params.toString()) return;
    setParams(nextParams, { replace: true, preventScrollReset: true });
  };
  // The debounce timer must see the latest view and params (a filter tapped meanwhile, an open sheet).
  const commitRef = useRef(commit);
  const viewRef = useRef(view);
  useEffect(() => {
    commitRef.current = commit;
    viewRef.current = view;
  });

  const onDraft = (value: string) => {
    setDraft(value);
    clearTimeout(timer.current);
    const q = cleanQuery(value);
    if (q === '') commit({ ...view, q: '' });
    else timer.current = setTimeout(() => commitRef.current({ ...viewRef.current, q }), SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // The address changed from outside (Back, Forward, a deep link): the box follows. Our own commits set lastCommitted first.
  useEffect(() => {
    if (view.q !== lastCommitted.current) {
      lastCommitted.current = view.q;
      setDraft(view.q);
    }
  }, [view.q]);

  const viewKey = `${view.q}|${view.slot ?? ''}|${view.placeId ?? ''}`;
  const [more, setMore] = useState<{ key: string; shown: number }>(() => ({ key: viewKey, shown: restored?.shown ?? SEARCH_PAGE_SIZE }));
  // A changed query or filter falls back to the first page without an effect.
  const shown = more.key === viewKey ? more.shown : SEARCH_PAGE_SIZE;

  const parsed = useMemo(() => parseQuery(view.q), [view.q]);
  const matches = useMemo(
    () => (index ? searchMeals(index, parsed, { slot: view.slot, placeId: view.placeId }) : undefined),
    [index, parsed, view.slot, view.placeId],
  );
  const browsing = !isEmptyQuery(parsed) || view.slot !== undefined || view.placeId !== undefined;
  const often = useMemo(() => (index ? oftenLogged(index) : undefined), [index]);
  const placeLabel = useMemo(
    () => (view.placeId ? (index?.find((e) => e.placeId === view.placeId)?.placeName ?? 'This Place') : undefined),
    [index, view.placeId],
  );

  useEffect(() => {
    forgetSearchView();
  }, []);
  // Once the rows exist, back to where the list was (ScrollRestoration ran earlier, on the short page, and clamped).
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (!restored || !matches || scrolled.current) return;
    scrolled.current = true;
    window.scrollTo(0, restored.scrollY);
  }, [restored, matches]);

  const remember = () => rememberSearchView({ search: location.search, shown, scrollY: window.scrollY });
  const openMeal = (id: Id) => {
    remember();
    void navigate(PATHS.entry(id));
  };

  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.diary, { replace: true }));
  const total = matches?.length ?? 0;
  const groups = matches ? groupByDay(matches.slice(0, shown)) : [];

  const pickSlot = (i: number) => commit({ ...view, q: cleanQuery(draft), slot: SLOT_OPTIONS[i] });
  const pickText = (text: string) => {
    setDraft(text);
    commit({ ...view, q: text });
  };
  const clearFilters = () => commit({ ...view, q: cleanQuery(draft), slot: undefined, placeId: undefined });

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Search" onBack={back} backLabel={hasHistory ? 'Back' : 'Back to Diary'} />

      {index === undefined ? (
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading your meals" />
        </div>
      ) : index.length === 0 ? (
        <div className={styles.block}>
          <h2 className="sr-only">Search</h2>
          <EmptyState
            icon={<Search />}
            headline="Nothing to search yet"
            body="Meals you log can be found here by name, item or Place."
            actionLabel="Log a meal"
            onAction={() => sheet.open('log')}
          />
        </div>
      ) : (
        <>
          <div className={styles.controls}>
            <SearchField
              value={draft}
              onChange={onDraft}
              onEnter={(query) => {
                commit({ ...view, q: cleanQuery(query) });
                // Closes the keyboard, so the results have the room.
                (document.activeElement as HTMLElement | null)?.blur();
              }}
              label="Search your diary"
              placeholder="Dish, drink or Place"
              autoFocus={autoFocus}
            />
            <div className={styles.filters}>
              <ChipGroup
                kind="portion"
                label="Meal slot"
                options={SLOT_OPTIONS}
                selectedIndex={view.slot ? MEAL_SLOTS.indexOf(view.slot) + 1 : 0}
                getLabel={(slot) => (slot ? SLOT_LABEL[slot] : 'All')}
                onSelect={pickSlot}
              />
              {placeLabel ? (
                <Chip
                  kind="place"
                  className={styles.placeFilter}
                  icon={<MapPin size={16} strokeWidth={2} />}
                  aria-label={`${placeLabel}, remove Place filter`}
                  onClick={() => commit({ ...view, q: cleanQuery(draft), placeId: undefined })}
                >
                  <span className={styles.placeName}>{placeLabel}</span>
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </Chip>
              ) : null}
            </div>
          </div>

          {!browsing ? (
            <>
              <p className={styles.hint}>Search by dish, drink or Place. Spacing and capitals don&apos;t matter.</p>
              {often && often.items.length > 0 ? (
                <>
                  <SectionHeading>Often logged</SectionHeading>
                  <div className={styles.suggest}>
                    {often.items.map((s) => (
                      <Chip key={s.label} kind="context" onClick={() => pickText(s.label)}>
                        {s.label}
                      </Chip>
                    ))}
                  </div>
                </>
              ) : null}
              {often && often.places.length > 0 ? (
                <>
                  <SectionHeading>Places</SectionHeading>
                  <div className={styles.suggest}>
                    {often.places.map((s) => (
                      <Chip
                        key={s.placeId}
                        kind="context"
                        icon={<MapPin size={16} strokeWidth={2} />}
                        onClick={() => commit({ ...view, q: cleanQuery(draft), placeId: s.placeId })}
                      >
                        {s.label}
                      </Chip>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : total === 0 ? (
            <div className={styles.block}>
              <h2 className="sr-only">Results</h2>
              <EmptyState icon={<Search />} {...noResultsCopy(view)} onAction={clearFilters} />
            </div>
          ) : (
            <>
              <p className={styles.count} role="status">
                {countLabel(total)}
              </p>
              {groups.map((group) => {
                const heading = dayHeading(group.day, today);
                return (
                  <section key={group.day} aria-labelledby={`search-day-${group.day}`}>
                    <h2 id={`search-day-${group.day}`} className={`t-section ${styles.dayHeading}`}>
                      <Link className={styles.dayLink} to={diaryDayPath(group.day, today)} aria-label={`Open ${heading} in the Diary`} onClick={remember}>
                        {heading}
                        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                      </Link>
                    </h2>
                    <ul className={styles.list}>
                      {group.entries.map((entry) => (
                        <li key={entry.id}>
                          <SearchResultRow entry={entry} parsed={parsed} tz={tz} onOpen={openMeal} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {total > shown ? (
                <div className={styles.more}>
                  <p className={styles.moreCaption}>{shownCaption(shown, total)}</p>
                  <Button variant="secondary" size="md" onClick={() => setMore({ key: viewKey, shown: shown + SEARCH_PAGE_SIZE })}>
                    {showMoreLabel(total - shown)}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
