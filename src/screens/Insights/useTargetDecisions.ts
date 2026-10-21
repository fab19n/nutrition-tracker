import { useCallback, useEffect, useRef, useState } from 'react';
import type { Undo } from '@/db/actions';
import {
  TargetChangedError,
  approveTarget,
  cancelPendingTarget,
  keepCurrentTarget,
  markTargetNoticeSeen,
  type TargetOption,
  type TargetView,
} from '@/db/targetSuggestion';
import type { Id } from '@/domain/types';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { decisionToast, startsWhen } from './targetModel';

const KEY = 'target';

/** A decision saved here that the live view may not show yet. */
type Decided = { kind: 'approve' | 'keep'; versionId: Id } | { kind: 'cancel'; pendingId: Id };

/** The view still offers what was just decided: it was read before the save. */
function stillOffers(view: TargetView | undefined, decided: Decided): boolean {
  if (!view) return false;
  if (decided.kind === 'cancel') return view.pending?.id === decided.pendingId;
  const { check } = view;
  // A kept suggestion still has Approve on S37, so it is only "decided" for an approval.
  const offered = check.kind === 'suggestion' || (check.kind === 'kept' && decided.kind === 'approve');
  return offered && check.current.versionId === decided.versionId;
}

/**
 * Approve / Change pace instead / Keep current / Keep 1,800 instead, shared by S37 and the
 * Insights card: one decision at a time (repeat taps are ignored), a toast with Undo, and the
 * notice marked seen. Numbers that changed since the user looked are refused, never applied.
 * After a decision the buttons stay locked until `view` (the one on screen) shows it, so a
 * second tap on the old card can't replace the Undo toast with "This suggestion changed".
 */
export function useTargetDecisions(view?: TargetView) {
  const showToast = useUiStore((s) => s.showToast);
  const inFlight = useInFlight();
  const { run } = inFlight;
  // The ref answers taps at once; the state re-renders the buttons.
  const decidedRef = useRef<Decided | null>(null);
  const [decided, setDecided] = useState<Decided | null>(null);

  const remember = useCallback((next: Decided | null) => {
    decidedRef.current = next;
    setDecided(next);
  }, []);

  const shown = decided !== null && stillOffers(view, decided);
  useEffect(() => {
    if (decided && view && !shown) remember(null);
  }, [decided, view, shown, remember]);

  /** Taps on a card that still shows the decision just made are ignored. */
  const locked = useCallback((tapped: TargetView) => decidedRef.current !== null && stillOffers(tapped, decidedRef.current), []);

  /** Undo forgets the decision too, so the card it brings back can be used again. */
  const withUndo = useCallback(
    (message: string, undo: Undo) => {
      showToast(message, () => {
        remember(null);
        void undo();
      });
    },
    [showToast, remember],
  );

  const failed = useCallback(
    (error: unknown) => {
      showToast(error instanceof TargetChangedError ? 'This suggestion changed. Have another look.' : "Couldn't save that. Try again.");
    },
    [showToast],
  );

  const approve = useCallback(
    async (view: TargetView, option: TargetOption, now: Date): Promise<void> => {
      if (locked(view)) return;
      await run(KEY, async () => {
        const { check } = view;
        try {
          if (check.kind !== 'suggestion' && check.kind !== 'kept') throw new TargetChangedError();
          const values = option === 'slowerPace' ? check.proposal.slowerPace : check.proposal.suggested;
          if (!values) throw new TargetChangedError();
          const { version, undo } = await approveTarget({ versionId: check.current.versionId, option, dailyKcal: values.dailyKcal });
          remember({ kind: 'approve', versionId: check.current.versionId });
          markTargetNoticeSeen(check.proposal.noticeKey);
          const when = startsWhen(view.today, now, view.tz, view.rolloverHour).short;
          const message = decisionToast(option === 'slowerPace' ? 'slowerPace' : 'approve', {
            kcal: version.dailyKcal,
            paceKgPerWeek: version.paceKgPerWeek ?? values.paceKgPerWeek,
            when,
          });
          withUndo(message, undo);
        } catch (error) {
          failed(error);
        }
      });
    },
    [locked, run, remember, withUndo, failed],
  );

  const keep = useCallback(
    async (view: TargetView): Promise<void> => {
      if (locked(view)) return;
      await run(KEY, async () => {
        const { check } = view;
        try {
          if (check.kind !== 'suggestion') throw new TargetChangedError();
          const undo = await keepCurrentTarget({ versionId: check.current.versionId });
          remember({ kind: 'keep', versionId: check.current.versionId });
          markTargetNoticeSeen(check.proposal.noticeKey);
          withUndo(decisionToast('keep', { kcal: check.current.dailyKcal }), undo);
        } catch (error) {
          failed(error);
        }
      });
    },
    [locked, run, remember, withUndo, failed],
  );

  const cancel = useCallback(
    async (view: TargetView): Promise<void> => {
      if (locked(view)) return;
      await run(KEY, async () => {
        try {
          const { pending, current } = view;
          if (!pending || !current) throw new TargetChangedError();
          const undo = await cancelPendingTarget(pending.id);
          remember({ kind: 'cancel', pendingId: pending.id });
          withUndo(decisionToast('cancel', { kcal: current.dailyKcal }), undo);
        } catch (error) {
          failed(error);
        }
      });
    },
    [locked, run, remember, withUndo, failed],
  );

  return { approve, keep, cancel, busy: inFlight.busy(KEY) || shown };
}
