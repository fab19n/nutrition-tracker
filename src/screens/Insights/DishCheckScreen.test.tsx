/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DISH_CHECK_FEEDBACK_ID, answerDish, finishDishCheck, getDishCheckViewIn } from '@/db/dishCheck';
import { instantAt } from '@/domain/day';
import type { MealItem, MealLog } from '@/domain/types';
import { resetUiState, useUiStore } from '@/state/ui';
import DishCheckScreen from './DishCheckScreen';
import { useDishCheckActions } from './useDishCheckActions';

// A save that can be made to fail, to check the error toast. Otherwise the real action runs.
const saves = vi.hoisted(() => ({ failNext: false }));
vi.mock('@/db/dishCheck', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/dishCheck')>();
  return {
    ...real,
    answerDish: (...args: Parameters<typeof real.answerDish>) => {
      if (saves.failNext) {
        saves.failNext = false;
        return Promise.reject(new Error('disk full'));
      }
      return real.answerDish(...args);
    },
  };
});

const SLOW = { timeout: 4000 };
const RICE = 'Rice (economy rice)';

function Stub({ name }: { name: string }) {
  const location = useLocation();
  return (
    <h1>
      {name} screen {location.pathname}
    </h1>
  );
}

/** `history`: opened from Insights (Back goes there); else a deep link (Back replaces with Insights). */
function renderDishCheck({ history = true }: { history?: boolean } = {}) {
  const router = createMemoryRouter(
    [
      { path: PATHS.dishes, element: <DishCheckScreen /> },
      { path: PATHS.insights, element: <Stub name="Insights" /> },
    ],
    history ? { initialEntries: [PATHS.insights, PATHS.dishes], initialIndex: 1 } : { initialEntries: [PATHS.dishes] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup(), ...view };
}

/** A dish's row: the card around its answer buttons. */
function rowOf(name: string, kcal: string): HTMLElement {
  const group = screen.getByRole('group', { name: `${name}: is ${kcal} kcal right?` });
  const item = group.closest('li');
  if (!item) throw new Error(`No row for ${name}`);
  return item;
}

const answerButton = (row: HTMLElement, name: string) => within(row).getByRole('button', { name });
const toastMessage = () => useUiStore.getState().toast?.message;
const progress = () => screen.getByRole('progressbar', { name: 'Dishes checked' });

function typedItem(name: string, id: string): MealItem {
  return { id, name, unitMacros: { kcal: 300, proteinG: 5, carbsG: 20, fatG: 5 }, quantity: 1, uncertainty: 0.15, source: 'yourCorrection' };
}

/** One meal a day on Oct 3 … Oct 16 (14 days) with the given dish names. */
function diary(perDay: (index: number) => string[]): MealLog[] {
  return Array.from({ length: 14 }, (_, index) => {
    const day = `2026-10-${String(3 + index).padStart(2, '0')}`;
    return {
      id: `meal-${index}`,
      eatenAt: instantAt(day, 13, 30),
      logicalDay: day,
      slot: 'lunch',
      name: 'Lunch',
      items: perDay(index).map((name, n) => typedItem(name, `item-${index}-${n}`)),
      method: 'text',
      finished: 'all',
      createdAt: instantAt(day, 13, 32),
      updatedAt: instantAt(day, 13, 32),
      syncState: 'local',
    } satisfies MealLog;
  });
}

beforeEach(async () => {
  resetUiState();
  saves.failNext = false;
  await resetAll();
  await loadDemoData();
});

afterEach(() => {
  resetUiState();
});

afterAll(async () => {
  await resetAll();
});

describe('S34 DishCheckScreen on the demo world (day 19)', () => {
  it('shows a skeleton while it loads', () => {
    renderDishCheck();
    expect(screen.getByRole('heading', { level: 1, name: 'Top dishes check' })).toBeInTheDocument();
    expect(screen.getByText('Loading your dishes')).toBeInTheDocument();
  });

  it('lists your dishes with where each number comes from, nothing answered yet', async () => {
    renderDishCheck();
    expect(await screen.findByRole('list', { name: 'Dishes to check' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText(/^A one-time look at the dishes you log most\./)).toBeInTheDocument();
    expect(screen.getByText("Meals you've already logged don't change.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText('0 of 27')).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '0');
    expect(progress()).toHaveAttribute('aria-valuemax', '27');

    const items = within(screen.getByRole('list', { name: 'Dishes to check' })).getAllByRole('listitem');
    expect(items).toHaveLength(27);
    expect(items[0]).toHaveTextContent('Rice (economy rice)');
    expect(items[0]).toHaveTextContent('~200 kcal');
    expect(items[0]).toHaveTextContent('1 scoop · 25 times');

    const mamakRice = rowOf('Rice (nasi kandar)', '~430');
    expect(mamakRice).toHaveTextContent('Place default');
    expect(mamakRice).toHaveTextContent('Mamak big · Nasi kandar near home · 8 times');
    expect(rowOf('Teh o ais', '~60')).toHaveTextContent('Your correction');
    expect(rowOf('Sup sayur', '~90')).toHaveTextContent('AI guess');
    expect(rowOf(RICE, '~200')).toHaveTextContent('Catalogue');

    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID)).toBeUndefined();
  });

  it('keeps two dishes with the same name apart by their number', async () => {
    renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    expect(rowOf('Ayam goreng', '~300')).toHaveTextContent('1 piece · 8 times');
    expect(rowOf('Ayam goreng', '~280')).toHaveTextContent('a piece · 3 times');
  });

  it('answers a row: the result line, the count, and the other answers locked', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    const rice = rowOf(RICE, '~200');
    await user.click(answerButton(rice, 'Usually more'));

    expect(await within(rice).findByText('Usually more. Now ~300 kcal (was ~200).', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('1 of 27', {}, SLOW)).toBeInTheDocument();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(answerButton(rice, 'Usually more')).toHaveAttribute('aria-pressed', 'true');
    expect(answerButton(rice, 'Usually more')).toBeDisabled();
    expect(answerButton(rice, 'Looks right')).toBeDisabled();
    expect(answerButton(rice, 'Usually less')).toBeDisabled();
    expect(within(rice).getByRole('button', { name: 'Undo answer for Rice (economy rice)' })).toBeInTheDocument();
    // No toast per answer.
    expect(toastMessage()).toBeUndefined();
    // The row is now at its new number and the first answer froze the list.
    const saved = await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID);
    expect(saved?.dishCheck?.dishes).toHaveLength(27);
    expect(saved?.dishCheck?.dishes[0]).toMatchObject({ key: 'rice-economy', answer: 'more', fromKcal: 200 });
  });

  it('says what was saved when you confirm an AI guess, and nothing changes for a catalogue dish', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf('Sup sayur', '~90'), 'Looks right'));
    expect(await screen.findByText('Looks right. Saved as yours at ~90 kcal.', {}, SLOW)).toBeInTheDocument();
    await user.click(answerButton(rowOf(RICE, '~200'), 'Looks right'));
    expect(await screen.findByText('Looks right. No change.', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('2 of 27', {}, SLOW)).toBeInTheDocument();
  });

  it('shows the Place default updated at that Place', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf('Rice (nasi kandar)', '~430'), 'Usually less'));
    expect(await screen.findByText('Usually less. Now ~330 kcal (was ~430).', {}, SLOW)).toBeInTheDocument();
    // Still a Place default, now at Normal.
    const row = rowOf('Rice (nasi kandar)', '~330');
    expect(row).toHaveTextContent('Place default');
    expect(row).toHaveTextContent('Normal · Nasi kandar near home · 8 times');
  });

  it('undoes an answer: the row and the count come back, and the saved correction goes', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf('Teh o ais', '~60'), 'Usually more'));
    expect(await screen.findByText('1 of 27', {}, SLOW)).toBeInTheDocument();
    const before = await db.personalItems.get('personal-teh-o-ais');
    expect(before?.unitMacros.kcal).toBeGreaterThan(60);

    await user.click(await screen.findByRole('button', { name: 'Undo answer for Teh o ais' }, SLOW));
    expect(await screen.findByText('0 of 27', {}, SLOW)).toBeInTheDocument();
    const row = rowOf('Teh o ais', '~60');
    await waitFor(() => expect(answerButton(row, 'Usually more')).toBeEnabled(), SLOW);
    expect(within(row).queryByRole('button', { name: /^Undo answer/ })).toBeNull();
    expect((await db.personalItems.get('personal-teh-o-ais'))?.unitMacros.kcal).toBe(60);
    // The only answer is undone, so the list unfroze: no row left behind.
    expect(await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID)).toBeUndefined();
  });

  it('can answer a dish again after undoing it', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf(RICE, '~200'), 'Usually less'));
    await user.click(await screen.findByRole('button', { name: 'Undo answer for Rice (economy rice)' }, SLOW));
    await waitFor(() => expect(answerButton(rowOf(RICE, '~200'), 'Usually less')).toBeEnabled(), SLOW);
    await user.click(answerButton(rowOf(RICE, '~200'), 'Looks right'));
    expect(await screen.findByText('Looks right. No change.', {}, SLOW)).toBeInTheDocument();
  });

  it('is Not now at zero answers: back to Insights from where you came, with nothing written', async () => {
    const { user, router } = renderDishCheck();
    await user.click(await screen.findByRole('button', { name: 'Not now' }, SLOW));
    expect(await screen.findByRole('heading', { name: 'Insights screen /insights' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.insights);
    expect(await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID)).toBeUndefined();
  });

  it('replaces the deep link with Insights on Back, instead of leaving the app', async () => {
    const { user, router } = renderDishCheck({ history: false });
    await user.click(await screen.findByRole('button', { name: 'Back' }, SLOW));
    expect(await screen.findByRole('heading', { name: 'Insights screen /insights' }, SLOW)).toBeInTheDocument();
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('asks before finishing with dishes left, then finishes with a toast and Undo', async () => {
    const { user, router } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf(RICE, '~200'), 'Usually more'));
    await user.click(answerButton(rowOf('Teh tarik', '~200'), 'Looks right'));
    expect(await screen.findByText('2 of 27', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('25 not checked yet', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    const dialog = await screen.findByRole('dialog', { name: 'Finish the check?' }, SLOW);
    expect(within(dialog).getByText("25 dishes haven't been checked, and they won't be asked again. Your answers so far are saved.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep checking' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID))?.dishCheck?.doneAt).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Finish the check?' }, SLOW)).getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(toastMessage()).toBe('Top dishes checked · 1 updated'), SLOW);
    expect(await screen.findByRole('heading', { name: 'Insights screen /insights' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.insights);
    expect((await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID))?.dishCheck?.doneAt).toBeDefined();

    await act(async () => {
      useUiStore.getState().toast?.undo?.();
    });
    await waitFor(async () => expect((await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID))?.dishCheck?.doneAt).toBeUndefined(), SLOW);
    // The answers survive the undo.
    expect((await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID))?.dishCheck?.dishes.filter((d) => d.answer)).toHaveLength(2);
  });

  it('says nothing to change when only Looks right was used', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf(RICE, '~200'), 'Looks right'));
    await user.click(await screen.findByRole('button', { name: 'Done' }, SLOW));
    await user.click(within(await screen.findByRole('dialog', { name: 'Finish the check?' }, SLOW)).getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(toastMessage()).toBe('Top dishes checked · nothing to change'), SLOW);
  });

  it('resumes: answered rows stay locked without an Undo link, and the progress is kept', async () => {
    const { user, unmount } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf(RICE, '~200'), 'Usually more'));
    await user.click(answerButton(rowOf('Teh tarik', '~200'), 'Usually less'));
    expect(await screen.findByText('2 of 27', {}, SLOW)).toBeInTheDocument();
    unmount();

    renderDishCheck();
    expect(await screen.findByText('2 of 27', {}, SLOW)).toBeInTheDocument();
    const rice = rowOf(RICE, '~300');
    expect(answerButton(rice, 'Usually more')).toBeDisabled();
    expect(answerButton(rice, 'Usually more')).toHaveAttribute('aria-pressed', 'true');
    expect(within(rice).getByText('Usually more. Now ~300 kcal (was ~200).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo answer/ })).toBeNull();
    // The rest are still open.
    expect(answerButton(rowOf('Ayam goreng', '~300'), 'Looks right')).toBeEnabled();
    expect(screen.getByText('25 not checked yet')).toBeInTheDocument();
  });

  it('keeps the list and its order when you log something new in the middle of a check', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton(rowOf(RICE, '~200'), 'Looks right'));
    await screen.findByText('1 of 27', {}, SLOW);
    const names = () => within(screen.getByRole('list', { name: 'Dishes to check' })).getAllByRole('listitem').map((li) => li.querySelector('.t-item')?.textContent);
    const before = names();
    const [meal] = await db.meals.toArray();
    if (!meal) throw new Error('no meal');
    await db.meals.put({ ...meal, id: 'extra-meal', items: [{ ...typedItem('Mee goreng', 'extra'), id: 'extra' }] });
    await db.meals.put({ ...meal, id: 'extra-meal-2', items: [{ ...typedItem('Mee goreng', 'extra-2'), id: 'extra-2' }] });
    await waitFor(async () => expect((await getDishCheckViewIn(db, { today: '2026-10-16' }))?.dishCount).toBe(28), SLOW);
    expect(names()).toEqual(before);
    expect(screen.getByText('1 of 27')).toBeInTheDocument();
  });

  it('shows the summary once finished, and no answer can be changed', async () => {
    await answerDish('rice-economy', 'more');
    await answerDish('teh-tarik', 'right');
    await answerDish('rice-nasi-kandar', 'less');
    await finishDishCheck();

    const { user, router } = renderDishCheck({ history: false });
    expect(await screen.findByRole('heading', { name: 'Top dishes checked' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('3 of 27 dishes checked on Fri 16 Oct.')).toBeInTheDocument();
    const counts = document.querySelector('dl');
    expect(counts).not.toBeNull();
    expect(counts).toHaveTextContent('Looks right1');
    expect(counts).toHaveTextContent('Usually more1');
    expect(counts).toHaveTextContent('Usually less1');
    expect(counts).toHaveTextContent('Not checked24');
    const changes = screen.getByRole('list', { name: 'What changed' });
    expect(within(changes).getByText('Rice (economy rice)')).toBeInTheDocument();
    expect(within(changes).getByText('was ~200, now ~300 kcal')).toBeInTheDocument();
    expect(within(changes).getByText('Rice (nasi kandar)')).toBeInTheDocument();
    expect(within(changes).getByText('was ~430, now ~330 kcal')).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back to Insights' }));
    expect(await screen.findByRole('heading', { name: 'Insights screen /insights' }, SLOW)).toBeInTheDocument();
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('leaves Not checked out of the summary when every dish was answered', async () => {
    const view = await getDishCheckViewIn(db, { today: '2026-10-16' });
    for (const r of view?.rows ?? []) await answerDish(r.key, 'right');
    await finishDishCheck();
    renderDishCheck();
    expect(await screen.findByText('27 of 27 dishes checked on Fri 16 Oct.', {}, SLOW)).toBeInTheDocument();
    expect(document.querySelector('dl')).not.toHaveTextContent('Not checked');
    expect(screen.queryByText('What changed')).toBeNull();
  });

  it('finishes straight away, without a dialog, once every dish is answered', async () => {
    const view = await getDishCheckViewIn(db, { today: '2026-10-16' });
    for (const r of view?.rows ?? []) await answerDish(r.key, 'right');
    const { user } = renderDishCheck();
    expect(await screen.findByText('27 of 27', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText(/not checked yet/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(toastMessage()).toBe('Top dishes checked · nothing to change'), SLOW);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toasts when a save fails, and the row stays open', async () => {
    const { user } = renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    saves.failNext = true;
    const rice = rowOf(RICE, '~200');
    await user.click(answerButton(rice, 'Usually more'));
    await waitFor(() => expect(toastMessage()).toBe("Couldn't save that. Try again."), SLOW);
    expect(answerButton(rice, 'Usually more')).toBeEnabled();
    expect(screen.getByText('0 of 27')).toBeInTheDocument();
    expect(await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID)).toBeUndefined();
  });

  it('toasts "That dish changed" when the answer was already given elsewhere', async () => {
    renderDishCheck();
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    // Another device answered this dish while this screen was open.
    await answerDish('rice-economy', 'right');
    const rice = rowOf(RICE, '~200');
    await waitFor(() => expect(answerButton(rice, 'Usually more')).toBeDisabled(), SLOW);
    // This screen still holds the old row: a tap that raced the refresh reaches the action.
    const { result } = renderHook(() => useDishCheckActions());
    await act(async () => {
      await result.current.answer({ key: 'rice-economy' }, 'more');
    });
    expect(toastMessage()).toBe('That dish changed. Have another look.');
  });
});

describe('S34 useDishCheckActions', () => {
  it('ignores a second answer for a dish while the first is saving and after it', async () => {
    const { result } = renderHook(() => useDishCheckActions());
    await act(async () => {
      await Promise.all([result.current.answer({ key: 'rice-economy' }, 'more'), result.current.answer({ key: 'rice-economy' }, 'less')]);
    });
    expect(toastMessage()).toBeUndefined();
    expect(result.current.canUndo('rice-economy')).toBe(true);
    await act(async () => {
      await result.current.answer({ key: 'rice-economy' }, 'less');
    });
    expect(toastMessage()).toBeUndefined();
    const saved = await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID);
    expect(saved?.dishCheck?.dishes.filter((d) => d.answer)).toEqual([expect.objectContaining({ key: 'rice-economy', answer: 'more' })]);
  });

  it('hides a card with Not now for 4 weeks, with a toast whose Undo brings it back', async () => {
    const { result } = renderHook(() => useDishCheckActions());
    await act(async () => {
      await result.current.dismiss();
    });
    expect(toastMessage()).toBe('Top dishes check hidden for 4 weeks');
    expect((await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID))?.pausedUntil).toBe('2026-11-13');
    await act(async () => {
      useUiStore.getState().toast?.undo?.();
    });
    await waitFor(async () => expect(await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID)).toBeUndefined(), SLOW);
  });
});

describe('S34 DishCheckScreen before there is enough to check', () => {
  it('is locked under 14 days, with the days so far', async () => {
    await db.meals.where('logicalDay').below('2026-10-08').delete();
    renderDishCheck();
    expect(await screen.findByRole('heading', { name: 'Top dishes unlock at 14 days' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Log meals on 14 days and your most-logged dishes are ready to check.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Days logged' })).toHaveAttribute('aria-valuenow', '9');
    expect(screen.getByText('9 of 14 days')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Dishes to check' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('is thin with 14 days but few repeats, counting the dishes logged twice', async () => {
    await db.meals.clear();
    await db.meals.bulkPut(diary((i) => [`Unique ${i}`, ...(i < 6 ? [`Repeat ${i % 3}`] : [])]));
    renderDishCheck();
    expect(await screen.findByRole('heading', { name: 'Not enough repeats yet' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Dishes you log twice or more show up here. Keep logging and check back.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Dishes logged twice or more' })).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByText('3 of 5 dishes')).toBeInTheDocument();
  });

  it('says so when a started check has no dishes left in the diary, and Done is there', async () => {
    const view = await getDishCheckViewIn(db, { today: '2026-10-16' });
    const first = view?.rows[0];
    if (!first) throw new Error('no rows');
    await answerDish(first.key, 'right');
    // Every meal goes: the frozen dishes have nothing behind them.
    await db.meals.clear();
    // loggedDays is 0 now, but the check was started, so it stays in progress.
    renderDishCheck();
    expect(await screen.findByText("These dishes aren't in your diary any more.", {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });
});

describe('S34 layout (stylesheet)', () => {
  // jsdom has no layout, so the insets are checked in the stylesheet.
  const css = readFileSync('src/screens/Insights/DishCheck.module.css', 'utf8');
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  };

  it('insets the Back to Insights row with padding, never a side margin on the full-width button', () => {
    expect(rule('.backRow')).toMatch(/padding:\s*16px var\(--pad-card-x\) 0/);
    // The button is width: 100%, so a side margin would push its right edge off the screen.
    expect(rule('.back')).not.toMatch(/margin/);
    expect(readFileSync('src/screens/Insights/DishCheckScreen.tsx', 'utf8')).not.toContain('styles.back}');
  });

  it('lines the progress card up with the empty state above it', () => {
    expect(rule('.empty')).toMatch(/padding:\s*14px var\(--pad-card-x\) 0/);
    const nested = rule('.empty .block');
    expect(nested).toMatch(/margin-left:\s*0/);
    expect(nested).toMatch(/margin-right:\s*0/);
  });
});
