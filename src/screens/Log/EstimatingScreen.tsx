import { useEffect, useId, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { PATHS } from '@/app/paths';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { db } from '@/db/db';
import { usePersonalItems, usePlace, useUsuals } from '@/db/hooks';
import { discardPhoto, loadEstimateContext } from '@/db/logging';
import { getPhoto, getProfile } from '@/db/repo';
import type { MealItem } from '@/domain/types';
import { estimateMeal, needsAi } from '@/estimate/service';
import type { EstimateRequest, EstimateResult } from '@/estimate/types';
import { useUiStore, type LogResume, type ReviewDraft } from '@/state/ui';
import { usePhotoUrl } from './hooks';
import { ItemSearchSheet } from './ItemSearchSheet';
import { manualItem } from './library';
import styles from './EstimatingScreen.module.css';

/** "Still working…" after this long (README › Loading). */
export const SLOW_AFTER_MS = 6000;

/** Shown on Review when a meal needed the AI but nobody is signed in (once per app session). */
export const SIGN_IN_HINT = 'Sign in under Settings to use AI estimates.';

let signInHintShown = false;

/** Tests: lets the sign-in hint show again. */
export function resetSignInHint(): void {
  signInHintShown = false;
}

/** The AI was skipped for want of a session, and the meal had something only the AI could read. */
function wantsSignIn(req: EstimateRequest, result: EstimateResult): boolean {
  return result.aiSkipped === 'notSignedIn' && needsAi(req, result);
}

function showSignInHint(): void {
  if (signInHintShown) return;
  signInHintShown = true;
  // CONTRACT: the ui store's toast only offers Undo. Once it takes an action label and handler
  // (C05 Toast already has actionLabel), add "Settings" → navigate(PATHS.settings) here.
  useUiStore.getState().showToast(SIGN_IN_HINT);
}

type Phase = 'working' | 'slow' | 'failed';

/** S10 Estimating: the typed text (or photo) while the estimator reads it; S47 in place when it can't. */
export default function EstimatingScreen() {
  const draft = useUiStore((s) => s.reviewDraft);
  if (!draft || draft.items.length > 0 || (draft.flow !== 'text' && draft.flow !== 'photo')) {
    return <Navigate to={draft && draft.items.length > 0 ? PATHS.review : PATHS.today} replace />;
  }
  return <Estimating draft={draft} />;
}

function requestFor(draft: ReviewDraft, photo: Blob | undefined): EstimateRequest {
  const req: EstimateRequest = {};
  if (photo) {
    req.photo = photo;
    if (draft.meta.text) req.caption = draft.meta.text;
  } else if (draft.meta.text) {
    req.text = draft.meta.text;
  }
  if (draft.meta.placeId) req.placeId = draft.meta.placeId;
  if (draft.meta.slot) req.slot = draft.meta.slot;
  return req;
}

function Estimating({ draft }: { draft: ReviewDraft }) {
  const navigate = useNavigate();
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const setLogResume = useUiStore((s) => s.setLogResume);
  const [phase, setPhase] = useState<Phase>('working');
  const [attempt, setAttempt] = useState(0);
  const [fallback, setFallback] = useState<'library' | 'manual' | null>(null);
  const photoUrl = usePhotoUrl(draft.meta.photoId, 'blob');
  const statusId = useId();
  const text = draft.meta.text ?? '';
  const isPhoto = draft.flow === 'photo';

  const toReview = (items: MealItem[]) => {
    const latest = useUiStore.getState().reviewDraft ?? draft;
    setReviewDraft({ ...latest, items });
    navigate(PATHS.review, { replace: true });
  };

  useEffect(() => {
    const controller = new AbortController();
    setPhase('working');
    const slow = setTimeout(() => setPhase((p) => (p === 'working' ? 'slow' : p)), SLOW_AFTER_MS);
    void (async () => {
      try {
        const current = useUiStore.getState().reviewDraft ?? draft;
        // The profile is read here rather than through useProfile(), so the saved AI setting
        // ('off' included) applies even before the live query has loaded.
        const [ctx, stored, profile] = await Promise.all([
          loadEstimateContext(db, current.meta.placeId),
          current.meta.photoId ? getPhoto(db, current.meta.photoId) : Promise.resolve(undefined),
          getProfile(db),
        ]);
        const req = requestFor(current, stored?.blob);
        // A photo the AI can't read yet comes back as a pending "Meal from photo".
        const result = await estimateMeal(req, ctx, { signal: controller.signal, mode: profile?.aiEstimates });
        if (controller.signal.aborted) return;
        if (result.items.length === 0) {
          setPhase('failed');
          return;
        }
        if (wantsSignIn(req, result)) showSignInHint();
        toReview(result.items);
      } catch {
        if (!controller.signal.aborted) setPhase('failed');
      } finally {
        clearTimeout(slow);
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(slow);
    };
    // A new attempt (Try again) restarts the estimate; the draft is read fresh from the store.
  }, [attempt]);

  const cancel = () => {
    if (isPhoto && draft.meta.photoId && !draft.meta.editingMealId) void discardPhoto(db, draft.meta.photoId);
    // Back to the Log sheet with the text still there, and the Place, time and slot it had (the
    // check-in's "last night" time included), so a new estimate still lands on that day.
    const { placeId, placeName, eatenAt, slot, timeFromSlot } = (useUiStore.getState().reviewDraft ?? draft).meta;
    const resume: LogResume = {};
    if (placeId) resume.placeId = placeId;
    else if (placeName) resume.placeName = placeName;
    if (eatenAt) resume.eatenAt = eatenAt;
    if (eatenAt && timeFromSlot) resume.timeFromSlot = true;
    if (slot) resume.slot = slot;
    setLogResume(resume);
    // A time the slot chip set is today's and stays a slot time; only a picked time is a preset.
    const at = eatenAt && !timeFromSlot ? `&at=${encodeURIComponent(eatenAt)}` : '';
    navigate(`${draft.backTo ?? PATHS.today}?sheet=log${at}`, { replace: true });
  };

  const failed = phase === 'failed';
  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Reading your meal" onBack={cancel} />

      {isPhoto ? (
        <div className={styles.photoCard}>
          {photoUrl ? <img className={styles.photo} src={photoUrl} alt="Your meal" /> : <div className={styles.photoPlaceholder} aria-hidden="true" />}
          {text ? <p className={styles.caption}>“{text}”</p> : null}
        </div>
      ) : (
        <blockquote className={styles.quote}>“{text}”</blockquote>
      )}

      {failed ? (
        <FailedState
          onRetry={() => setAttempt((n) => n + 1)}
          onLibrary={() => setFallback('library')}
          onManual={() => setFallback('manual')}
        />
      ) : (
        <>
          <div className={styles.skeleton}>
            <SkeletonList count={4} label="Estimating your meal" />
          </div>
          <p id={statusId} className={styles.status} aria-live="polite">
            {phase === 'slow' ? 'Still working…' : 'Estimating… matching to your library and MyFCD'}
          </p>
          <div className={styles.cancelRow}>
            <button type="button" className={styles.cancel} onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      <LibraryFallback open={fallback === 'library'} onClose={() => setFallback(null)} draft={draft} onPick={toReview} />
      <ManualFallback open={fallback === 'manual'} onClose={() => setFallback(null)} defaultName={text} onAdd={(item) => toReview([item])} />
    </div>
  );
}

function FailedState({ onRetry, onLibrary, onManual }: { onRetry: () => void; onLibrary: () => void; onManual: () => void }) {
  const titleId = useId();
  return (
    <section className={styles.failed} role="alert" aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.failedTitle}>
        Couldn't estimate this right now.
      </h2>
      <p className={styles.failedBody}>Try again, or pick from your library. What you typed is kept.</p>
      <div className={styles.failedActions}>
        <Button onClick={onRetry}>Try again</Button>
        <Button variant="secondary" size="md" onClick={onLibrary}>
          Pick from your library
        </Button>
        <Button variant="ghost" size="md" onClick={onManual}>
          Enter kcal yourself
        </Button>
      </div>
    </section>
  );
}

function LibraryFallback({ open, onClose, draft, onPick }: { open: boolean; onClose: () => void; draft: ReviewDraft; onPick: (items: MealItem[]) => void }) {
  const personal = usePersonalItems();
  const usuals = useUsuals();
  const place = usePlace(draft.meta.placeId);
  const ctx = useMemo(
    () => ({ ...(place ? { place } : {}), personal: personal ?? [], usuals: usuals ?? [] }),
    [place, personal, usuals],
  );
  return (
    <ItemSearchSheet
      open={open}
      onClose={onClose}
      title="Pick from your library"
      ctx={ctx}
      initialQuery={draft.meta.text?.split(',')[0]?.trim() ?? ''}
      onPick={onPick}
    />
  );
}

function ManualFallback({ open, onClose, defaultName, onAdd }: { open: boolean; onClose: () => void; defaultName: string; onAdd: (item: MealItem) => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Enter kcal yourself">
      <SheetTitle>Enter kcal yourself</SheetTitle>
      {open ? <ManualForm defaultName={defaultName} onAdd={onAdd} /> : null}
    </BottomSheet>
  );
}

function ManualForm({ defaultName, onAdd }: { defaultName: string; onAdd: (item: MealItem) => void }) {
  const nameId = useId();
  const kcalId = useId();
  const [name, setName] = useState(defaultName.slice(0, 60));
  const [kcal, setKcal] = useState('');
  const value = Number(kcal);
  const valid = kcal.trim() !== '' && Number.isFinite(value) && value > 0 && value < 10000;
  return (
    <form
      className={styles.manual}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onAdd(manualItem(name, value));
      }}
    >
      <label htmlFor={nameId} className={styles.fieldLabel}>
        What was it?
      </label>
      <input id={nameId} className={styles.field} value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      <label htmlFor={kcalId} className={styles.fieldLabel}>
        kcal
      </label>
      <input
        id={kcalId}
        className={styles.field}
        value={kcal}
        inputMode="numeric"
        placeholder="e.g. 650"
        autoComplete="off"
        onChange={(e) => setKcal(e.target.value.replace(/[^\d]/g, ''))}
      />
      <div className={styles.manualAction}>
        <Button type="submit" disabled={!valid}>
          Add to review
        </Button>
      </div>
    </form>
  );
}
