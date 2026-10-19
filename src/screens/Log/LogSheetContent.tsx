import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { Camera, CookingPot, Repeat, Utensils } from 'lucide-react';
import { useSheet } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { LogInput } from '@/components/LogInput/LogInput';
import { MatchList } from '@/components/MatchList/MatchList';
import { PermissionPrimer } from '@/components/PermissionPrimer/PermissionPrimer';
import { QuickActionRow } from '@/components/QuickActionRow/QuickActionRow';
import { Button } from '@/components/ui/Button';
import { logPotServing } from '@/db/actions';
import { db } from '@/db/db';
import { useNow, usePersonalItems, usePots, useProfile, useUsuals } from '@/db/hooks';
import { NEARBY_METRES, distanceMetres, nearestPlace, setUseLocation, usualOption, type OrderOption } from '@/db/logging';
import { now } from '@/domain/clock';
import { fmtApprox, fmtInt, roundTo10 } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import type { Place, Pot } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { itemsDraft, orderDraft, textDraft, type LogNavState } from './drafts';
import { geolocationAvailable, markPrimerSeen, readPrimerSeen, useCurrentPosition, useOnline, usePlaceOrders, useRecentPlaces } from './hooks';
import { buildLogMatches, newItemId } from './library';
import { MealContextChips } from './MealContextChips';
import { initialContext, parseInstant, resumedContext, timeSettings, type MealContext } from './mealTime';
import { PhotoSheet } from './PhotoSheet';
import { PotsSheet, potServingKcal, servingsText } from './PotsSheet';
import { UsualsSheet } from './UsualsSheet';
import styles from './LogSheet.module.css';

type Nested = 'usuals' | 'pots' | 'photo' | null;

/** Detail line of a usual order: "9 times · ~950 kcal". */
export function orderDetail(order: OrderOption): string {
  const kcal = `${fmtApprox(roundTo10(order.kcal))} kcal`;
  if (order.times >= 2) return `${fmtInt(order.times)} times · ${kcal}`;
  if (order.times === 1) return `Once · ${kcal}`;
  return kcal;
}

/**
 * S09 Log sheet: Place · time · slot, the text box with instant library matches, the quick
 * ways in (Photo · Plate · Usuals · Pot) and what you usually have at this Place.
 * Sheet content only; the shell wraps it in a BottomSheet.
 */
export function LogSheetContent({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const { params } = useSheet();
  const profile = useProfile();
  const settings = timeSettings(profile);
  const current = useNow();
  const recent = useRecentPlaces();
  const personal = usePersonalItems();
  const usuals = useUsuals();
  const pots = usePots();
  const online = useOnline();
  const logText = useUiStore((s) => s.logText);
  const setLogText = useUiStore((s) => s.setLogText);
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const showToast = useUiStore((s) => s.showToast);
  const headingId = useId();

  const presetAt = parseInstant(params.get('at'));
  // Back from Cancel on S10: the Place, time and slot the estimate was started with.
  const [resume] = useState(() => useUiStore.getState().logResume);
  useEffect(() => {
    if (resume) useUiStore.getState().setLogResume(null);
  }, [resume]);
  const [ctx, setCtx] = useState<MealContext>(() =>
    resume ? resumedContext(resume, now(), settings, presetAt) : initialContext(now(), settings, presetAt),
  );
  const [placeTouched, setPlaceTouched] = useState(resume !== null);
  const [nested, setNested] = useState<Nested>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Location: asked only now that Log is open, with a primer the first time.
  const [primerSeen, setPrimerSeen] = useState(readPrimerSeen);
  const showPrimer = profile !== undefined && !profile.useLocation && !primerSeen && geolocationAvailable();
  const position = useCurrentPosition(profile?.useLocation === true);
  const places: Place[] = recent?.places ?? [];
  const nearby = position ? nearestPlace(places, position) : undefined;
  const nearbyIds = position
    ? places.filter((p) => p.coords && distanceMetres(p.coords, position) <= NEARBY_METRES).map((p) => p.id)
    : [];

  // Until you pick one: the nearest saved Place, else the one you ate at last.
  const autoPlaceId = nearby?.id ?? recent?.mostRecentId;
  const meal: MealContext = placeTouched || !autoPlaceId ? ctx : { ...ctx, placeId: autoPlaceId };
  const place = meal.placeId ? places.find((p) => p.id === meal.placeId) : undefined;

  const placeOrders = usePlaceOrders(place?.id);
  const allOrders = useMemo(() => [...(placeOrders ?? []), ...(usuals ?? []).map(usualOption)], [placeOrders, usuals]);
  const matches = useMemo(
    () => buildLogMatches(logText, { ...(place ? { place } : {}), personal: personal ?? [], orders: allOrders }),
    [logText, place, personal, allOrders],
  );

  // Logging steps replace the sheet's history entry: Back from them (and from Today after a save)
  // returns to the page under the sheet, never to a stale Log sheet.
  const goReview = () => navigate(PATHS.review, { replace: true });
  const startEstimate = (text: string) => {
    setReviewDraft(textDraft(text, meal));
    navigate(PATHS.estimating, { replace: true });
  };
  const startOrder = (order: OrderOption) => {
    setReviewDraft(orderDraft(order, meal));
    goReview();
  };
  // Usuals and Pots (S23, S26, S27) open in place of the sheet too: their Back returns to the
  // page under it, and a new pot's detail, once saved, sits where the sheet was.
  const openManager = (path: string) => navigate(path, { replace: true });

  // One serving per tap: a double tap while the first save runs is ignored (the sheet closes after it).
  const potBusy = useRef(false);
  const [loggingPot, setLoggingPot] = useState(false);
  const logPot = async (pot: Pot) => {
    if (potBusy.current) return;
    potBusy.current = true;
    setLoggingPot(true);
    const at: { eatenAt?: string; slot: MealContext['slot']; placeId?: string } = { slot: meal.slot };
    if (meal.eatenAt) at.eatenAt = meal.eatenAt;
    if (place?.type === 'home') at.placeId = place.id;
    try {
      const result = await logPotServing(pot.id, 1, at);
      const left = result.pot.servingsLeft;
      showToast(`Saved · ${fmtApprox(roundTo10(mealMacros(result.meal).kcal))} kcal · ${servingsText(left)} left`, () => void result.undo());
      close();
    } catch {
      potBusy.current = false;
      setLoggingPot(false);
      showToast("Couldn't log that serving. Try again.");
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhoto(file);
    setNested('photo');
  };
  const openCamera = () => fileRef.current?.click();

  const rows: OrderOption[] = place ? (placeOrders ?? []) : (usuals ?? []).slice(0, 3).map(usualOption);
  const potRows = pots ?? [];
  const typing = logText.trim().length > 0;
  const hint = !online
    ? "Estimate will run when you're back online · you can still pick from your library"
    : typing
      ? 'Matches from your library · no AI yet'
      : 'Type it like a message';

  return (
    <div className={styles.body}>
      {showPrimer ? (
        <div className={styles.primer}>
          <PermissionPrimer
            kind="location"
            title="Pick the Place you're at?"
            body="When Log opens, Kira Makan can pre-select a saved Place within about 150 m. It keeps each Place's own spot, never where you've been."
            allowLabel="Allow location"
            onAllow={() => {
              markPrimerSeen();
              setPrimerSeen(true);
              void setUseLocation(db, true);
            }}
            onNotNow={() => {
              markPrimerSeen();
              setPrimerSeen(true);
            }}
          />
        </div>
      ) : null}

      <MealContextChips
        value={meal}
        onChange={setCtx}
        onPlacePicked={() => setPlaceTouched(true)}
        places={places}
        nearbyIds={nearbyIds}
        coords={position}
        presetAt={presetAt}
        now={current}
        settings={settings}
      />

      <div className={styles.input}>
        <LogInput value={logText} onChange={setLogText} onSubmit={startEstimate} onCamera={openCamera} hint={hint} offline={!online} />
      </div>

      {typing && matches.length > 0 ? (
        <div className={styles.matches}>
          <MatchList
            rows={matches.map((m) => ({
              id: m.id,
              name: m.name,
              detail: m.detail,
              kcalLabel: fmtApprox(roundTo10(m.kcal)),
              onPick: () => {
                if (m.kind === 'order') startOrder(m.order);
                else {
                  setReviewDraft(itemsDraft([{ ...m.item, id: newItemId() }], meal));
                  goReview();
                }
              },
            }))}
          />
        </div>
      ) : null}

      <div className={styles.quick}>
        <QuickActionRow
          actions={[
            { id: 'photo', label: 'Photo', icon: <Camera size={20} strokeWidth={2} />, onPress: openCamera },
            {
              id: 'plate',
              label: 'Plate',
              icon: <Utensils size={20} strokeWidth={2} />,
              onPress: () => {
                const state: LogNavState = { slot: meal.slot };
                if (meal.eatenAt) state.eatenAt = meal.eatenAt;
                if (place) state.placeId = place.id;
                navigate(PATHS.plate, { state, replace: true });
              },
            },
            { id: 'usuals', label: 'Usuals', icon: <Repeat size={20} strokeWidth={2} />, onPress: () => setNested('usuals') },
            { id: 'pot', label: 'Pot', icon: <CookingPot size={20} strokeWidth={2} />, onPress: () => setNested('pots') },
          ]}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.file}
        tabIndex={-1}
        aria-label="Photo of your meal"
        onChange={onFile}
      />

      {rows.length > 0 || potRows.length > 0 ? (
        <section aria-labelledby={headingId}>
          <h2 id={headingId} className={`t-section ${styles.heading}`}>
            {place ? `At ${place.name}` : 'Your usuals'}
          </h2>
          <ul className={styles.orders}>
            {rows.map((order) => (
              <li key={order.id} className={styles.order}>
                <div className={styles.orderText}>
                  <div className={styles.orderName}>{order.name}</div>
                  <div className={styles.orderDetail}>{orderDetail(order)}</div>
                </div>
                <Button variant="secondary" size="sm" className={styles.logPill} aria-label={`Log ${order.name}`} onClick={() => startOrder(order)}>
                  Log
                </Button>
              </li>
            ))}
            {potRows.map((pot) => (
              <li key={pot.id} className={styles.order}>
                <div className={styles.orderText}>
                  <div className={styles.orderName}>
                    {pot.name} pot <span className={styles.left}>· {servingsText(pot.servingsLeft)} left</span>
                  </div>
                  <div className={styles.orderDetail}>Home · {fmtApprox(roundTo10(potServingKcal(pot)))} a serving</div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.logPill}
                  aria-label={`Log 1 serving of ${pot.name}`}
                  disabled={loggingPot}
                  onClick={() => void logPot(pot)}
                >
                  Log 1
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <UsualsSheet
        open={nested === 'usuals'}
        onClose={() => setNested(null)}
        usuals={usuals ?? []}
        placeId={place?.id}
        onPick={(usual) => startOrder(usualOption(usual))}
        onManage={() => openManager(PATHS.usuals)}
      />
      <PotsSheet
        open={nested === 'pots'}
        onClose={() => setNested(null)}
        pots={potRows}
        busy={loggingPot}
        onLog={(pot) => void logPot(pot)}
        onNewPot={() => openManager(PATHS.potNew)}
        onAllPots={() => openManager(PATHS.pots)}
      />
      <PhotoSheet
        open={nested === 'photo'}
        file={photo}
        meal={meal}
        onClose={() => {
          setNested(null);
          setPhoto(null);
        }}
      />
    </div>
  );
}
