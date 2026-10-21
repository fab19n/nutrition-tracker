import { screen, within } from '@testing-library/react';
import { DEMO_IDS } from '@/db/seed/demo';
import { nav, setupFlows, SLOW, startApp } from './harness';

setupFlows();

describe('Search · find any meal you have logged', () => {
  it('Diary → Search → kangkung → open a result → Back → clear → Back', async () => {
    const { user, router } = startApp('/diary');
    await user.click(await screen.findByRole('button', { name: 'Search your diary' }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diary/search');
    // A sub-screen: the keyboard gets the room.
    expect(nav()).toBeNull();

    const field = await screen.findByRole('searchbox', { name: 'Search your diary' }, SLOW);
    expect(field).toHaveFocus();
    await user.type(field, 'kangkung{Enter}');
    expect(await screen.findByText('4 meals', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=kangkung');

    // Newest first: today's lunch is the top row, and says why it matched.
    const top = screen.getAllByRole('listitem')[0] as HTMLElement;
    expect(top).toHaveTextContent('Lunch · 2:15pm · Kedai near home · RM 9.50');
    expect(within(top).getByText('Economy rice')).toBeInTheDocument();
    expect(within(top).getByText('Includes Kangkung belacan')).toBeInTheDocument();

    await user.click(within(top).getByRole('button'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Entry' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/diary/entry/${DEMO_IDS.meals.todayLunch}`);

    // Back is the results as they were.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('searchbox', { name: 'Search your diary' }, SLOW)).toHaveValue('kangkung');
    expect(await screen.findByText('4 meals', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=kangkung');
    expect(nav()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText("Search by dish, drink or Place. Spacing and capitals don't matter.")).toBeInTheDocument();
    expect(screen.queryByText('4 meals')).toBeNull();

    // Typing and clearing never added history entries: one Back is the Diary.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Diary' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diary');
    expect(nav()).not.toBeNull();
  });

  it('sends an old Search link to Search, replacing the placeholder', async () => {
    const { router } = startApp('/more/soon/search');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diary/search');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByText('Coming in the next build')).toBeNull();
  });

  it('opens on a deep link with the text and the slot filter already set', async () => {
    startApp('/diary/search?q=medan&slot=dinner');
    expect(await screen.findByText('2 meals', {}, SLOW)).toBeInTheDocument();
    const slots = screen.getByRole('group', { name: 'Meal slot' });
    expect(within(slots).getByRole('button', { name: 'Dinner' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(slots).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('searchbox', { name: 'Search your diary' })).toHaveValue('medan');
  });

  it('is reached from the Week view too', async () => {
    const { user, router } = startApp('/diary/week');
    await user.click(await screen.findByRole('button', { name: 'Search your diary' }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diary/search');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('radio', { name: 'Week' }, SLOW)).toHaveAttribute('aria-checked', 'true');
  });
});
