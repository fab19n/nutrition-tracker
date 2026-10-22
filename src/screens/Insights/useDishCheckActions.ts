import { useCallback, useRef, useState } from 'react';
import type { Undo } from '@/db/actions';
import { DishCheckChangedError, answerDish, dismissDishCheck, finishDishCheck, type DishCheckView, type DishRowView } from '@/db/dishCheck';
import type { DishAnswer } from '@/domain/dishCheck';
import { useUiStore } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { finishToast } from './dishCheckModel';

const FINISH_KEY = 'finish';
const DISMISS_KEY = 'dismiss';
const rowKey = (key: string) => `dish:${key}`;

/**
 * Answer / Undo / Done / Not now for the top dishes check, shared by S34 and its Insights card.
 * One save per dish at a time (repeat taps are ignored), no toast per answer, and a toast with
 * Undo for Done and Not now. A row's Undo link lives only while S34 is open: the undo functions
 * are kept here, never stored.
 */
export function useDishCheckActions(view?: DishCheckView) {
  const showToast = useUiStore((s) => s.showToast);
  const inFlight = useInFlight();
  const { run } = inFlight;
  const undos = useRef(new Map<string, Undo>());
  // The map answers taps at once; the counter re-renders the Undo links.
  const [, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const failed = useCallback(
    (error: unknown) => {
      showToast(error instanceof DishCheckChangedError ? 'That dish changed. Have another look.' : "Couldn't save that. Try again.");
    },
    [showToast],
  );

  const answer = useCallback(
    async (row: Pick<DishRowView, 'key' | 'answer'>, choice: DishAnswer): Promise<void> => {
      // A row already answered (or whose undo is still held) takes no second answer.
      if (row.answer !== undefined || undos.current.has(row.key)) return;
      await run(rowKey(row.key), async () => {
        try {
          const result = await answerDish(row.key, choice);
          undos.current.set(row.key, result.undo);
          refresh();
        } catch (error) {
          failed(error);
        }
      });
    },
    [run, refresh, failed],
  );

  const canUndo = useCallback((key: string) => undos.current.has(key), []);

  const undo = useCallback(
    async (key: string): Promise<void> => {
      const undoRow = undos.current.get(key);
      if (!undoRow) return;
      await run(rowKey(key), async () => {
        try {
          await undoRow();
          undos.current.delete(key);
          refresh();
        } catch (error) {
          failed(error);
        }
      });
    },
    [run, refresh, failed],
  );

  /** Done. Resolves true when the check was finished, so the screen can go back. */
  const finish = useCallback(
    async (): Promise<boolean> =>
      (await run(FINISH_KEY, async () => {
        try {
          const { updated, undo: undoFinish } = await finishDishCheck();
          showToast(finishToast(updated), () => {
            void undoFinish();
          });
          return true;
        } catch (error) {
          failed(error);
          return false;
        }
      })) ?? false,
    [run, showToast, failed],
  );

  /** Not now, on the Insights card: hides it for 4 weeks. */
  const dismiss = useCallback(
    async (): Promise<void> => {
      await run(DISMISS_KEY, async () => {
        try {
          const undoDismiss = await dismissDishCheck();
          showToast('Top dishes check hidden for 4 weeks', () => {
            void undoDismiss();
          });
        } catch (error) {
          failed(error);
        }
      });
    },
    [run, showToast, failed],
  );

  /** One dish saving (or, without a key, any save at all). */
  const busy = (key?: string): boolean => {
    if (key !== undefined) return inFlight.busy(rowKey(key));
    return inFlight.busy(FINISH_KEY) || inFlight.busy(DISMISS_KEY) || (view?.rows ?? []).some((r) => inFlight.busy(rowKey(r.key)));
  };

  return { answer, undo, canUndo, finish, dismiss, busy };
}
