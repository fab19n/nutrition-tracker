import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { deleteMeal, loadDemoData, resetAll, saveMeal } from '@/db/actions';
import { putDayRecord } from '@/db/repo';
import { resetUiState, useUiStore } from '@/state/ui';
import BudgetSheet from './BudgetSheet';

function renderSheet() {
  const close = vi.fn();
  const router = createMemoryRouter([{ path: '/', element: <BudgetSheet close={close} /> }], { initialEntries: ['/?sheet=budget'] });
  render(<RouterProvider router={router} />);
  return { router, close };
}

/** The value next to a row's label. */
async function rowValue(label: string): Promise<string> {
  const term = await screen.findByText(label, { selector: 'dt, dt *' });
  const row = term.closest('div');
  return within(row as HTMLElement).getByRole('definition').textContent ?? '';
}

describe('BudgetSheet (S17)', () => {
  beforeEach(async () => {
    resetUiState();
    await resetAll();
    await loadDemoData();
  });

  afterEach(() => resetUiState());

  it('shows the week’s maths: 12,600 budget, 7,780 eaten, +650 saved, 4,820 left', async () => {
    renderSheet();
    expect(await screen.findByRole('heading', { name: "This week's budget" })).toBeInTheDocument();
    expect(await rowValue('Weekly budget')).toBe('12,600');
    expect(screen.getByText('7 × 1,800')).toBeInTheDocument();
    expect(await rowValue('Workouts added')).toBe('+0');
    expect(await rowValue('Eaten so far')).toBe('7,780');
    expect(screen.getByText('Mon–Fri')).toBeInTheDocument();
    expect(await rowValue('Saved from finished days')).toBe('+650');
    expect(await rowValue('Left this week')).toBe('4,820');
    expect(screen.getByText(/Each week starts fresh on Monday\. No day goes below your 1,400 minimum\./)).toBeInTheDocument();
    expect(screen.queryByText('Waiting for check-in')).not.toBeInTheDocument();
  });

  it('says a paused week is out of trends, with no makan day to plan', async () => {
    await db.goalPeriods.update('goal-period-cut-1', { to: '2026-10-16' });
    await db.goalPeriods.put({ id: 'pause-today', goalId: 'goal-pause', from: '2026-10-16' });
    renderSheet();
    expect(await screen.findByText('Your budget is off for now. Logging is optional, and these days stay out of trends.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /makan day/ })).not.toBeInTheDocument();
  });

  it('opens the makan-day sheet', async () => {
    const user = userEvent.setup();
    const { router } = renderSheet();
    await user.click(await screen.findByRole('button', { name: 'Change makan day' }));
    expect(router.state.location.search).toBe('?sheet=makan');
  });

  it('adds a one-off bonus to today and the week, with Undo', async () => {
    const user = userEvent.setup();
    renderSheet();
    const toggle = await screen.findByRole('button', { name: /One-off bonus today/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    // The OneOffBonus card (C52): an empty amount says what's missing and saves nothing.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const form = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(form).not.toBeNull();
    const add = within(form as HTMLElement).getByRole('button', { name: 'Add bonus' });
    const amount = screen.getByRole('textbox', { name: 'Extra kcal today' });
    expect(amount).toHaveFocus();
    await user.click(add);
    expect(await screen.findByText('Enter how many kcal to add.')).toBeInTheDocument();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(await db.bonuses.count()).toBe(0);

    await user.type(amount, '300');
    await user.type(screen.getByRole('textbox', { name: 'Reason (optional)' }), 'Hike');
    await user.click(add);
    // Saving is async: the form closes once the bonus is stored.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));

    expect(await rowValue('One-off bonus')).toBe('+300');
    expect(await screen.findByText('5,120')).toBeInTheDocument();
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Bonus added · +300 kcal today');
    expect((await db.bonuses.toArray()).map((b) => [b.kcal, b.reason])).toEqual([[300, 'Hike']]);

    toast?.undo?.();
    expect(await screen.findByText('4,820')).toBeInTheDocument();
    expect(await db.bonuses.count()).toBe(0);
  });

  it('explains how a shortfall spreads over the days left', async () => {
    await saveMeal({
      flow: 'text',
      title: 'Check your meal',
      items: [
        {
          id: 'big',
          name: 'Open house feast',
          unitMacros: { kcal: 2000, proteinG: 60, carbsG: 220, fatG: 90 },
          quantity: 1,
          uncertainty: 0.25,
          source: 'catalogue',
        },
      ],
      meta: { method: 'manual', slot: 'dinner', eatenAt: '2026-10-16T11:05:00.000Z' },
    });
    renderSheet();
    // Over by 1,430 today, 650 saved: 780 comes off Sat and Sun.
    expect(await screen.findByText('Sat and Sun allowance: 1,410 each, never below your 1,400 minimum.')).toBeInTheDocument();
  });

  it('shows savings waiting for the check-in', async () => {
    await deleteMeal('meal-2026-10-15-dinner');
    await putDayRecord(db, { logicalDay: '2026-10-15', status: 'unconfirmed' });
    renderSheet();
    expect(await rowValue('Saved from finished days')).toBe('+530');
    expect(await rowValue('Waiting for check-in')).toMatch(/^\+[\d,]+$/);
    expect(screen.getByText(/added once you confirm it/)).toBeInTheDocument();
  });
});
