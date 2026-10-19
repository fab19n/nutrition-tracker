import type { MealItem } from '@/domain/types';
import { resetUiState, useUiStore, type ReviewDraft } from './ui';

const item = (id: string, kcal: number): MealItem => ({
  id,
  name: id,
  unitMacros: { kcal, proteinG: 0, carbsG: 0, fatG: 0 },
  quantity: 1,
  uncertainty: 0.15,
  source: 'catalogue',
});

const draft = (): ReviewDraft => ({
  flow: 'plate',
  title: 'Check your plate',
  items: [item('rice', 200), item('ayam', 250)],
  meta: { method: 'plate', placeId: 'kedai', placeName: 'Kedai near home' },
  backTo: '/log/plate',
});

const ui = () => useUiStore.getState();

beforeEach(() => resetUiState());

describe('toast', () => {
  it('shows, replaces and hides toasts', () => {
    const undo = vi.fn();
    const first = ui().showToast('Saved · ~880 kcal', undo);
    expect(ui().toast).toEqual({ id: first, message: 'Saved · ~880 kcal', undo });

    const second = ui().showToast('Yesterday confirmed');
    expect(second).not.toBe(first);
    expect(ui().toast).toEqual({ id: second, message: 'Yesterday confirmed' });

    ui().hideToast(first);
    expect(ui().toast?.id).toBe(second);
    ui().hideToast(second);
    expect(ui().toast).toBeNull();

    ui().showToast('Saving for Saturday');
    ui().hideToast();
    expect(ui().toast).toBeNull();
  });
});

describe('review draft', () => {
  it('edits items in place without touching the original arrays', () => {
    const start = draft();
    ui().setReviewDraft(start);

    ui().updateDraftItem(0, item('rice', 300));
    ui().addDraftItem(item('kubis', 70));
    ui().removeDraftItem(1);
    expect(ui().reviewDraft?.items.map((i) => [i.id, i.unitMacros.kcal])).toEqual([
      ['rice', 300],
      ['kubis', 70],
    ]);
    expect(start.items.map((i) => i.id)).toEqual(['rice', 'ayam']);

    ui().updateDraftMeta({ priceRm: 9.5, finished: 'most' });
    expect(ui().reviewDraft?.meta).toEqual({ method: 'plate', placeId: 'kedai', placeName: 'Kedai near home', priceRm: 9.5, finished: 'most' });
    expect(ui().reviewDraft?.backTo).toBe('/log/plate');

    ui().clearReviewDraft();
    expect(ui().reviewDraft).toBeNull();
  });

  it('ignores out-of-range indexes and edits without a draft', () => {
    ui().addDraftItem(item('x', 1));
    ui().updateDraftMeta({ priceRm: 1 });
    expect(ui().reviewDraft).toBeNull();

    ui().setReviewDraft(draft());
    const before = ui().reviewDraft;
    ui().updateDraftItem(5, item('x', 1));
    ui().removeDraftItem(-1);
    expect(ui().reviewDraft).toBe(before);
  });
});

describe('log text', () => {
  it('keeps what was typed until reset', () => {
    ui().setLogText('nasi kandar ayam goreng, kuah campur');
    expect(ui().logText).toBe('nasi kandar ayam goreng, kuah campur');
    resetUiState();
    expect(ui().logText).toBe('');
  });
});
