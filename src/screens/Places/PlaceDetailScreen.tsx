import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { MapPin, Pencil, SearchX, Trash2 } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { AddItemRow } from '@/components/AddItemRow/AddItemRow';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ItemSearch } from '@/components/ItemSearch/ItemSearch';
import { LearnedDefaultList, LearnedDefaultRow } from '@/components/LearnedDefaultRow/LearnedDefaultRow';
import { MetricRow, MetricTile } from '@/components/MetricTile/MetricTile';
import { PermissionPrimer } from '@/components/PermissionPrimer/PermissionPrimer';
import { PlaceTypePill } from '@/components/PlaceCard/PlaceCard';
import { PortionChips } from '@/components/PortionChips/PortionChips';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { ChipGroup } from '@/components/ui/Chip';
import { Pill } from '@/components/ui/Pill';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Toggle } from '@/components/ui/Toggle';
import { UsualOrderList, UsualOrderRow } from '@/components/UsualOrderRow/UsualOrderRow';
import { byId, defaultVariantOf, normaliseName, trayDishes } from '@/data/catalogue';
import { usePots, useProfile, useToday } from '@/db/hooks';
import type { LatLng, OrderOption } from '@/db/logging';
import {
  PlaceNameTakenError,
  addPlaceTray,
  changeLearnedDefault,
  cleanPlaceName,
  deletePlace,
  logPotServingHere,
  removeLearnedDefault,
  removePlaceTray,
  setPlaceCoords,
  setPlaceOil,
  setPlaceTypicalPrice,
  updatePlaceDetails,
  usePlaceDetail,
  type LearnedDefault,
  type PlaceDetail,
} from '@/db/places';
import { now } from '@/domain/clock';
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ } from '@/domain/day';
import { fmtApprox, fmtInt, fmtRm, roundTo10 } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import { suggestSlot } from '@/domain/timing';
import type { CatalogueItem, Place, PlaceType, Pot } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { orderDraft } from '@/screens/Log/drafts';
import type { MealContext } from '@/screens/Log/mealTime';
import { cleanPriceInput, parsePrice, priceText } from '@/screens/Log/price';
import { useInFlight } from '@/screens/inFlight';
import { servingToast } from '@/screens/Pots/potModel';
import { LOCATION_FAILED, LOCATION_PRIMER, useHereNow } from './location';
import {
  OIL_OPTIONS,
  PLACE_TYPE_OPTIONS,
  avgKcalLabel,
  homeDishLine,
  isLearning,
  learnedValue,
  orderDetailLine,
  orderLoggedToday,
  potLine,
  visitsLine,
} from './placeModel';
import styles from './Places.module.css';

type SheetState = { kind: 'edit' } | { kind: 'price' } | { kind: 'tray' } | { kind: 'learned'; row: LearnedDefault } | null;

const PLATE_GROUP_LABEL: Record<NonNullable<CatalogueItem['plateGroup']>, string> = {
  protein: 'Protein',
  vegetables: 'Vegetables',
  tofuEgg: 'Tofu and egg',
};

function trayKcalLine(food: CatalogueItem): string {
  return `${fmtApprox(roundTo10(defaultVariantOf(food).macros.kcal))} ${food.unit}`;
}

/** Where focus goes once a row leaves a list: a neighbour's button, else the fallback. */
interface FocusRequest<T> {
  ready: (rows: readonly T[]) => boolean;
  /** Accessible name of the button to focus inside the list; none means the fallback. */
  button?: string;
}

/**
 * Keeps keyboard and screen-reader focus on the list after a row goes (Remove, a pot's last
 * serving), as on Usuals: set `.current` before the write, and once `rows` no longer has the row,
 * focus lands on the named button or on `fallback`.
 */
function useFocusAfterRemoval<T>(rows: readonly T[] | undefined, container: RefObject<HTMLElement | null>, fallback: RefObject<HTMLElement | null>) {
  const request = useRef<FocusRequest<T> | null>(null);
  useEffect(() => {
    const pending = request.current;
    if (!pending || !rows || !pending.ready(rows)) return;
    request.current = null;
    const target = pending.button
      ? Array.from(container.current?.querySelectorAll<HTMLElement>('button') ?? []).find((b) => b.getAttribute('aria-label') === pending.button)
      : undefined;
    (target ?? fallback.current)?.focus();
  }, [rows, container, fallback]);
  return request;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function EditPlaceForm({ place, onDone, onCancel }: { place: Place; onDone: () => void; onCancel: () => void }) {
  const id = useId();
  const showToast = useUiStore((s) => s.showToast);
  const [name, setName] = useState(place.name);
  const [type, setType] = useState<PlaceType>(place.type);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    if (!cleanPlaceName(name)) {
      setError('Give it a name');
      return;
    }
    setSaving(true);
    try {
      await updatePlaceDetails(place.id, { name, type });
      showToast('Place updated');
      onDone();
    } catch (err) {
      setSaving(false);
      setError(err instanceof PlaceNameTakenError ? `You already have ${err.existing.name}` : "Couldn't save this. Try again.");
    }
  };

  return (
    <form className={styles.sheetBody} noValidate onSubmit={(e) => void submit(e)}>
      <div className={styles.field}>
        <label htmlFor={`${id}-name`} className={styles.fieldLabel}>
          Name
        </label>
        <input
          id={`${id}-name`}
          className={[styles.input, error ? styles.inputInvalid : ''].filter(Boolean).join(' ')}
          type="text"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          maxLength={60}
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id={`${id}-error`} className={styles.fieldError}>
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel} aria-hidden="true">
          Type
        </span>
        <ChipGroup
          kind="portion"
          label="Type of place"
          options={PLACE_TYPE_OPTIONS}
          selectedIndex={PLACE_TYPE_OPTIONS.findIndex((o) => o.value === type)}
          getLabel={(o) => o.label}
          onSelect={(i) => {
            const option = PLACE_TYPE_OPTIONS[i];
            if (option) setType(option.value);
          }}
        />
      </div>
      <Button type="submit" disabled={saving}>
        Save
      </Button>
      <Button variant="ghost" size="md" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function PriceForm({ place, onDone }: { place: Place; onDone: () => void }) {
  const id = useId();
  const showToast = useUiStore((s) => s.showToast);
  const [text, setText] = useState(() => priceText(place.typicalPriceRm));
  const [error, setError] = useState<string | null>(null);

  const save = async (rm: number | null) => {
    try {
      await setPlaceTypicalPrice(place.id, rm);
      showToast(rm === null ? 'Typical price cleared' : `Typical price ${fmtRm(rm)}`);
      onDone();
    } catch {
      setError('Enter a price like 9.50');
    }
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!text.trim()) {
      void save(null);
      return;
    }
    const rm = parsePrice(text);
    if (rm === undefined || rm <= 0) {
      setError('Enter a price like 9.50');
      return;
    }
    void save(rm);
  };

  return (
    <form className={styles.sheetBody} noValidate onSubmit={submit}>
      <div className={styles.field}>
        <label htmlFor={`${id}-price`} className={styles.fieldLabel}>
          What a meal here usually costs
        </label>
        <span className={[styles.priceWrap, error ? styles.inputInvalid : ''].filter(Boolean).join(' ')}>
          <span className={styles.pricePrefix} aria-hidden="true">
            RM
          </span>
          <input
            id={`${id}-price`}
            className={styles.priceInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              setText(cleanPriceInput(e.target.value));
              setError(null);
            }}
          />
        </span>
        {error ? (
          <p id={`${id}-error`} className={styles.fieldError}>
            {error}
          </p>
        ) : null}
      </div>
      <p className={styles.sheetNote}>It also updates by itself from the prices you log here.</p>
      <Button type="submit">Save</Button>
      {place.typicalPriceRm !== undefined ? (
        <Button variant="ghost" size="md" onClick={() => void save(null)}>
          Clear price
        </Button>
      ) : null}
    </form>
  );
}

function LearnedSheetBody({ row, onPick }: { row: LearnedDefault; onPick: (index: number) => void }) {
  return (
    <div className={styles.sheetBody}>
      <p className={styles.sheetNote}>What you usually get here. New meals here start with it.</p>
      <PortionChips variants={row.variants ?? []} selectedIndex={row.selectedVariant ?? -1} onSelect={onPick} label={`${row.name} here`} />
    </div>
  );
}

function TraySearch({ trays, onPick }: { trays: readonly string[]; onPick: (food: CatalogueItem) => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = normaliseName(query);
    return trayDishes()
      .filter((food) => !trays.includes(food.id))
      .filter((food) => !q || normaliseName(food.name).includes(q) || food.aliases.some((a) => normaliseName(a).includes(q)))
      .slice(0, 12)
      .map((food) => ({
        id: food.id,
        name: food.name,
        detail: `${food.plateGroup ? PLATE_GROUP_LABEL[food.plateGroup] : 'Tray'} · ${food.unit}`,
        kcalLabel: fmtApprox(roundTo10(defaultVariantOf(food).macros.kcal)),
      }));
  }, [query, trays]);
  return (
    <div className={styles.sheetSearch}>
      <ItemSearch
        query={query}
        onQuery={setQuery}
        results={results}
        label="Search tray dishes"
        placeholder="Search tray dishes"
        onPick={(foodId) => {
          const food = byId(foodId);
          if (food) onPick(food);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function potActionLabel(pot: Pick<Pot, 'name'>): string {
  return `Log 1 serving of ${pot.name}`;
}

interface DetailBodyProps {
  detail: PlaceDetail;
  onDelete: (place: Place) => void;
}

function PlaceDetailBody({ detail, onDelete }: DetailBodyProps) {
  const { place, stats, orders, loggedToday, learned, homeDishes } = detail;
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const profile = useProfile();
  const today = useToday();
  const pots = usePots();
  const inFlight = useInFlight();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Trays switched off on this visit stay listed, so a slip can be switched back on.
  const [traysOff, setTraysOff] = useState<string[]>([]);
  const learnedRef = useRef<HTMLDivElement>(null);
  const learnedEmptyRef = useRef<HTMLLIElement>(null);
  const potsRef = useRef<HTMLDivElement>(null);
  const allPotsRef = useRef<HTMLButtonElement>(null);
  const learnedFocus = useFocusAfterRemoval(learned, learnedRef, learnedEmptyRef);
  const potFocus = useFocusAfterRemoval(pots, potsRef, allPotsRef);

  const isHome = place.type === 'home';
  const isEconomyRice = place.type === 'economyRice';
  const learning = isLearning(stats);

  const saveSpot = async (at: LatLng) => {
    const previous = place.coords;
    try {
      await setPlaceCoords(place.id, at);
      // The old spot lives only in this undo, never in storage.
      showToast(previous ? 'Spot updated' : 'Spot saved', () => void setPlaceCoords(place.id, previous ?? null));
    } catch {
      showToast(LOCATION_FAILED);
    }
  };
  const here = useHereNow(
    (at) => void saveSpot(at),
    () => showToast(LOCATION_FAILED),
  );

  const logOrder = (order: OrderOption) => {
    const slot = suggestSlot(now(), profile?.timeZone ?? DEFAULT_TZ, profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR);
    const ctx: MealContext = { placeId: place.id, timeId: 'now', slot, slotTouched: false };
    setReviewDraft({ ...orderDraft(order, ctx), backTo: PATHS.place(place.id) });
    // Review replaces this screen; its Back puts the Place back (ARCHITECTURE §8.1).
    navigate(PATHS.review, { replace: true });
  };

  const logPot = (pot: Pot, list: readonly Pot[]) =>
    inFlight.run(`pot:${pot.id}`, async () => {
      // The last serving takes the pot off the list: focus moves to the next pot or "All pots".
      if (pot.servingsLeft <= 1) {
        const at = list.findIndex((p) => p.id === pot.id);
        const neighbour = list[at + 1] ?? list[at - 1];
        potFocus.current = { ready: (next) => !next.some((p) => p.id === pot.id), ...(neighbour ? { button: potActionLabel(neighbour) } : {}) };
      }
      try {
        // Never more than is left (½ left logs ½): the same meal as from the Pots screens.
        const result = await logPotServingHere(pot.id, place.id);
        showToast(servingToast(mealMacros(result.meal).kcal, result.pot.servingsLeft), () => void result.undo());
      } catch {
        potFocus.current = null;
        showToast("Couldn't log that serving. Try again.");
      }
    });

  const removeLearned = (row: LearnedDefault) =>
    inFlight.run(`learned:${row.key}`, async () => {
      // The row goes: focus moves to the next row's Remove (or the one above, or the empty line).
      const at = learned.findIndex((r) => r.key === row.key);
      const neighbour = learned[at + 1] ?? learned[at - 1];
      learnedFocus.current = { ready: (next) => !next.some((r) => r.key === row.key), ...(neighbour ? { button: `Remove ${neighbour.name}` } : {}) };
      try {
        const undo = await removeLearnedDefault(place.id, row.key);
        showToast(`${row.name} default removed`, () => void undo());
      } catch {
        learnedFocus.current = null;
        showToast("Couldn't remove that. Try again.");
      }
    });

  const changeLearned = (row: LearnedDefault, index: number) =>
    inFlight.run(`learned:${row.key}`, async () => {
      const label = row.variants?.[index]?.label;
      setSheet(null);
      if (index === row.selectedVariant || !label) return;
      const undo = await changeLearnedDefault(place.id, row.key, index);
      showToast(`${row.name} here: ${label}`, () => void undo());
    });

  const trays = place.trays ?? [];
  const trayRows = [...trays, ...traysOff.filter((t) => !trays.includes(t))].flatMap((tid) => {
    const food = byId(tid);
    return food ? [food] : [];
  });
  const toggleTray = async (food: CatalogueItem, on: boolean) => {
    if (on) {
      setTraysOff((off) => off.filter((t) => t !== food.id));
      await addPlaceTray(place.id, food.id);
    } else {
      setTraysOff((off) => (off.includes(food.id) ? off : [...off, food.id]));
      await removePlaceTray(place.id, food.id);
    }
  };
  const addTray = async (food: CatalogueItem) => {
    setSheet(null);
    setTraysOff((off) => off.filter((t) => t !== food.id));
    await addPlaceTray(place.id, food.id);
    showToast(`${food.name} added to the trays here`, () => void removePlaceTray(place.id, food.id));
  };

  const avgHere = avgKcalLabel(stats.avgKcal);
  const avgElsewhere = avgKcalLabel(stats.elsewhereAvgKcal);
  const spendAny = stats.spend30Rm > 0;
  const sheetTitle =
    sheet?.kind === 'edit' ? 'Edit place' : sheet?.kind === 'price' ? 'Typical price' : sheet?.kind === 'tray' ? 'Add a tray dish' : sheet?.kind === 'learned' ? `${sheet.row.name} here` : '';

  return (
    <>
      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <PlaceTypePill type={place.type} />
          {learning ? (
            <Pill tone="accent" size="md">
              Learning your orders
            </Pill>
          ) : null}
        </div>
        <p className={styles.visits}>{visitsLine(stats, today)}</p>
      </div>

      <MetricRow className={styles.tiles}>
        <MetricTile label="Avg here" value={avgHere ?? '—'} sub={avgHere ? 'kcal a meal' : 'no meals yet'} />
        <MetricTile label="Elsewhere" value={avgElsewhere ?? '—'} sub={avgElsewhere ? 'kcal a meal' : 'no meals yet'} />
        <MetricTile
          label="Spend this week"
          value={spendAny ? fmtRm(stats.spendWeekRm) : '—'}
          sub={spendAny ? `${fmtRm(stats.spend30Rm)} in 30 days` : 'no prices yet'}
        />
      </MetricRow>

      <SectionHeading>Your usual orders</SectionHeading>
      {orders.length > 0 ? (
        <div className={styles.listWrap}>
          <UsualOrderList label="Your usual orders">
            {orders.map((order) => (
              <UsualOrderRow
                key={order.id}
                name={order.name}
                detail={orderDetailLine(order)}
                logged={orderLoggedToday(order, loggedToday)}
                onLog={() => logOrder(order)}
              />
            ))}
          </UsualOrderList>
        </div>
      ) : null}
      {orders.length === 0 || learning ? (
        <p className={styles.sectionNote}>
          {/* The "Learning your orders" pill above already says it; this says how. */}
          {learning
            ? 'Have something here twice and it shows up for one-tap logging.'
            : 'Nothing ordered twice here yet. Your usual orders show up once you repeat one.'}
        </p>
      ) : null}

      {isHome ? (
        <>
          <SectionHeading>Pots at home</SectionHeading>
          {pots === undefined ? (
            // Loading isn't "no pots": the empty line waits for the list.
            <div className={styles.listWrap}>
              <SkeletonList count={1} label="Loading pots" />
            </div>
          ) : pots.length > 0 ? (
            <div className={styles.listWrap} ref={potsRef}>
              <UsualOrderList label="Pots at home">
                {pots.map((pot) => (
                  <UsualOrderRow
                    key={pot.id}
                    name={`${pot.name} pot`}
                    detail={potLine(pot, today)}
                    logLabel="Log 1"
                    actionLabel={potActionLabel(pot)}
                    busy={inFlight.busy(`pot:${pot.id}`)}
                    onLog={() => void logPot(pot, pots)}
                  />
                ))}
              </UsualOrderList>
            </div>
          ) : (
            <p className={styles.sectionNote}>No pots in the fridge. Cooked a big pot? Type the recipe once and log servings in one tap.</p>
          )}
          <div className={styles.inlineAction}>
            <button type="button" ref={allPotsRef} className={styles.link} onClick={() => navigate(PATHS.pots)}>
              All pots
            </button>
          </div>

          <SectionHeading>Home-style dishes</SectionHeading>
          {homeDishes.length > 0 ? (
            <div className={styles.listWrap}>
              <UsualOrderList label="Home-style dishes">
                {homeDishes.map((dish) => (
                  <li key={dish.key} className={styles.dishRow}>
                    <span className={styles.dishName}>{dish.name}</span>
                    <span className={styles.dishDetail}>{homeDishLine(dish)}</span>
                  </li>
                ))}
              </UsualOrderList>
            </div>
          ) : (
            <p className={styles.sectionNote}>Family cooking shows up here. Log it like a stall dish, with Home as the Place.</p>
          )}
        </>
      ) : null}

      <SectionHeading>What you&rsquo;ve taught it</SectionHeading>
      <div className={styles.listWrap} ref={learnedRef}>
        <LearnedDefaultList label="What you've taught it">
          {learned.map((row) => (
            <LearnedDefaultRow
              key={row.key}
              label={row.name}
              value={learnedValue(row)}
              onChange={row.variants && row.variants.length > 1 ? () => setSheet({ kind: 'learned', row }) : undefined}
              onRemove={() => void removeLearned(row)}
            />
          ))}
          {learned.length === 0 ? (
            <li className={styles.emptyRow} ref={learnedEmptyRef} tabIndex={-1}>
              Nothing yet. Fix a portion here twice and it asks to make it the default.
            </li>
          ) : null}
          {!isHome ? (
            <li className={styles.controlRow}>
              <span className={styles.controlLabel} aria-hidden="true">
                Oil level
              </span>
              <ChipGroup
                kind="portion"
                label="Oil level here"
                options={OIL_OPTIONS}
                selectedIndex={OIL_OPTIONS.findIndex((o) => o.value === place.oilLevel)}
                getLabel={(o) => o.label}
                onSelect={(i) => {
                  const option = OIL_OPTIONS[i];
                  if (option && option.value !== place.oilLevel) void setPlaceOil(place.id, option.value);
                }}
              />
            </li>
          ) : null}
        </LearnedDefaultList>
      </div>

      <SettingsGroup title="Details">
        <div className={styles.locationRow}>
          <span className={styles.locationText}>
            <span className={styles.locationLabel}>Location</span>
            <span className={styles.locationSub}>
              {!here.available
                ? "Location isn't available on this device"
                : place.coords
                  ? 'Saved here. Log picks this Place within about 150 m.'
                  : "Not saved yet. Tap when you're there."}
            </span>
          </span>
          {here.available ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<MapPin size={16} strokeWidth={2} />}
              disabled={here.state === 'locating'}
              onClick={here.ask}
            >
              {here.state === 'locating' ? 'Finding…' : "I'm here now"}
            </Button>
          ) : null}
        </div>
        <SettingsRow
          label="Typical price"
          sub="From the prices you log here"
          value={place.typicalPriceRm !== undefined ? fmtRm(place.typicalPriceRm) : 'Not set'}
          onPress={() => setSheet({ kind: 'price' })}
        />
      </SettingsGroup>

      {isEconomyRice ? (
        <>
          <SectionHeading>Trays here</SectionHeading>
          <p className={styles.sectionNote}>The plate builder shows these first.</p>
          {trayRows.length > 0 ? (
            <div className={styles.listWrap}>
              <UsualOrderList label="Trays here">
                {trayRows.map((food) => (
                  <li key={food.id} className={styles.controlRow}>
                    <span>
                      <span className={styles.controlLabel}>{food.name}</span>
                      <span className={styles.controlSub}>{trayKcalLine(food)}</span>
                    </span>
                    <Toggle checked={trays.includes(food.id)} onChange={(on) => void toggleTray(food, on)} label={`${food.name} on the trays here`} />
                  </li>
                ))}
              </UsualOrderList>
            </div>
          ) : null}
          <div className={styles.addRow}>
            <AddItemRow label="Add a tray dish" onAdd={() => setSheet({ kind: 'tray' })} />
          </div>
        </>
      ) : null}

      {/* §7.3 S22 ends with edit / delete. */}
      <div className={styles.danger}>
        <Button variant="secondary" size="md" icon={<Pencil size={18} strokeWidth={2} />} onClick={() => setSheet({ kind: 'edit' })}>
          Edit name and type
        </Button>
        <Button variant="ghost" size="md" className={styles.deleteButton} icon={<Trash2 size={18} strokeWidth={2} />} onClick={() => setConfirmDelete(true)}>
          Delete place
        </Button>
      </div>

      <BottomSheet open={sheet !== null} onClose={() => setSheet(null)} maxHeight="92%">
        {sheet ? <SheetTitle>{sheetTitle}</SheetTitle> : null}
        {sheet?.kind === 'edit' ? <EditPlaceForm place={place} onDone={() => setSheet(null)} onCancel={() => setSheet(null)} /> : null}
        {sheet?.kind === 'price' ? <PriceForm place={place} onDone={() => setSheet(null)} /> : null}
        {sheet?.kind === 'learned' ? <LearnedSheetBody row={sheet.row} onPick={(index) => void changeLearned(sheet.row, index)} /> : null}
        {sheet?.kind === 'tray' ? <TraySearch trays={trays} onPick={(food) => void addTray(food)} /> : null}
      </BottomSheet>

      <BottomSheet open={here.state === 'primer'} onClose={here.notNow} title={LOCATION_PRIMER.title}>
        <div className={styles.sheetBody}>
          <PermissionPrimer
            kind="location"
            title={LOCATION_PRIMER.title}
            body={LOCATION_PRIMER.body}
            allowLabel={LOCATION_PRIMER.allowLabel}
            onAllow={here.allow}
            onNotNow={here.notNow}
          />
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${place.name}?`}
        body={`${stats.visits > 0 ? `Its meals stay in your diary without a Place.` : 'Nothing in your diary is lost.'} What it learned here goes with it. You can undo straight after.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete(place);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

/** @design S22 Place detail — visits, here vs elsewhere, usual orders, what it learned, oil, spot, price, trays, edit / delete. */
export default function PlaceDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useUiStore((s) => s.showToast);
  const lookup = usePlaceDetail(id);
  const [leaving, setLeaving] = useState(false);
  const detail = lookup?.detail ?? null;

  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.places, { replace: true }));

  const remove = async (place: Place) => {
    setLeaving(true);
    const deleted = await deletePlace(place.id);
    navigate(PATHS.places, { replace: true });
    if (!deleted) return;
    const meals = deleted.mealsUnlinked;
    showToast(meals > 0 ? `Place deleted · ${fmtInt(meals)} ${meals === 1 ? 'meal' : 'meals'} kept` : 'Place deleted', () => void deleted.undo());
  };

  return (
    <div className={styles.screen}>
      <SubScreenHeader title={detail?.place.name ?? 'Place'} onBack={back} backLabel={hasHistory ? 'Back' : 'Back to Places'} />
      {leaving ? null : lookup === undefined ? (
        <div className={styles.block}>
          <SkeletonList count={3} label="Loading the Place" />
        </div>
      ) : detail ? (
        <PlaceDetailBody detail={detail} onDelete={(place) => void remove(place)} />
      ) : (
        <div className={styles.missing}>
          {/* Keeps the heading levels in order: h1, h2, then the empty state's h3. */}
          <h2 className="sr-only">Place not found</h2>
          <EmptyState
            icon={<SearchX />}
            headline="This Place isn't here"
            body="It may have been deleted. Your meals are still in the diary."
            actionLabel="All places"
            onAction={() => navigate(PATHS.places, { replace: true })}
          />
        </div>
      )}
    </div>
  );
}
