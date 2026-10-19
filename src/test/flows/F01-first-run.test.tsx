import { screen, within } from '@testing-library/react';
import { db } from '@/db/db';
import { fmtInt, fmtKcal } from '@/domain/format';
import { dailyTargetFor, startingMaintenance } from '@/domain/targets';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

setupFlows({ demo: false });

describe('F01 · first run', () => {
  it('sets up from scratch and lands on Today with a sensible target', async () => {
    const { user, router } = startApp('/');

    // No profile: the shell sends everything to S01, without the nav.
    expect(await screen.findByRole('heading', { level: 1, name: 'Kira Makan' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
    expect(nav()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Get started' }));

    // S02 About you
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Age'), '30');
    await user.click(screen.getByRole('button', { name: 'Male' }));
    await user.type(screen.getByLabelText('Height'), '172');
    await user.type(screen.getByLabelText("Today's weight"), '78.6');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S03 Activity
    await user.click(screen.getByRole('radio', { name: /WFH, mostly sitting/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S04 Goal: Cut at 0.5 kg a week, never below the 1,400 minimum.
    const maintenance = startingMaintenance({ sex: 'male', weightKg: 78.6, heightCm: 172, age: 30, activity: 'sedentary' });
    const target = dailyTargetFor({ template: 'cut', paceKgPerWeek: 0.5 }, maintenance, 1400);
    expect(target).toBeGreaterThanOrEqual(1400);
    expect(target).toBeLessThan(maintenance);
    expect(screen.getByRole('radio', { name: /Cut/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S05 Regulars
    await user.click(screen.getByRole('button', { name: /Roti canai \+ teh tarik/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S06 Places
    await user.type(screen.getByRole('textbox', { name: 'Your mamak' }), 'Nasi kandar near home');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S07 Your day → Done
    expect(screen.getByRole('heading', { name: 'Your day' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    // Today, first-day state: the whole target left, the nav, and an invitation to log.
    expect(await findHero(new RegExp(`^${fmtInt(target)} kcal left today\\.`))).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(nav()).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Goal: Cut · ${fmtInt(target)}` })).toBeInTheDocument();
    expect(screen.getByText('Nothing logged yet')).toBeInTheDocument();
    expect(await screen.findByText('Log your first meal', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText(`All set · ${fmtKcal(target)} a day`)).toBeInTheDocument();
    // No check-in on the first day, and nothing held back.
    expect(screen.queryByRole('button', { name: /looks incomplete|isn't confirmed/ })).toBeNull();
    expect(screen.queryByText(/waiting for check-in/)).toBeNull();

    // The real clock, not the demo.
    const profile = await db.profile.get('me');
    expect(profile?.demoMode).toBe(false);

    // "Log a meal" opens the Log sheet, with the new Usual in it.
    await user.click(screen.getByRole('button', { name: 'Log a meal' }));
    const sheet = await findDialog('Log food');
    expect(await within(sheet).findByText('Roti canai + teh tarik', {}, SLOW)).toBeInTheDocument();
  });

  it('explores the sample week, then leaves demo from Settings and starts fresh', async () => {
    const { user, router } = startApp('/');
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }, SLOW));

    // The demo Friday.
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Fri 16 Oct')).toBeInTheDocument();
    expect(await screen.findByText('Showing a sample week. Leave demo any time in Settings.', {}, SLOW)).toBeInTheDocument();

    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'More' }));
    expect(await screen.findByText('Demo', {}, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    await user.click(await screen.findByRole('button', { name: /^Leave demo and start fresh/ }, SLOW));

    expect(await screen.findByRole('button', { name: 'Get started' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
    expect(nav()).toBeNull();
    expect(await db.profile.count()).toBe(0);
    expect(await db.meals.count()).toBe(0);
  });
});
