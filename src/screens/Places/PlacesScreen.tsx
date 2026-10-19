import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { MapPin, Plus } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SearchField } from '@/components/ItemSearch/SearchField';
import { PlaceCard } from '@/components/PlaceCard/PlaceCard';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented';
import { filterPlaces, sortPlaces, usePlaceList, type AddedPlace, type PlaceSort } from '@/db/places';
import { useUiStore } from '@/state/ui';
import { NewPlaceSheet } from './NewPlaceSheet';
import { EMPTY_PLACES_COPY, avgKcalLabel, isLearning, spendLabel, visitsShort } from './placeModel';
import styles from './Places.module.css';

const SORT_OPTIONS: readonly SegmentedOption<PlaceSort>[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'visits', label: 'Most visited' },
];

/** @design S21 Places list — search, Recent / Most visited, PlaceCards and "+ New place". */
export default function PlacesScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useUiStore((s) => s.showToast);
  const list = usePlaceList();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PlaceSort>('recent');
  const [creating, setCreating] = useState(false);

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.more, { replace: true }));
  const shown = useMemo(() => (list ? sortPlaces(filterPlaces(list, query), sort) : []), [list, query, sort]);

  const onSaved = ({ place, created }: AddedPlace) => {
    setCreating(false);
    showToast(created ? `Added ${place.name}` : `You already have ${place.name}`);
    navigate(PATHS.place(place.id));
  };

  const newPlaceButton = (
    <div className={styles.newRow}>
      <Button variant="secondary" size="md" icon={<Plus size={18} strokeWidth={2} />} onClick={() => setCreating(true)}>
        New place
      </Button>
    </div>
  );

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Places" onBack={back} backLabel={location.key !== 'default' ? 'Back' : 'Back to More'} />

      {list === undefined ? (
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading your Places" />
        </div>
      ) : list.length === 0 ? (
        <>
          {/* An h2 before the empty state's h3, so heading levels stay in order. */}
          <SectionHeading>Your Places</SectionHeading>
          <div className={styles.listWrap}>
            <EmptyState
              icon={<MapPin />}
              headline="Where you eat, remembered"
              body={EMPTY_PLACES_COPY}
              actionLabel="New place"
              onAction={() => setCreating(true)}
            />
          </div>
        </>
      ) : (
        <>
          <div className={styles.controls}>
            <SearchField value={query} onChange={setQuery} label="Search places" placeholder="Search your Places" />
            <div className={styles.sortRow}>
              <Segmented options={SORT_OPTIONS} value={sort} onChange={setSort} label="Sort places" tone="inset" />
              <span className={styles.window}>Last 30 days</span>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className={styles.note}>No Places match &ldquo;{query.trim()}&rdquo;. Add it as a new place.</p>
          ) : (
            <ul className={styles.cards} aria-label="Your Places">
              {shown.map(({ place, stats }) => (
                <li key={place.id}>
                  <PlaceCard
                    name={place.name}
                    type={place.type}
                    visitsLabel={visitsShort(stats.visits)}
                    avgLabel={avgKcalLabel(stats.avgKcal)}
                    elsewhereLabel={avgKcalLabel(stats.elsewhereAvgKcal)}
                    spendLabel={spendLabel(stats)}
                    learning={isLearning(stats)}
                    onPress={() => navigate(PATHS.place(place.id))}
                  />
                </li>
              ))}
            </ul>
          )}
          {newPlaceButton}
        </>
      )}

      <NewPlaceSheet open={creating} onClose={() => setCreating(false)} initialName={shown.length === 0 ? query.trim() : ''} onSaved={onSaved} />
    </div>
  );
}
