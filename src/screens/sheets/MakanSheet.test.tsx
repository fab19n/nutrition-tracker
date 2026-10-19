import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { loadDemoData, planMakanDay, resetAll } from '@/db/actions';
import { resetUiState, useUiStore } from '@/state/ui';
import MakanSheet from './MakanSheet';

const WEEK = '2026-10-12';

function renderSheet() {
  const close = vi.fn();
  const router = createMemoryRouter([{ path: '/', element: <MakanSheet close={close} /> }], { initialEntries: ['/?sheet=makan'] });
  render(<RouterProvider router={router} />);
  return { router, close };
}

describe('MakanSheet (S18)', () => {
  beforeEach(async () => {
    resetUiState();
    await resetAll();
    await loadDemoData();
  });

  afterEach(() => resetUiState());

  it('shows the room on the planned Saturday: ~2,450', async () => {
    renderSheet();
    expect(await screen.findByRole('heading', { name: 'Plan a makan day' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sat', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sun', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other' })).toBeInTheDocument();
    expect(screen.getByText('Room on Saturday')).toBeInTheDocument();
    expect(screen.getByText('~2,450')).toBeInTheDocument();
    expect(screen.getByText('if today and the other days stay at 1,800')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove makan day' })).toBeInTheDocument();
  });

  it('moves the makan day to Sunday and says so', async () => {
    const user = userEvent.setup();
    const { close } = renderSheet();
    await user.click(await screen.findByRole('button', { name: 'Sun' }));
    expect(screen.getByText('Room on Sunday')).toBeInTheDocument();
    expect(screen.getByText('~2,450')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    // The plan is saved first; the sheet closes once it's in.
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect((await db.weekPlans.get(WEEK))?.makanDay).toBe('2026-10-18');
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Saving for Sunday');

    toast?.undo?.();
    await vi.waitFor(async () => expect((await db.weekPlans.get(WEEK))?.makanDay).toBe('2026-10-17'));
  });

  it('offers the weekdays left, today included, under Other', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(await screen.findByRole('button', { name: 'Other' }));
    expect(screen.getByRole('button', { name: 'Today', pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thu' })).not.toBeInTheDocument();
    expect(screen.getByText('Room today')).toBeInTheDocument();
    expect(screen.getByText('~2,450')).toBeInTheDocument();
    expect(screen.getByText("Today's budget plus your +650 saved")).toBeInTheDocument();
  });

  it('removes the makan day', async () => {
    const user = userEvent.setup();
    const { close } = renderSheet();
    await user.click(await screen.findByRole('button', { name: 'Remove makan day' }));
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect((await db.weekPlans.get(WEEK))?.makanDay).toBeUndefined();
    expect(useUiStore.getState().toast?.message).toBe('Makan day removed');
  });

  it('starts on Saturday when nothing is planned', async () => {
    await planMakanDay(WEEK, null);
    renderSheet();
    expect(await screen.findByRole('button', { name: 'Sat', pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove makan day' })).not.toBeInTheDocument();
    expect(screen.getByText('~2,450')).toBeInTheDocument();
  });
});
