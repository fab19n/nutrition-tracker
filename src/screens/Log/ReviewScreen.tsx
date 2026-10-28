import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { AddItemRow } from '@/components/AddItemRow/AddItemRow';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { CorrectionScopePrompt } from '@/components/CorrectionScopePrompt/CorrectionScopePrompt';
import { FinishedPicker } from '@/components/FinishedPicker/FinishedPicker';
import { PhotoThumb } from '@/components/PhotoThumb/PhotoThumb';
import { RangeTotal, type AfterThisInput } from '@/components/RangeTotal/RangeTotal';
import { ReviewItemRow } from '@/components/ReviewItemRow/ReviewItemRow';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Toggle } from '@/components/ui/Toggle';
import { deleteMeal, rememberCorrection, saveMeal } from '@/db/actions';
import { db } from '@/db/db';
import { useMealThumbUrl } from '@/db/diary';
import { useMeal, useNow, usePersonalItems, useProfile, useToday, useUsuals, useWeekBudget } from '@/db/hooks';
import { discardPhoto, findRepeatedCorrection, loadEstimateContext, saveUsualFromMeal, type RepeatedCorrection } from '@/db/logging';
import { now } from '@/domain/clock';
import { fmtApprox, fmtInt, fmtKcal, fmtRange, roundTo10 } from '@/domain/format';
import { itemMacros, itemsRange, mealMacros, selectVariant } from '@/domain/meal';
import type { Id, LogicalDay, MealItem } from '@/domain/types';
import { readEstimateUrl } from '@/estimate/aiClient';
import { estimateMeal } from '@/estimate/service';
import { useUiStore, type ReviewDraft } from '@/state/ui';
import type { LogNavState } from './drafts';
import { answeredItems, answerRequest } from './followUp';
import { useOnline, useRecentPlaces } from './hooks';
import { ItemSearchSheet } from './ItemSearchSheet';
import { MealContextChips } from './MealContextChips';
import { mealDayOf, slotFor, timeSettings, type MealContext, type TimeId } from './mealTime';
import { cleanPriceInput, parsePrice, priceText } from './price';
import styles from './ReviewScreen.module.css';

/** S11 Review, shared by every way of logging, and S14's edit mode (draft.meta.editingMealId). */
export default function ReviewScreen() {
  const draft = useUiStore((s) => s.reviewDraft);
  if (!draft) return <Navigate to={PATHS.today} replace />;
  return <Review draft={draft} />;
}

type Search = { mode: 'add' } | { mode: 'swap'; index: number } | null;

interface Prompt extends RepeatedCorrection {
  target: string;
}

/** design_handoff §10.4: a save while offline. */
export const SAVED_OFFLINE_TOAST = "Saved offline. It'll sync when you're back online.";

function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

/** "You've changed kuah campur to banjir here twice. Make banjir the default here?" */
export function correctionMessage(c: RepeatedCorrection): string {
  const label = c.item.variants?.[c.item.selectedVariant ?? -1]?.label ?? '';
  const chip = /^\d/.test(label) ? label : label.toLocaleLowerCase();
  const times = c.times === 2 ? 'twice' : `${fmtInt(c.times)} times`;
  return `You've changed ${lowerFirst(c.item.name)} to ${chip} here ${times}. Make ${chip} the default here?`;
}

/** An answer the estimator couldn't use: the question stays open. */
export const ANSWER_FAILED_TOAST = "Couldn't update it with that answer. Try again, or swap the item.";

/** An answered chip (or Skip) closes the item's open question (the amber ring goes). */
function answered(item: MealItem): MealItem {
  if (item.question === undefined) return item;
  const { question: _question, ...rest } = item;
  return rest;
}

function Review({ draft }: { draft: ReviewDraft }) {
  const navigate = useNavigate();
  const location = useLocation();
  const updateDraftItem = useUiStore((s) => s.updateDraftItem);
  const removeDraftItem = useUiStore((s) => s.removeDraftItem);
  const addDraftItem = useUiStore((s) => s.addDraftItem);
  const updateDraftMeta = useUiStore((s) => s.updateDraftMeta);
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const showToast = useUiStore((s) => s.showToast);
  const setLogText = useUiStore((s) => s.setLogText);

  const profile = useProfile();
  const settings = timeSettings(profile);
  const current = useNow();
  const today = useToday();
  const recent = useRecentPlaces();
  const personal = usePersonalItems();
  const usuals = useUsuals();
  const week = useWeekBudget();
  const { items, meta, flow } = draft;
  const editingId = meta.editingMealId;
  const isEdit = editingId !== undefined;
  const editing = useMeal(editingId);
  const finished = meta.finished ?? 'all';
  // Editing a meal synced from another device shows its Drive thumbnail when the photo isn't here.
  const photoUrl = useMealThumbUrl({ photoId: meta.photoId, mealId: meta.editingMealId });
  const priceId = useId();
  const online = useOnline();
  // Editing keeps the meal on its own day while its time changes; a new meal's day is decided
  // afresh by each time picked (a time still ahead of now means last night).
  const [editDay] = useState<LogicalDay | undefined>(() => (isEdit && meta.eatenAt ? mealDayOf(meta.eatenAt, now(), settings) : undefined));

  const [timeId, setTimeId] = useState<TimeId>(meta.eatenAt ? (meta.timeFromSlot && !isEdit ? 'slot' : 'custom') : 'now');
  // A slot time only exists because the slot was picked, so it counts as picked too.
  const [slotTouched, setSlotTouched] = useState(
    () => isEdit || meta.timeFromSlot === true || (meta.slot !== undefined && meta.slot !== slotFor(meta.eatenAt, now(), settings)),
  );
  const [price, setPrice] = useState(() => priceText(meta.priceRm));
  const [alsoUsual, setAlsoUsual] = useState(false);
  const [search, setSearch] = useState<Search>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [saving, setSaving] = useState(false);
  const [answeringId, setAnsweringId] = useState<Id | null>(null);
  // A typed answer needs the AI: online, an endpoint, and AI estimates not turned off.
  const canAnswer = online && profile?.aiEstimates !== 'off' && readEstimateUrl() !== undefined;

  // Leaving after a save (or Back) drops the draft, so a direct visit later lands on Today.
  const dropDraft = useRef(false);
  // A save that asks about a repeated correction shows its toast once the prompt is answered, so
  // the toast never sits over the prompt's buttons and its Undo stays up long enough to use.
  const savedToast = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (dropDraft.current) useUiStore.getState().clearReviewDraft();
    },
    [],
  );

  const places = recent?.places ?? [];
  const place = meta.placeId ? places.find((p) => p.id === meta.placeId) : undefined;
  const libraryCtx = useMemo(
    () => ({ ...(place ? { place } : {}), personal: personal ?? [], usuals: usuals ?? [] }),
    [place, personal, usuals],
  );

  const context: MealContext = {
    timeId,
    slot: meta.slot ?? slotFor(meta.eatenAt, current, settings),
    slotTouched,
    ...(meta.placeId ? { placeId: meta.placeId } : {}),
    ...(meta.placeName ? { placeName: meta.placeName } : {}),
    ...(meta.eatenAt ? { eatenAt: meta.eatenAt } : {}),
  };
  const onContext = (next: MealContext) => {
    setTimeId(next.timeId);
    setSlotTouched(next.slotTouched);
    // Editing: "Now" moves the meal to now; a new meal gets its time stamped on save.
    const eatenAt = next.eatenAt ?? (isEdit ? now().toISOString() : undefined);
    const timeFromSlot = eatenAt !== undefined && next.timeId === 'slot' ? true : undefined;
    updateDraftMeta({ placeId: next.placeId, placeName: next.placeName, eatenAt, slot: next.slot, timeFromSlot });
  };

  const totalKcal = mealMacros({ items, finished }).kcal;
  const range = itemsRange(items, finished);

  // The footer's "after this" line, for meals on today's logical day.
  let after: AfterThisInput | undefined;
  const mealDay = mealDayOf(meta.eatenAt, current, settings);
  const todayInput = week?.days.find((d) => d.day === today);
  const todayRow = week?.budget.days.find((d) => d.isToday);
  if (week && todayRow && todayInput && todayInput.targetKcal !== null && mealDay === today && week.budget.today === today) {
    let eatenToday = todayRow.eatenKcal;
    let leftToday = week.budget.leftTodayKcal;
    if (editing && editing.logicalDay === today) {
      const stored = mealMacros(editing).kcal;
      eatenToday -= stored;
      leftToday += stored;
    }
    after = { eatenTodayKcal: Math.max(0, eatenToday), mealKcal: totalKcal, leftTodayKcal: leftToday, savedKcal: week.budget.savedKcal };
  }

  // An edit review is pushed from its entry (S14), so going back pops this screen instead of
  // stacking the entry a second time. Every other flow replaced its origin (the Log sheet, the
  // plate builder, Ideas) with Review: Back puts the origin back in its place, and after a save the
  // phone's back button from Today never lands on a stale plate or idea.
  const fromOrigin = flow === 'edit' && location.key !== 'default';

  const leave = (target: string) => {
    dropDraft.current = true;
    savedToast.current?.();
    savedToast.current = null;
    // An edit returns to its entry, which shows the saved meal.
    if (isEdit && fromOrigin) goBack(navigate);
    else navigate(target, { replace: true });
  };

  const back = () => {
    if (flow === 'photo' && meta.photoId && !isEdit) void discardPhoto(db, meta.photoId);
    if (flow === 'plate') {
      // The plate builder picks its plate back up from the draft.
      const state: LogNavState = { restore: true };
      navigate(draft.backTo ?? PATHS.plate, { replace: true, state });
      return;
    }
    dropDraft.current = true;
    if (fromOrigin) goBack(navigate);
    else navigate(draft.backTo ?? PATHS.today, { replace: true });
  };

  const save = async () => {
    if (saving || items.length === 0) return;
    setSaving(true);
    const latest = useUiStore.getState().reviewDraft ?? draft;
    const toSave: ReviewDraft = { ...latest, meta: { ...latest.meta, priceRm: parsePrice(price) } };
    try {
      const { meal, undo } = await saveMeal(toSave);
      const usual = alsoUsual ? await saveUsualFromMeal(db, meal) : undefined;
      // S46: offline the save is still local and safe; the toast says it syncs later.
      const message = online ? `Saved · ${fmtApprox(roundTo10(mealMacros(meal).kcal))} kcal` : SAVED_OFFLINE_TOAST;
      const toast = () =>
        showToast(message, () => {
          void undo();
          if (usual) void usual.undo();
        });
      // What was typed in the Log sheet is logged now (as text, a typed usual or Place order, or a
      // plate picked instead), so the next Log starts empty. Ideas and edits never used it.
      if (latest.flow !== 'edit' && latest.flow !== 'idea') setLogText('');
      const target = isEdit ? PATHS.entry(meal.id) : PATHS.today;
      const repeated = await findRepeatedCorrection(db, meal);
      if (repeated) {
        dropDraft.current = true;
        savedToast.current = toast;
        setPrompt({ ...repeated, target });
        return;
      }
      toast();
      leave(target);
    } catch {
      setSaving(false);
      showToast("Couldn't save this meal. Try again.");
    }
  };

  const remove = async () => {
    if (!editingId) return;
    setConfirmDelete(false);
    const day = editing?.logicalDay ?? today;
    const undo = await deleteMeal(editingId);
    showToast('Entry deleted', () => void undo());
    dropDraft.current = true;
    navigate(`${PATHS.diary}?day=${day}`, { replace: true });
  };

  /** The item is estimated again from its question and the answer; the result takes its place. */
  const answerQuestion = async (item: MealItem, answer: string) => {
    if (!item.question || answeringId) return;
    setAnsweringId(item.id);
    try {
      const { meta: latestMeta } = useUiStore.getState().reviewDraft ?? draft;
      const ctx = await loadEstimateContext(db, latestMeta.placeId);
      const result = await estimateMeal(answerRequest(item, item.question, answer, latestMeta), ctx, { mode: 'always' });
      const next = answeredItems(result);
      if (!next) {
        showToast(ANSWER_FAILED_TOAST);
        return;
      }
      const latest = useUiStore.getState().reviewDraft;
      const at = latest?.items.findIndex((i) => i.id === item.id) ?? -1;
      if (!latest || at < 0) return; // removed while it was estimating
      setReviewDraft({ ...latest, items: [...latest.items.slice(0, at), ...next, ...latest.items.slice(at + 1)] });
    } catch {
      showToast(ANSWER_FAILED_TOAST);
    } finally {
      setAnsweringId(null);
    }
  };

  const onPicked = (picked: MealItem[]) => {
    if (search?.mode === 'swap') {
      const latest = useUiStore.getState().reviewDraft ?? draft;
      const next = [...latest.items.slice(0, search.index), ...picked, ...latest.items.slice(search.index + 1)];
      setReviewDraft({ ...latest, items: next });
    } else {
      for (const item of picked) addDraftItem(item);
    }
    setSearch(null);
  };

  return (
    <div className={styles.screen}>
      <SubScreenHeader title={draft.title} onBack={back} />

      <div className={styles.chips}>
        <MealContextChips
          value={context}
          onChange={onContext}
          places={places}
          now={current}
          settings={settings}
          baseDay={editDay}
          extra={meta.photoId ? <PhotoThumb url={photoUrl} size={30} alt="Meal photo" /> : null}
        />
      </div>

      {meta.text && (flow === 'text' || flow === 'photo' || flow === 'edit') ? <p className={styles.quote}>“{meta.text}”</p> : null}

      <div className={styles.items}>
        {items.length === 0 ? <p className={styles.empty}>Nothing on this meal yet. Add an item to save it.</p> : null}
        {items.map((item, index) => (
          <ReviewItemRow
            key={item.id}
            item={item}
            kcalLabel={fmtApprox(roundTo10(itemMacros(item).kcal))}
            onSelectVariant={(i) => updateDraftItem(index, answered(selectVariant(item, i)))}
            onRemove={() => removeDraftItem(index)}
            onSwap={() => setSearch({ mode: 'swap', index })}
            pendingReason={online ? 'unavailable' : 'offline'}
            onSkip={() => updateDraftItem(index, answered(item))}
            {...(canAnswer ? { onAnswer: (answer: string) => void answerQuestion(item, answer) } : {})}
            answering={answeringId === item.id}
          />
        ))}
        <AddItemRow
          onAdd={() => setSearch({ mode: 'add' })}
          right={<FinishedPicker value={finished} onChange={(f) => updateDraftMeta({ finished: f })} defaultExpanded={flow === 'photo'} />}
        />

        <div className={styles.row}>
          <label htmlFor={priceId} className={styles.rowLabel}>
            Price <span className={styles.optional}>(optional)</span>
          </label>
          <span className={styles.price}>
            <span className={styles.rm} aria-hidden="true">
              RM
            </span>
            <input
              id={priceId}
              className={styles.priceInput}
              value={price}
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              onChange={(e) => setPrice(cleanPriceInput(e.target.value))}
            />
          </span>
        </div>

        {flow !== 'usual' ? (
          <div className={styles.row}>
            <span className={styles.rowLabel} aria-hidden="true">
              Also save as a Usual
            </span>
            <Toggle checked={alsoUsual} onChange={setAlsoUsual} label="Also save as a Usual" />
          </div>
        ) : null}

        {isEdit ? (
          <div className={styles.deleteRow}>
            <button type="button" className={styles.delete} onClick={() => setConfirmDelete(true)}>
              Delete entry
            </button>
          </div>
        ) : null}
      </div>

      <RangeTotal
        totalKcalLabel={fmtKcal(roundTo10(totalKcal))}
        rangeLabel={fmtRange(range)}
        actionLabel="Save"
        onAction={() => void save()}
        disabled={items.length === 0 || saving}
        {...(after ? { after } : {})}
      />

      <ItemSearchSheet
        open={search !== null}
        onClose={() => setSearch(null)}
        title={search?.mode === 'swap' ? 'Swap item' : 'Add an item'}
        ctx={libraryCtx}
        initialQuery={search?.mode === 'swap' ? (items[search.index]?.name ?? '') : ''}
        onPick={onPicked}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this entry?"
        body="It comes off that day's total. You can undo straight after."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />

      <BottomSheet open={prompt !== null} onClose={() => prompt && leave(prompt.target)} title="Make this the default here?">
        {prompt ? (
          <div className={styles.prompt}>
            <CorrectionScopePrompt
              message={correctionMessage(prompt)}
              onYes={() => {
                void rememberCorrection(prompt.item, prompt.placeId, 'place').finally(() => leave(prompt.target));
              }}
              onJustThisTime={() => leave(prompt.target)}
            />
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
