import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { getInsightFeedback } from '@/db/repo';
import { resetUiState, useUiStore } from '@/state/ui';
import EvidenceSheet from './EvidenceSheet';

function renderSheet(rule: string, close = vi.fn()) {
  const router = createMemoryRouter(
    [
      { path: PATHS.insights, element: <EvidenceSheet close={close} /> },
      { path: '/diary/entry/:id', element: <p>Entry route</p> },
    ],
    { initialEntries: [`${PATHS.insights}?sheet=evidence&rule=${rule}`] },
  );
  render(<RouterProvider router={router} />);
  return { router, close };
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterAll(async () => {
  await resetAll();
});

describe('S32 EvidenceSheet', () => {
  it('shows the summary, a bar by day and the 11 drinks', async () => {
    renderSheet('categoryShare');
    expect(await screen.findByRole('heading', { name: 'Drinks were 17% of your calories' })).toBeInTheDocument();
    expect(screen.getByText('11 drinks last week · ~2,170 kcal')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Most on Saturday/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Teh tarik|Milo ais/ })).toHaveLength(11);
    expect(screen.getByRole('heading', { name: 'Sat 10 Oct' })).toBeInTheDocument();
  });

  it('pauses the insight with "Not for me", with undo in the toast', async () => {
    const { close } = renderSheet('categoryShare');
    await userEvent.click(await screen.findByRole('button', { name: 'Not for me' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect((await getInsightFeedback(db, 'categoryShare'))?.feedback).toBe('notForMe');
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Paused for 4 weeks');
    toast?.undo?.();
    await waitFor(async () => expect(await getInsightFeedback(db, 'categoryShare')).toBeUndefined());
  });

  it('opens a meal from its row', async () => {
    const { router } = renderSheet('placeComparison');
    expect(await screen.findByText('4 visits last week · ~3,800 kcal')).toBeInTheDocument();
    const [first] = screen.getAllByRole('button', { name: /Nasi kandar ayam goreng/ });
    await userEvent.click(first!);
    expect(await screen.findByText('Entry route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.entry('meal-2026-10-05-dinner'));
  });

  it('says so for an insight with nothing behind it', async () => {
    renderSheet('lateEating');
    expect(await screen.findByText('Nothing to show here')).toBeInTheDocument();
  });
});
