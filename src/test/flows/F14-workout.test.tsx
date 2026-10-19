import { screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { findHero, findWeekBars, nav, setupFlows, SLOW, startApp } from './harness';

const TODAY = '2026-10-16';

setupFlows();

describe('F14 · log a workout', () => {
  it('More → Activity → Log workout → futsal, 60 min, moderate → Save, and Today has ~470 more left', async () => {
    const { user, router } = startApp('/');
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(await findWeekBars(/today 1,230 of 1,800/)).toBeInTheDocument();

    // More shows last week's futsal on the Activity row.
    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('button', { name: /^Activity.*Futsal/ }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/activity');
    expect(nav()).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Log workout' }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Log workout' }, SLOW)).toBeInTheDocument();
    await screen.findByRole('group', { name: 'Day' }, SLOW);
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('radio', { name: 'Futsal' }));
    const minutes = screen.getByRole('textbox', { name: 'Time in minutes' });
    await user.clear(minutes);
    await user.type(minutes, '60');
    await user.click(screen.getByRole('radio', { name: 'Moderate' }));
    expect(screen.getByText('~470 kcal').parentElement).toHaveTextContent('~470 kcal added to this week');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Back on Activity with the session under this week.
    const toast = await screen.findByText('Futsal · ~470 kcal added to this week', {}, SLOW);
    await user.hover(toast);
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' }, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/more/activity'));
    expect(await screen.findByText('Today · Futsal 60 min, moderate', {}, SLOW)).toBeInTheDocument();
    const saved = await db.workouts.where('logicalDay').equals(TODAY).toArray();
    expect(saved.map((w) => [w.type, w.intensity, w.minutes, w.netKcal])).toEqual([['futsal', 'moderate', 60, 470]]);

    // Back to More, then Today: the main number takes the workout.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'More' }, SLOW)).toBeInTheDocument();
    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'Today' }));
    expect(await findHero(/^1,040 kcal left today\./)).toBeInTheDocument();
    expect(await findWeekBars(/today 1,230 of 2,270/)).toBeInTheDocument();

    // Undo from the toast takes the workout back out.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(await db.workouts.where('logicalDay').equals(TODAY).count()).toBe(0);
  });
});
