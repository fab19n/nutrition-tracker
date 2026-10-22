// @vitest-environment node
import type { UnlockProgressProps } from '@/components/UnlockProgress/UnlockProgress';
import type { DishCheckStatus, DishCheckSummary } from '@/db/dishCheck';
import {
  cardCopy,
  changeLine,
  dishUnlockItem,
  doneBody,
  finishToast,
  footerModel,
  kcalLabel,
  resultLine,
  rowDetail,
  summaryRows,
  unlockListModel,
} from './dishCheckModel';

const TZ = 'Asia/Kuala_Lumpur';

function status(over: Partial<DishCheckStatus> = {}): DishCheckStatus {
  return { phase: 'ready', loggedDays: 19, dishCount: 12, total: 12, answered: 0, hidden: false, ...over };
}

describe('kcalLabel and rowDetail', () => {
  it('rounds to 10 with a tilde', () => {
    expect(kcalLabel(204)).toBe('~200');
    expect(kcalLabel(235)).toBe('~240');
    expect(kcalLabel(1234)).toBe('~1,230');
  });

  it('joins the portion, the Place and the times', () => {
    expect(rowDetail({ portion: 'Normal', times: 8 })).toBe('Normal · 8 times');
    expect(rowDetail({ portion: 'Mamak big', placeName: 'Nasi kandar near home', times: 6 })).toBe('Mamak big · Nasi kandar near home · 6 times');
    expect(rowDetail({ portion: '1 portion', times: 1234 })).toBe('1 portion · 1,234 times');
  });
});

describe('resultLine', () => {
  it('is empty before an answer', () => {
    expect(resultLine({ kcal: 200 })).toBeUndefined();
  });

  it('says no change, or that an AI guess was saved as yours', () => {
    expect(resultLine({ answer: 'right', kcal: 200, fromKcal: 200 })).toBe('Looks right. No change.');
    expect(resultLine({ answer: 'right', saved: true, kcal: 304, fromKcal: 304 })).toBe('Looks right. Saved as yours at ~300 kcal.');
  });

  it('shows the live number and what it was, to the nearest 10', () => {
    expect(resultLine({ answer: 'more', kcal: 250, fromKcal: 200 })).toBe('Usually more. Now ~250 kcal (was ~200).');
    expect(resultLine({ answer: 'less', kcal: 160, fromKcal: 200 })).toBe('Usually less. Now ~160 kcal (was ~200).');
    expect(resultLine({ answer: 'more', kcal: 540, fromKcal: 430 })).toBe('Usually more. Now ~540 kcal (was ~430).');
  });

  it('falls back to the live number when the old one was not kept', () => {
    expect(resultLine({ answer: 'less', kcal: 160 })).toBe('Usually less. Now ~160 kcal (was ~160).');
  });
});

describe('cardCopy', () => {
  it('invites a ready check, once', () => {
    expect(cardCopy(status({ total: 30 }))).toEqual({
      title: 'Check your top dishes',
      body: 'Your 30 most-logged dishes, once. About 2 minutes.',
      primaryLabel: 'Start',
    });
  });

  it('picks up where an unfinished check left off', () => {
    expect(cardCopy(status({ phase: 'inProgress', total: 30, answered: 12 }))).toEqual({
      title: 'Top dishes check',
      body: '12 of 30 checked. Pick up where you left off.',
      primaryLabel: 'Continue',
    });
  });

  it('is gone while hidden, locked, thin or done', () => {
    expect(cardCopy(status({ hidden: true }))).toBeUndefined();
    expect(cardCopy(status({ phase: 'inProgress', hidden: true, answered: 1 }))).toBeUndefined();
    expect(cardCopy(status({ phase: 'locked' }))).toBeUndefined();
    expect(cardCopy(status({ phase: 'thin' }))).toBeUndefined();
    expect(cardCopy(status({ phase: 'done' }))).toBeUndefined();
  });
});

describe('dishUnlockItem', () => {
  const open = vi.fn();

  it('counts logged days while locked', () => {
    expect(dishUnlockItem(status({ phase: 'locked', loggedDays: 9 }), open)).toEqual({ label: 'Top dishes check', have: 9, need: 14, unit: 'days' });
  });

  it('counts dishes logged twice or more while thin', () => {
    expect(dishUnlockItem(status({ phase: 'thin', dishCount: 3 }), open)).toEqual({ label: 'Top dishes check', have: 3, need: 5, unit: 'dishes' });
  });

  it('is tappable once ready, in progress or done', () => {
    expect(dishUnlockItem(status(), open)).toEqual({ label: 'Top dishes check', have: 0, need: 1, valueLabel: 'Ready', onPress: open });
    expect(dishUnlockItem(status({ phase: 'inProgress', answered: 12, total: 30 }), open)).toEqual({
      label: 'Top dishes check',
      have: 12,
      need: 30,
      valueLabel: '12 of 30 checked',
      onPress: open,
    });
    expect(dishUnlockItem(status({ phase: 'done', answered: 20, total: 30 }), open)).toEqual({
      label: 'Top dishes check',
      have: 30,
      need: 30,
      valueLabel: 'Checked',
      onPress: open,
    });
  });
});

describe('unlockListModel', () => {
  const open = vi.fn();
  const unlocks: UnlockProgressProps[] = [
    { label: 'Timing patterns', have: 17, need: 14 },
    { label: 'Your real maintenance', have: 17, need: 21 },
  ];

  it('puts the dish row after Timing patterns', () => {
    const { items, show } = unlockListModel(unlocks, status(), open);
    expect(items.map((i) => i.label)).toEqual(['Timing patterns', 'Top dishes check', 'Your real maintenance']);
    expect(show).toBe(true);
  });

  it('appends it when Timing patterns is not listed', () => {
    const { items } = unlockListModel([{ label: 'Your real maintenance', have: 2, need: 21 }], status({ phase: 'locked', loggedDays: 2 }), open);
    expect(items.map((i) => i.label)).toEqual(['Your real maintenance', 'Top dishes check']);
  });

  it('shows the section while something is locked, or the check is ready or under way', () => {
    const done = [{ label: 'Timing patterns', have: 17, need: 14 }];
    expect(unlockListModel(done, status({ phase: 'done', total: 30 }), open).show).toBe(false);
    expect(unlockListModel(done, status({ phase: 'locked', loggedDays: 3 }), open).show).toBe(true);
    expect(unlockListModel(done, status({ phase: 'thin', dishCount: 2 }), open).show).toBe(true);
    expect(unlockListModel(done, status(), open).show).toBe(true);
    // Every dish answered, Done not pressed yet: the row stays.
    expect(unlockListModel(done, status({ phase: 'inProgress', answered: 30, total: 30 }), open).show).toBe(true);
    expect(unlockListModel(unlocks, status({ phase: 'done', total: 30 }), open).show).toBe(true);
  });

  it('does not change the list it is given', () => {
    unlockListModel(unlocks, status(), open);
    expect(unlocks).toHaveLength(2);
  });
});

describe('footerModel', () => {
  it('offers Not now before the first answer', () => {
    expect(footerModel({ answered: 0, total: 30 })).toEqual({ label: 'Not now', variant: 'secondary' });
  });

  it('asks before finishing with dishes left', () => {
    expect(footerModel({ answered: 12, total: 30 })).toEqual({
      label: 'Done',
      variant: 'primary',
      caption: '18 not checked yet',
      confirm: {
        title: 'Finish the check?',
        body: "18 dishes haven't been checked, and they won't be asked again. Your answers so far are saved.",
        confirmLabel: 'Finish',
        cancelLabel: 'Keep checking',
      },
    });
    expect(footerModel({ answered: 29, total: 30 }).confirm?.body).toBe("1 dish hasn't been checked, and it won't be asked again. Your answers so far are saved.");
  });

  it('finishes straight away once every dish is answered, or none is left', () => {
    expect(footerModel({ answered: 30, total: 30 })).toEqual({ label: 'Done', variant: 'primary' });
    expect(footerModel({ answered: 0, total: 0 })).toEqual({ label: 'Done', variant: 'primary' });
  });
});

describe('finishToast, doneBody, summaryRows and changeLine', () => {
  it('counts what was updated', () => {
    expect(finishToast(3)).toBe('Top dishes checked · 3 updated');
    expect(finishToast(0)).toBe('Top dishes checked · nothing to change');
  });

  it('dates the finish on its logical day', () => {
    // Fri 16 Oct, 7:10pm in Kuala Lumpur.
    expect(doneBody({ answered: 12, total: 30, doneAt: '2026-10-16T11:10:00.000Z' }, TZ, 5)).toBe('12 of 30 dishes checked on Fri 16 Oct.');
    // 1:30am on Sat is still Friday's logical day.
    expect(doneBody({ answered: 1, total: 1, doneAt: '2026-10-16T17:30:00.000Z' }, TZ, 5)).toBe('1 of 1 dish checked on Fri 16 Oct.');
    expect(doneBody({ answered: 2, total: 5 }, TZ, 5)).toBe('2 of 5 dishes checked.');
  });

  it('lists the answers, and Not checked only when something was left', () => {
    const summary: DishCheckSummary = { right: 8, more: 2, less: 1, notChecked: 0, updated: 3, changes: [] };
    expect(summaryRows(summary)).toEqual([
      { label: 'Looks right', count: 8 },
      { label: 'Usually more', count: 2 },
      { label: 'Usually less', count: 1 },
    ]);
    expect(summaryRows({ ...summary, notChecked: 4 }).at(-1)).toEqual({ label: 'Not checked', count: 4 });
  });

  it('writes a change as was and now', () => {
    expect(changeLine({ fromKcal: 200, toKcal: 250 })).toBe('was ~200, now ~250 kcal');
    expect(changeLine({ fromKcal: 430, toKcal: 330 })).toBe('was ~430, now ~330 kcal');
  });
});
