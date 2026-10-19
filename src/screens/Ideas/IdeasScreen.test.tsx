import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll, saveMeal } from '@/db/actions';
import { db } from '@/db/db';
import { listSuggestionEvents } from '@/db/repo';
import { resetUiState, useUiStore } from '@/state/ui';
import IdeasScreen from './IdeasScreen';

function renderIdeas() {
  const router = createMemoryRouter(
    [
      { path: PATHS.ideas, element: <IdeasScreen /> },
      { path: PATHS.review, element: <p>Review route</p> },
      { path: PATHS.today, element: <p>Today route</p> },
    ],
    { initialEntries: [PATHS.ideas] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterAll(async () => {
  await resetAll();
});

describe('S36 IdeasScreen on the demo Friday', () => {
  it('shows what is left and three picks that fit', async () => {
    renderIdeas();
    expect(await screen.findByText('570 kcal')).toBeInTheDocument();
    expect(screen.getByText(/and ~68g protein left/)).toBeInTheDocument();
    expect(screen.getByText(/window closes 10:40pm/)).toBeInTheDocument();
    expect(await screen.findByText('Your usual')).toBeInTheDocument();
    expect(screen.getByText('Lighter swap')).toBeInTheDocument();
    expect(screen.getByText('Something different')).toBeInTheDocument();
    expect(screen.getAllByText('Fits')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^Log this:/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Surprise me' })).toBeInTheDocument();
    await waitFor(async () => expect((await listSuggestionEvents(db)).filter((e) => e.outcome === 'shown')).toHaveLength(3));
  });

  it('"Log this" hands a pre-filled draft to Review, with Back to ideas', async () => {
    const router = renderIdeas();
    const [first] = await screen.findAllByRole('button', { name: /^Log this:/ });
    const name = first!.getAttribute('aria-label')!.replace('Log this: ', '');
    await userEvent.click(first!);
    expect(await screen.findByText('Review route')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.review);
    const draft = useUiStore.getState().reviewDraft;
    expect(draft).toMatchObject({ flow: 'idea', title: 'Check your meal', backTo: PATHS.ideas, meta: { method: 'idea', name, slot: 'dinner' } });
    expect(draft!.items.length).toBeGreaterThan(0);
    await waitFor(async () => expect((await listSuggestionEvents(db)).some((e) => e.name === name && e.outcome === 'taken')).toBe(true));
  });

  it('adds a surprise pick', async () => {
    renderIdeas();
    await userEvent.click(await screen.findByRole('button', { name: 'Surprise me' }));
    expect(await screen.findAllByRole('button', { name: /^Log this:/ })).toHaveLength(4);
    // The design's three roles only, and the dashed card keeps its "Surprise me".
    expect(screen.queryByText('Surprise pick')).toBeNull();
    expect(screen.getByRole('button', { name: 'Surprise me' })).toBeInTheDocument();
    expect(screen.getAllByText(/^~[\d,]+ kcal$/).length).toBeGreaterThanOrEqual(4);
  });

  it('shows the lightest options when over budget', async () => {
    await saveMeal({
      flow: 'text',
      title: 'Check your meal',
      items: [{ id: 'big', name: 'Nasi goreng pattaya', unitMacros: { kcal: 900, proteinG: 30, carbsG: 110, fatG: 35 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' }],
      meta: { method: 'text', name: 'Nasi goreng pattaya' },
    });
    renderIdeas();
    expect(await screen.findByText('Lightest options tonight')).toBeInTheDocument();
    expect(await screen.findAllByText('Tight fit')).toHaveLength(3);
  });

  it('starts from starter picks before there is history', async () => {
    await db.meals.clear();
    renderIdeas();
    expect(await screen.findByText('Ideas get better as you log.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ayam bakar, half rice, ulam' })).toBeInTheDocument();
    expect(screen.getByText('1,800 kcal')).toBeInTheDocument();
  });
});
