import { screen, within } from '@testing-library/react';
import { db } from '@/db/db';
import { findHero, nav, setupFlows, SLOW, startApp } from './harness';

setupFlows();

describe('F09 · what should I eat?', () => {
  it('logs a meal idea for dinner and Today moves on to the evening', async () => {
    const { user, router } = startApp('/');
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(await screen.findByText('Protein is behind: ~68g left. A protein-heavy dinner helps.', {}, SLOW)).toBeInTheDocument();

    // The empty dinner slot → S36 Meal ideas.
    await user.click(await screen.findByRole('button', { name: 'Meal ideas for dinner' }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Meal ideas' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/ideas');
    expect(nav()).toBeNull();

    const log = await screen.findAllByRole('button', { name: /^Log this: / }, SLOW);
    const first = log[0];
    if (!first) throw new Error('No meal ideas');
    const name = (first.getAttribute('aria-label') ?? '').replace(/^Log this: /, '');
    const card = first.closest('article');
    expect(card).not.toBeNull();
    const kcal = within(card as HTMLElement).getByText(/^~[\d,]+ kcal$/).textContent ?? '';
    await user.click(first);

    // S11 pre-filled with the idea.
    expect(await screen.findByRole('heading', { name: 'Check your meal' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/log/review');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(`Saved · ${kcal.replace(/ kcal$/, '')} kcal`, {}, SLOW)).toBeInTheDocument();

    // Today: dinner logged, the empty slot gone and the nudge moves on.
    expect(await screen.findByText(/^Dinner logged\. Window closes 10:40pm\.$/, {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByText(/Protein is behind/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Meal ideas for dinner' })).toBeNull();

    const dinners = (await db.meals.where('logicalDay').equals('2026-10-16').toArray()).filter((m) => m.slot === 'dinner');
    expect(dinners).toHaveLength(1);
    expect(dinners[0]?.method).toBe('idea');
    expect(dinners[0]?.name).toBe(name);
    expect(screen.getByText(name)).toBeInTheDocument();
  });
});
