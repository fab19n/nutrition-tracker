import { screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { mealMacros } from '@/domain/meal';
import { findDialog, findHero, findWeekBars, nav, setupFlows, SLOW, startApp } from './harness';

const SENTENCE = 'nasi kandar ayam goreng, kubis, kuah campur, teh o ais';
const TODAY = '2026-10-16';

setupFlows();

describe('F02 · mamak meal by text', () => {
  it('logs a typed meal, fixes the kuah, saves, updates Today and undoes', async () => {
    const { user, router } = startApp('/');

    // Today on the demo Friday: 570 left, Friday's bar at 1,230.
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(await findWeekBars(/today 1,230 of 1,800/)).toBeInTheDocument();

    // + opens the Log sheet over Today, nav still showing.
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    expect(router.state.location.search).toBe('?sheet=log');
    expect(nav()).not.toBeNull();

    // This meal is at Medan selera (the sheet starts on the Place you ate at last).
    await user.click(await within(sheet).findByRole('button', { name: /^Place:\s*Kedai near home/ }, SLOW));
    const picker = await findDialog('Where did you eat?');
    await user.click(within(picker).getByRole('button', { name: /Medan selera nearby/ }));
    expect(await within(sheet).findByRole('button', { name: /^Place:\s*Medan selera nearby/ })).toBeInTheDocument();

    await user.click(within(sheet).getByRole('textbox', { name: 'What did you eat?' }));
    await user.paste(SENTENCE);
    await user.click(within(sheet).getByRole('button', { name: 'Estimate' }));

    // S10 → S11 with the local estimator; no nav on the logging sub-screens.
    expect(await screen.findByRole('heading', { name: 'Check your meal' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/log/review');
    expect(nav()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Log food' })).toBeNull();
    expect(screen.getByText('880 kcal')).toBeInTheDocument();
    expect(screen.getByText('likely 750–1,010')).toBeInTheDocument();

    const kuah = screen.getByRole('group', { name: 'Kuah campur portion' });
    await user.click(within(kuah).getByRole('button', { name: 'Banjir' }));
    expect(screen.getByText('980 kcal')).toBeInTheDocument();
    expect(await screen.findByText('After this: 410 over today · covered by your +650 saved')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The toast offers Undo; resting the pointer on it holds it while we look around.
    const toast = await screen.findByText('Saved · ~980 kcal', {}, SLOW);
    await user.hover(toast);

    // Back on Today: the hero and Friday's bar follow the new meal.
    expect(await findHero(/^410 kcal over today\. Covered by your \+650 saved\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(nav()).not.toBeNull();
    expect(screen.getByText('Over today')).toBeInTheDocument();
    expect(await findWeekBars(/today 2,210 of 1,800/)).toBeInTheDocument();
    expect(screen.getByText('2,210 eaten · window closes 10:40pm')).toBeInTheDocument();
    expect(screen.getByText('Saved · ~980 kcal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    const saved = (await db.meals.where('logicalDay').equals(TODAY).toArray()).find((m) => m.text === SENTENCE);
    expect(saved && Math.round(mealMacros(saved).kcal)).toBe(980);
    expect(saved?.slot).toBe('dinner');
    // The new dinner row is on Today, and the empty dinner slot is gone.
    expect(await screen.findByText(saved?.name ?? '')).toBeInTheDocument();
    expect(screen.getByText('Dinner · 7:10pm · Medan selera nearby')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meal ideas for dinner' })).toBeNull();

    // Undo takes the meal back off.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(await findWeekBars(/today 1,230 of 1,800/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Saved · ~980 kcal')).toBeNull());
    expect((await db.meals.where('logicalDay').equals(TODAY).toArray()).some((m) => m.text === SENTENCE)).toBe(false);
  });
});
