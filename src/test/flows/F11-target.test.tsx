import { screen, within } from '@testing-library/react';
import { db } from '@/db/db';
import { clearTargetNoticeSeen, TARGET_FEEDBACK_ID } from '@/db/targetSuggestion';
import { loadMaintenanceWorld, pinClock } from '@/test/maintenanceWorld';
import { findHero, nav, setupFlows, SLOW, startApp } from './harness';

setupFlows({ demo: false });

beforeEach(async () => {
  clearTargetNoticeSeen();
  await loadMaintenanceWorld(db);
  // Fri 30 Oct 2026, 7:10pm: the weekly read finds ~2,100 maintenance, so 1,550 is suggested.
  pinClock();
});

afterEach(() => {
  vi.useRealTimers();
  clearTargetNoticeSeen();
});

describe('F11 · approve a target', () => {
  it('goes from the Today notice to S37, approves from tomorrow, and today keeps its target', async () => {
    const { user, router } = startApp('/');
    expect(await findHero(/1,300 kcal left today/)).toBeInTheDocument();
    const notice = await screen.findByRole('button', { name: /New target suggestion based on 4 weeks of data\./ }, SLOW);
    await user.click(notice);

    // S37, a sub-screen without the bottom nav.
    expect(await screen.findByRole('heading', { level: 1, name: 'Target suggestion' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights/target');
    expect(nav()).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your real maintenance looks like ~2,100, not 2,350' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Target 1,550 from tomorrow', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'New target 1,550 starts tomorrow (Sat)' }, SLOW)).toBeInTheDocument();
    expect(await db.goalVersions.count()).toBe(2);

    // Back on Today: still 1,800 − 500 eaten, and the notice is gone.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await findHero(/1,300 kcal left today/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByText('New target suggestion')).toBeNull();

    // Insights: nothing to decide any more.
    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'Insights' }));
    expect(await screen.findByText(/^Week \d+ · day \d+$/, {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('Trend', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText('Target suggestion')).toBeNull();
  });

  it('keeps the current target from the Insights card, and Today stays quiet', async () => {
    const { user, router } = startApp('/insights');
    const card = await screen.findByRole('article', { name: 'Your real maintenance looks like ~2,100, not 2,350' }, SLOW);
    await user.click(within(card).getByRole('button', { name: 'Keep current' }));
    expect(await screen.findByText('Target stays at 1,800', {}, SLOW)).toBeInTheDocument();
    expect((await db.insightFeedback.get(TARGET_FEEDBACK_ID))?.feedback).toBe('keepCurrent');
    expect(await db.goalVersions.count()).toBe(1);

    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'Today' }));
    expect(await findHero(/1,300 kcal left today/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByText('New target suggestion')).toBeNull();
  });
});
