import { create } from 'zustand';
import type { Finished, Id, Instant, LogMethod, MealItem, MealSlot } from '@/domain/types';

/**
 * UI-only state: the toast, the review draft shared by every logging flow (S11), and the log
 * sheet's text. Nothing here is persisted; saved data lives in Dexie.
 */

export interface Toast {
  id: number;
  message: string;
  /** Shows an "Undo" action when set. */
  undo?: () => void;
}

/** Which flow opened the review screen; Back returns there. */
export type ReviewFlow = 'text' | 'plate' | 'usual' | 'placeOrder' | 'idea' | 'photo' | 'pot' | 'edit';

export interface ReviewMeta {
  placeId?: Id;
  /** A typed Place name that isn't saved yet. */
  placeName?: string;
  eatenAt?: Instant;
  slot?: MealSlot;
  /**
   * eatenAt came from the slot chip (the slot's usual time), not from the time picker, so picking
   * another slot can still move it. Never saved on the meal.
   */
  timeFromSlot?: boolean;
  /** What was typed (text and photo-caption flows). */
  text?: string;
  /** Ledger name for the meal ("Economy rice"). */
  name?: string;
  priceRm?: number;
  finished?: Finished;
  method: LogMethod;
  /** Set in edit mode (S14), when saving updates an existing meal. */
  editingMealId?: Id;
  photoId?: Id;
}

export interface ReviewDraft {
  flow: ReviewFlow;
  /** Screen title: "Check your meal", "Check your plate", "Your usual order", "Edit entry". */
  title: string;
  items: MealItem[];
  meta: ReviewMeta;
  /** Route to return to on Back, e.g. '/log/plate'. */
  backTo?: string;
}

export interface UiState {
  toast: Toast | null;
  /** Shows a toast (replacing any current one) and returns its id. */
  showToast: (message: string, undo?: () => void) => number;
  /** Hides the toast; with an id, only if that toast is still showing (safe for timers). */
  hideToast: (id?: number) => void;

  reviewDraft: ReviewDraft | null;
  setReviewDraft: (draft: ReviewDraft) => void;
  updateDraftItem: (index: number, item: MealItem) => void;
  removeDraftItem: (index: number) => void;
  addDraftItem: (item: MealItem) => void;
  updateDraftMeta: (patch: Partial<ReviewMeta>) => void;
  clearReviewDraft: () => void;

  logText: string;
  setLogText: (text: string) => void;

  /**
   * The Log sheet's Place · time · slot, kept when a logging step goes back to the sheet
   * (Estimating → Cancel), so the reopened sheet still has the time the check-in set.
   */
  logResume: LogResume | null;
  setLogResume: (resume: LogResume | null) => void;
}

/** What the Log sheet picks back up after Cancel on S10. */
export type LogResume = Pick<ReviewMeta, 'placeId' | 'placeName' | 'eatenAt' | 'slot' | 'timeFromSlot'>;

let lastToastId = 0;

type UiData = Pick<UiState, 'toast' | 'reviewDraft' | 'logText' | 'logResume'>;

const INITIAL: UiData = { toast: null, reviewDraft: null, logText: '', logResume: null };

export const useUiStore = create<UiState>()((set) => ({
  ...INITIAL,

  showToast: (message, undo) => {
    lastToastId += 1;
    const toast: Toast = undo ? { id: lastToastId, message, undo } : { id: lastToastId, message };
    set({ toast });
    return toast.id;
  },
  hideToast: (id) =>
    set((state) => (state.toast && (id === undefined || state.toast.id === id) ? { toast: null } : state)),

  setReviewDraft: (draft) => set({ reviewDraft: draft }),
  updateDraftItem: (index, item) =>
    set((state) => {
      const draft = state.reviewDraft;
      if (!draft || index < 0 || index >= draft.items.length) return state;
      return { reviewDraft: { ...draft, items: draft.items.map((it, i) => (i === index ? item : it)) } };
    }),
  removeDraftItem: (index) =>
    set((state) => {
      const draft = state.reviewDraft;
      if (!draft || index < 0 || index >= draft.items.length) return state;
      return { reviewDraft: { ...draft, items: draft.items.filter((_, i) => i !== index) } };
    }),
  addDraftItem: (item) =>
    set((state) => (state.reviewDraft ? { reviewDraft: { ...state.reviewDraft, items: [...state.reviewDraft.items, item] } } : state)),
  updateDraftMeta: (patch) =>
    set((state) =>
      state.reviewDraft ? { reviewDraft: { ...state.reviewDraft, meta: { ...state.reviewDraft.meta, ...patch } } } : state,
    ),
  clearReviewDraft: () => set({ reviewDraft: null }),

  setLogText: (text) => set({ logText: text }),
  setLogResume: (resume) => set({ logResume: resume }),
}));

/** Back to the initial state (tests, "delete everything"). */
export function resetUiState(): void {
  useUiStore.setState(INITIAL);
}
