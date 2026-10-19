import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { deleteMeal, loadDemoData, resetAll } from '@/db/actions';
import { putDayRecord } from '@/db/repo';
import { CHECK_IN_PROMPT } from '@/db/selectors';
import { resetUiState, useUiStore } from '@/state/ui';
import CheckInSheet from './CheckInSheet';

const YESTERDAY = '2026-10-15';

function renderSheet(entry = '/?sheet=checkin') {
  const close = vi.fn();
  const router = createMemoryRouter([{ path: '/', element: <CheckInSheet close={close} /> }], { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return { router, close };
}

/** Yesterday without its dinner, not yet confirmed: the design's scenario B. */
async function incompleteYesterday() {
  await deleteMeal(`meal-${YESTERDAY}-dinner`);
  await putDayRecord(db, { logicalDay: YESTERDAY, status: 'unconfirmed' });
}

describe('CheckInSheet (S15)', () => {
  beforeEach(async () => {
    resetUiState();
    await resetAll();
    await loadDemoData();
  });

  afterEach(() => resetUiState());

  it('asks about an incomplete yesterday with its timeline, gap and four answers', async () => {
    await incompleteYesterday();
    renderSheet();

    expect(await screen.findByRole('heading', { name: /^Yesterday · 2 meals · [\d,]+ kcal$/ })).toBeInTheDocument();
    expect(screen.getByText('Good evening')).toBeInTheDocument();
    expect(screen.getByText(/^Nothing logged for \d+ hours after 1:30pm\. You usually have dinner around/)).toBeInTheDocument();
    expect(screen.getByText('9:30am')).toBeInTheDocument();
    expect(screen.getByText('1:30pm')).toBeInTheDocument();
    expect(await screen.findByText(/^usual dinner /)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Yesterday: meals at 9:30am and 1:30pm, then nothing for \d+ hours\.$/ })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Was that everything?' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      "Yes, that's all I ate",
      expect.stringMatching(/^I had dinner\. Fill in a typical one \(~[\d,]+\)$/),
      'I ate more. Let me add it',
      "Don't count this day",
    ]);
    expect(screen.getByText(CHECK_IN_PROMPT)).toBeInTheDocument();
  });

  it('fills in a typical dinner as a guess', async () => {
    await incompleteYesterday();
    const user = userEvent.setup();
    const { close } = renderSheet();

    await user.click(await screen.findByRole('radio', { name: /Fill in a typical one/ }));
    expect(screen.getByText(/^Adds ~[\d,]+ kcal to this week's budget, marked as a guess\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect((await db.days.get(YESTERDAY))?.status).toBe('guess'));
    const guesses = (await db.meals.where('logicalDay').equals(YESTERDAY).toArray()).filter((m) => m.isGuess);
    expect(guesses.map((m) => m.name)).toEqual(['Typical dinner']);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Yesterday · typical dinner added as a guess');

    toast?.undo?.();
    await vi.waitFor(async () => expect((await db.days.get(YESTERDAY))?.status).toBe('unconfirmed'));
  });

  it('"Let me add it" opens Log at last night’s usual dinner time', async () => {
    await incompleteYesterday();
    const user = userEvent.setup();
    const { router, close } = renderSheet();

    await user.click(await screen.findByRole('radio', { name: 'I ate more. Let me add it' }));
    expect(screen.getByText('Opens Log with the time set to last night.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('sheet')).toBe('log');
    expect(params.get('at')).toMatch(/^2026-10-15T1\d:\d\d:00\.000Z$/);
    expect(close).not.toHaveBeenCalled();
    expect((await db.days.get(YESTERDAY))?.status).toBe('unconfirmed');
  });

  it('confirms a day that looks complete with the light "All there?" card', async () => {
    await putDayRecord(db, { logicalDay: YESTERDAY, status: 'unconfirmed' });
    const user = userEvent.setup();
    const { close } = renderSheet();

    expect(await screen.findByRole('heading', { name: /^Yesterday: 3 meals, [\d,]+ kcal\. All there\?$/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes' }));

    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect((await db.days.get(YESTERDAY))?.status).toBe('complete'));
    expect(useUiStore.getState().toast?.message).toBe('Yesterday confirmed');
  });

  it('answers older waiting days one at a time and says how many remain', async () => {
    await putDayRecord(db, { logicalDay: YESTERDAY, status: 'unconfirmed' });
    await putDayRecord(db, { logicalDay: '2026-10-14', status: 'unconfirmed' });
    const user = userEvent.setup();
    const { close } = renderSheet();

    expect(await screen.findByText('Good evening · 1 more day after this')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes' }));

    expect(await screen.findByRole('heading', { name: /^Wed 14 Oct: \d meals, [\d,]+ kcal\. All there\?$/ })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText('Good evening')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(close).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect((await db.days.get('2026-10-14'))?.status).toBe('complete'));
    expect(useUiStore.getState().toast?.message).toBe('Wed 14 Oct confirmed');
  });

  it("asks about the Diary's day first when opened from it, then the rest", async () => {
    await putDayRecord(db, { logicalDay: YESTERDAY, status: 'unconfirmed' });
    await putDayRecord(db, { logicalDay: '2026-10-14', status: 'unconfirmed' });
    const user = userEvent.setup();
    // The Diary on Wed 14 Oct opens the sheet over its own ?day=.
    const { close } = renderSheet('/?day=2026-10-14&sheet=checkin');

    expect(await screen.findByRole('heading', { name: /^Wed 14 Oct: \d meals, [\d,]+ kcal\. All there\?$/ })).toBeInTheDocument();
    expect(screen.getByText('Good evening · 1 more day after this')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await vi.waitFor(async () => expect((await db.days.get('2026-10-14'))?.status).toBe('complete'));

    expect(await screen.findByRole('heading', { name: /^Yesterday: \d meals, [\d,]+ kcal\. All there\?$/ })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
