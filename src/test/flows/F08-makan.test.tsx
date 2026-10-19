import { screen, waitFor, within } from '@testing-library/react';
import { planMakanDay } from '@/db/actions';
import { db } from '@/db/db';
import { findDialog, findHero, findWeekBars, nav, setupFlows, SLOW, startApp } from './harness';

const WEEK = '2026-10-12';
const SATURDAY = '2026-10-17';

setupFlows();

describe('F08 · plan a makan day', () => {
  beforeEach(async () => {
    // Start from a week with no makan day yet.
    await planMakanDay(WEEK, null);
  });

  it('plans Saturday from the hero card and Today shows the room', async () => {
    const { user, router } = startApp('/');
    expect(await screen.findByText('Sat: not planned', {}, SLOW)).toBeInTheDocument();
    expect(await findWeekBars(/Sat 1,800 planned/)).toBeInTheDocument();

    // Hero → S17 budget breakdown.
    await user.click(await findHero(/^570 kcal left today\./));
    const budget = await findDialog("This week's budget");
    expect(router.state.location.search).toBe('?sheet=budget');
    expect(nav()).not.toBeNull();
    expect(await within(budget).findByText('7 × 1,800', {}, SLOW)).toBeInTheDocument();
    expect(within(budget).getByText('+650')).toBeInTheDocument();
    expect(within(budget).getByText('4,820')).toBeInTheDocument();

    // Plan a makan day → S18 in the same panel.
    await user.click(within(budget).getByRole('button', { name: 'Plan a makan day' }));
    const makan = await findDialog('Plan a makan day');
    expect(router.state.location.search).toBe('?sheet=makan');
    const days = await within(makan).findByRole('group', { name: 'Makan day' }, SLOW);
    await user.click(within(days).getByRole('button', { name: 'Sat' }));
    expect(within(days).getByRole('button', { name: 'Sat' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(makan).getByText('Room on Saturday')).toBeInTheDocument();
    expect(within(makan).getByText('~2,450')).toBeInTheDocument();
    await user.click(within(makan).getByRole('button', { name: 'Confirm' }));

    // Back on Today with the sheet closed, the toast, and Saturday's room on the hero.
    const toast = await screen.findByText('Saving for Saturday', {}, SLOW);
    await user.hover(toast);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('');
    expect(await screen.findByText('Sat: 2,450 room', {}, SLOW)).toBeInTheDocument();
    expect(await findWeekBars(/Sat makan day, 2,450 room/)).toBeInTheDocument();
    expect((await db.weekPlans.get(WEEK))?.makanDay).toBe(SATURDAY);

    // Undo takes the plan back.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Sat: not planned', {}, SLOW)).toBeInTheDocument();
    expect((await db.weekPlans.get(WEEK))?.makanDay).toBeUndefined();
  });
});
