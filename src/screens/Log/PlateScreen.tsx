import { useId, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { PATHS } from '@/app/paths';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { DishGrid, DishTile, nextDishCount } from '@/components/DishTile/DishTile';
import { ItemSearch } from '@/components/ItemSearch/ItemSearch';
import { PortionChips } from '@/components/PortionChips/PortionChips';
import { RangeTotal } from '@/components/RangeTotal/RangeTotal';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Card } from '@/components/ui/Card';
import { normaliseName, trayDishes } from '@/data/catalogue';
import { db } from '@/db/db';
import { useNow, useProfile } from '@/db/hooks';
import { NEARBY_METRES, distanceMetres, nearestPlace, setPlaceOilLevel } from '@/db/logging';
import { now } from '@/domain/clock';
import { fmtApprox, fmtKcal, fmtRange, roundTo10 } from '@/domain/format';
import { itemsRange, mealMacros } from '@/domain/meal';
import type { OilLevel, Place } from '@/domain/types';
import { useUiStore, type ReviewMeta } from '@/state/ui';
import { isLogNavState, plateDraft, type LogNavState } from './drafts';
import { useCurrentPosition, usePlateHistory, useRecentPlaces } from './hooks';
import { newItemId } from './library';
import { MealContextChips } from './MealContextChips';
import { slotFor, timeSettings, type MealContext, type TimeSettings } from './mealTime';
import {
  KUAH,
  PLATE_GROUPS,
  RICE,
  defaultSelection,
  gridDishIds,
  groupDishes,
  plateItems,
  selectionFromItems,
  type PlateSelection,
} from './plate';
import { cleanPriceInput, parsePrice, priceText } from './price';
import styles from './PlateScreen.module.css';

const OIL_LEVELS: readonly OilLevel[] = ['low', 'medium', 'high'];
const OIL_LABEL: Record<OilLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function contextFrom(meta: Pick<ReviewMeta, 'placeId' | 'eatenAt' | 'slot' | 'timeFromSlot'>, s: TimeSettings): MealContext {
  const suggested = slotFor(meta.eatenAt, now(), s);
  const ctx: MealContext = {
    timeId: meta.eatenAt ? (meta.timeFromSlot ? 'slot' : 'custom') : 'now',
    slot: meta.slot ?? suggested,
    // A slot time only exists because the slot was picked, so it counts as picked too.
    slotTouched: (meta.eatenAt !== undefined && meta.timeFromSlot === true) || (meta.slot !== undefined && meta.slot !== suggested),
  };
  if (meta.placeId) ctx.placeId = meta.placeId;
  if (meta.eatenAt) ctx.eatenAt = meta.eatenAt;
  return ctx;
}

/** S24 Plate builder (economy rice): rice, tray dishes, kuah, oil and price → Review. */
export default function PlateScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const passed: LogNavState = isLogNavState(location.state) ? location.state : {};
  const profile = useProfile();
  const settings = timeSettings(profile);
  const current = useNow();
  const recent = useRecentPlaces();
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const position = useCurrentPosition(profile?.useLocation === true);
  const priceId = useId();

  // Back from Review: pick the plate up where it was (only then: a plate left behind by the
  // phone's back button on Review doesn't come back on the next Log → Plate).
  const [restored] = useState(() => {
    const draft = useUiStore.getState().reviewDraft;
    return passed.restore === true && draft?.flow === 'plate' ? draft : null;
  });
  const [ctx, setCtx] = useState<MealContext>(() => contextFrom(restored?.meta ?? passed, settings));
  const [placeTouched, setPlaceTouched] = useState(restored !== null);

  const ecoPlaces: Place[] = useMemo(() => (recent?.places ?? []).filter((p) => p.type === 'economyRice'), [recent]);
  const nearby = position ? nearestPlace(ecoPlaces, position) : undefined;
  const nearbyIds = position
    ? ecoPlaces.filter((p) => p.coords && distanceMetres(p.coords, position) <= NEARBY_METRES).map((p) => p.id)
    : [];
  const passedEco = passed.placeId && ecoPlaces.some((p) => p.id === passed.placeId) ? passed.placeId : undefined;
  const autoPlaceId = nearby?.id ?? passedEco ?? ecoPlaces[0]?.id;
  const meal: MealContext = placeTouched || !autoPlaceId ? ctx : { ...ctx, placeId: autoPlaceId };
  const place = meal.placeId ? ecoPlaces.find((p) => p.id === meal.placeId) : undefined;
  const history = usePlateHistory(place?.id);

  const [edited, setEdited] = useState<PlateSelection | null>(() => (restored ? selectionFromItems(restored.items) : null));
  const selection = edited ?? defaultSelection(place, history);
  const change = (patch: Partial<PlateSelection>) => setEdited({ ...selection, ...patch });

  const [priceEdited, setPriceEdited] = useState<string | null>(() => (restored ? priceText(restored.meta.priceRm) : null));
  const price = priceEdited ?? priceText(place?.typicalPriceRm);
  const [localOil, setLocalOil] = useState<OilLevel>('medium');
  const oil = place?.oilLevel ?? localOil;
  const [searching, setSearching] = useState(false);

  const ids = gridDishIds(place, selection);
  const items = plateItems(selection, ids);
  const total = mealMacros({ items, finished: 'all' }).kcal;
  const range = itemsRange(items);
  const often = new Set(history?.often ?? []);
  const riceKcal = RICE.variants[selection.riceIdx]?.macros.kcal ?? 0;
  const kuahKcal = KUAH.variants[selection.kuahIdx]?.macros.kcal ?? 0;

  const cycleOil = () => {
    const next = OIL_LEVELS[(OIL_LEVELS.indexOf(oil) + 1) % OIL_LEVELS.length] ?? 'medium';
    setLocalOil(next);
    if (place) void setPlaceOilLevel(db, place.id, next);
  };

  // Review replaces the plate builder: after a save, the phone's back button from Today never lands
  // on a plate that was already logged (Review's Back brings the plate back). A double tap on
  // Review can't stack two Reviews either.
  const review = () => {
    setReviewDraft(plateDraft(plateItems(selection, ids, newItemId), meal, parsePrice(price)));
    navigate(PATHS.review, { replace: true });
  };

  const back = () => {
    if (restored) useUiStore.getState().clearReviewDraft();
    navigate(PATHS.today, { replace: true });
  };

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Build your plate" onBack={back} />

      <div className={styles.chips}>
        <MealContextChips
          value={meal}
          onChange={setCtx}
          onPlacePicked={() => setPlaceTouched(true)}
          places={ecoPlaces}
          nearbyIds={nearbyIds}
          newPlaceType="economyRice"
          coords={position}
          now={current}
          settings={settings}
        />
      </div>

      <Card radius="card" padding="12px 14px" className={styles.card}>
        <div className={styles.cardHead}>
          <span>Rice</span>
          <span>{fmtApprox(riceKcal)}</span>
        </div>
        <div className={styles.cardChips}>
          <PortionChips variant="plate" label="Rice" variants={RICE.variants} selectedIndex={selection.riceIdx} onSelect={(i) => change({ riceIdx: i })} />
        </div>
      </Card>

      <p className={styles.hint}>Tap a dish to add it, tap again for 2</p>

      {PLATE_GROUPS.map(({ group, label }) => {
        const dishes = groupDishes(ids, group);
        if (dishes.length === 0) return null;
        return (
          <section key={group}>
            <h2 className={`t-section ${styles.group}`}>{label}</h2>
            <div className={styles.grid}>
              <DishGrid label={label}>
                {dishes.map((dish) => {
                  const count = selection.counts[dish.id] ?? 0;
                  const kcal = dish.variants[dish.defaultVariant]?.macros.kcal ?? 0;
                  return (
                    <DishTile
                      key={dish.id}
                      name={dish.name}
                      kcalLabel={fmtApprox(kcal)}
                      unit={dish.unit}
                      count={count}
                      often={often.has(dish.id)}
                      onTap={() => change({ counts: { ...selection.counts, [dish.id]: nextDishCount(count) } })}
                    />
                  );
                })}
              </DishGrid>
            </div>
          </section>
        );
      })}

      <div className={styles.addRow}>
        <button type="button" className={styles.add} onClick={() => setSearching(true)}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          Another dish
        </button>
      </div>

      <Card radius="card" padding="12px 14px" className={styles.card}>
        <div className={styles.cardHead}>
          <span>Kuah on rice</span>
          <span>{fmtApprox(kuahKcal)}</span>
        </div>
        <div className={styles.cardChips}>
          <PortionChips variant="plate" label="Kuah on rice" variants={KUAH.variants} selectedIndex={selection.kuahIdx} onSelect={(i) => change({ kuahIdx: i })} />
        </div>
      </Card>

      <div className={styles.extras}>
        <button
          type="button"
          className={styles.oil}
          onClick={cycleOil}
          aria-label={`Oil here: ${OIL_LABEL[oil]}${place?.oilLevel ? ', remembered' : ''}. Tap to change`}
        >
          <span className={styles.muted}>Oil here</span> <b>{OIL_LABEL[oil]}</b>
          {place?.oilLevel ? <span className={styles.muted}> · remembered</span> : null}
        </button>
        <label className={styles.price} htmlFor={priceId}>
          <span className={styles.muted}>RM</span>
          <input
            id={priceId}
            className={styles.priceInput}
            value={price}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            aria-label="Price in RM"
            onChange={(e) => setPriceEdited(cleanPriceInput(e.target.value))}
          />
        </label>
      </div>

      <RangeTotal totalKcalLabel={fmtKcal(roundTo10(total))} rangeLabel={fmtRange(range)} actionLabel="Review" actionSize="plate" onAction={review} />

      <BottomSheet open={searching} onClose={() => setSearching(false)} title="Another dish" maxHeight="92%">
        <SheetTitle>Another dish</SheetTitle>
        <div className={styles.sheetBody}>
          <DishSearch
            exclude={ids}
            onPick={(id) => {
              change({ extras: [...selection.extras, id], counts: { ...selection.counts, [id]: 1 } });
              setSearching(false);
            }}
          />
        </div>
      </BottomSheet>
    </div>
  );
}

/** Tray dishes this stall's grid doesn't show yet. */
function DishSearch({ exclude, onPick }: { exclude: readonly string[]; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const q = normaliseName(query);
  const results = trayDishes()
    .filter((d) => !exclude.includes(d.id))
    .filter((d) => !q || normaliseName(d.name).includes(q) || d.aliases.some((a) => normaliseName(a).includes(q)))
    .slice(0, 12)
    .map((d) => ({ id: d.id, name: d.name, detail: d.unit, kcalLabel: fmtApprox(d.variants[d.defaultVariant]?.macros.kcal ?? 0) }));
  return <ItemSearch query={query} onQuery={setQuery} results={results} onPick={onPick} label="Search dishes" placeholder="Search tray dishes" autoFocus />;
}
