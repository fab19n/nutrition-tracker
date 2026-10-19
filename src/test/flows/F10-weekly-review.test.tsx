import { act, screen, within } from '@testing-library/react';
import { db } from '@/db/db';
import { nav, setupFlows, SLOW, startApp } from './harness';

const WEEK = '2026-10-12';

setupFlows();

describe('F10 · weekly review', () => {
  it('walks the three steps, picks a focus and Today shows it', async () => {
    const { user, router } = startApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' }, SLOW)).toBeInTheDocument();
    expect(screen.queryByText("This week's focus:")).toBeNull();

    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'Insights' }));
    expect(router.state.location.pathname).toBe('/insights');
    await user.click(await screen.findByRole('button', { name: /Your weekly review is ready/ }, SLOW));

    // S33 step 1: last week, 5–11 Oct.
    expect(await screen.findByRole('region', { name: 'Your week, 5–11 Oct' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights/weekly');
    expect(nav()).toBeNull();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next · top 3' }));

    // Step 2: top 3.
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next · pick one thing' }));

    // Step 3: pick one thing.
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pick one thing to try next week' })).toBeInTheDocument();
    const options = screen.getAllByRole('radio');
    expect(options.length).toBeGreaterThan(1);
    const option = options[1] as HTMLElement;
    await user.click(option);
    expect(option).toHaveAttribute('aria-checked', 'true');
    const picked = (await db.weekPlans.get(WEEK))?.focus;
    expect(picked).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Got it, put it on Today' }));

    // Today with the focus card.
    expect(await screen.findByText("This week's focus:", {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(nav()).not.toBeNull();
    expect(await screen.findByText("Got it. It's on your Today screen")).toBeInTheDocument();
    const plan = await db.weekPlans.get(WEEK);
    expect(plan?.focus?.label).toBeTruthy();
    expect(plan?.makanDay).toBe('2026-10-17');
    const card = screen.getByText("This week's focus:").parentElement?.parentElement as HTMLElement;
    expect(card.textContent?.toLowerCase()).toContain((plan?.focus?.label ?? '').toLowerCase().slice(1));
    // Today counts this week's progress with the same rule the review offered.
    expect(within(card).getByText(/^\d+ of \d+$/)).toBeInTheDocument();

    // The phone's back button goes to Insights (the review is done), not to step 1 again.
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/insights');
    expect(await screen.findByRole('button', { name: /Last week's review/ }, SLOW)).toBeInTheDocument();
  });
});
