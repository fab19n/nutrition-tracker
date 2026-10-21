import { screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { loadDemo } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

/** Fri 16 Oct 2026, 7:10pm MYT, on the real (non-demo) clock. */
const FRIDAY = '2026-10-16T11:10:00.000Z';
/** Sat 17 Oct 2026, 7:10pm MYT: the switch has started. */
const SATURDAY = '2026-10-17T11:10:00.000Z';

setupFlows({ demo: false });

beforeEach(async () => {
  // The demo world on the real clock, so the next day can come.
  await loadDemo(db);
  await db.profile.update('me', { demoMode: false });
  setDemoClock(false);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(FRIDAY));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('F12 · switch goal', () => {
  it('Today → Goals → Festive maintain → S44 → Switch; today keeps Cut and tomorrow shows the new main number', async () => {
    const meals = await db.meals.toArray();
    const first = startApp('/');
    const { user, router } = first;
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Goal: Cut · 1,800' }));

    // S41, a sub-screen without the bottom nav.
    expect(await screen.findByRole('heading', { level: 1, name: 'Goals' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/goals');
    expect(nav()).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Festive maintain' }, SLOW));

    // S42 → S44.
    expect(await screen.findByRole('heading', { level: 1, name: 'Festive maintain' }, SLOW)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Switch to this goal' }, SLOW));
    const sheet = await findDialog('Switch to Festive maintain?');
    expect(within(sheet).getByText('13,200 kcal')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Switch from tomorrow' }));
    expect(await screen.findByText('Festive maintain from tomorrow (Sat)', {}, SLOW)).toBeInTheDocument();

    // Back on Today: still Cut, 1,800 − 1,230 eaten; the week has 2,100 from Saturday.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Goals' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const hero = await findHero(/^570 kcal left today\./);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.getByRole('button', { name: 'Goal: Cut · 1,800' })).toBeInTheDocument();
    await user.click(hero);
    const budget = await findDialog("This week's budget");
    expect(await within(budget).findByText('5 × 1,800 + 2 × 2,100', {}, SLOW)).toBeInTheDocument();
    expect(within(budget).getByText('13,200')).toBeInTheDocument();
    expect(await db.meals.toArray()).toEqual(meals);

    // Saturday: Festive maintain is the goal, its days in range count from tomorrow.
    first.unmount();
    vi.setSystemTime(new Date(SATURDAY));
    startApp('/');
    expect(await screen.findByRole('button', { name: 'Goal: Festive · 2,100' }, SLOW)).toBeInTheDocument();
    expect(await findHero(/Days in range count from tomorrow/)).toBeInTheDocument();
  });

  it('More → Goals → the Pause template → Save goal → Switch, paused until Monday', async () => {
    const first = startApp('/');
    const { user, router } = first;
    await findHero(/^570 kcal left today\./);
    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('button', { name: /^Goals/ }, SLOW));
    await user.click(await screen.findByRole('button', { name: 'New goal from Pause' }, SLOW));

    // S43 with the Pause template: Save goal opens the goal in its place.
    expect(await screen.findByRole('heading', { level: 1, name: 'New goal' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?template=pause');
    await user.click(await screen.findByRole('button', { name: 'Save goal' }, SLOW));
    expect(await screen.findByText('Saved · Pause', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pause' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/goals/goal-pause');

    await user.click(await screen.findByRole('button', { name: 'Switch to this goal' }, SLOW));
    const sheet = await findDialog('Switch to Pause?');
    expect(within(within(sheet).getByRole('group', { name: 'Until' })).getByRole('button', { name: 'Mon 19 Oct' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: 'Switch from tomorrow' }));
    expect(await screen.findByText('Paused from tomorrow (Sat) until Mon', {}, SLOW)).toBeInTheDocument();

    first.unmount();
    vi.setSystemTime(new Date(SATURDAY));
    startApp('/');
    expect(await screen.findByRole('button', { name: 'Goal: Paused until Mon' }, SLOW)).toBeInTheDocument();
    expect(await findHero(/^Budget off\./)).toBeInTheDocument();
  });
});
