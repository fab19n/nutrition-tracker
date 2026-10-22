import { screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { DISH_CHECK_FEEDBACK_ID } from '@/db/dishCheck';
import { DEMO_IDS } from '@/db/seed/demo';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

setupFlows();

function answerButton(name: string, kcal: string, answer: string): HTMLElement {
  const group = screen.getByRole('group', { name: `${name}: is ${kcal} kcal right?` });
  return within(group).getByRole('button', { name: answer });
}

describe('F-dishes · the top dishes check from Insights', () => {
  it('Start → three answers → Done → back on Insights, and the next estimate follows the answers', async () => {
    const { user, router } = startApp('/insights');

    // The card sits under the weekly review; the Unlock list has the durable row.
    expect(await screen.findByRole('heading', { name: 'Check your top dishes' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Your 27 most-logged dishes, once. About 2 minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Top dishes check/ })).toHaveTextContent('Ready');
    await user.click(screen.getByRole('button', { name: 'Start' }));

    // S34, a sub-screen without the bottom nav.
    expect(await screen.findByRole('heading', { level: 1, name: 'Top dishes check' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights/dishes');
    expect(nav()).toBeNull();
    expect(await screen.findByText('0 of 27', {}, SLOW)).toBeInTheDocument();

    await user.click(answerButton('Rice (economy rice)', '~200', 'Looks right'));
    await user.click(answerButton('Teh o ais', '~60', 'Usually more'));
    await user.click(answerButton('Rice (nasi kandar)', '~430', 'Usually less'));
    expect(await screen.findByText('Usually more. Now ~110 kcal (was ~60).', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('Usually less. Now ~330 kcal (was ~430).', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('3 of 27', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('24 not checked yet')).toBeInTheDocument();

    // Done with dishes left asks first.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    const dialog = await findDialog('Finish the check?');
    await user.click(within(dialog).getByRole('button', { name: 'Finish' }));

    // Back on Insights: the card is gone, the toast says what moved, and Undo is there.
    expect(await screen.findByText('Top dishes checked · 2 updated', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights');
    await waitFor(() => expect(nav()).not.toBeNull(), SLOW);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Check your top dishes' })).toBeNull(), SLOW);
    expect(await screen.findByRole('button', { name: /^Top dishes check/ }, SLOW)).toHaveTextContent('Checked');

    // What the answers wrote: existing rows, no new table.
    const teh = await db.personalItems.get('personal-teh-o-ais');
    expect(teh).toMatchObject({ scope: 'dish', selectedVariant: 2 });
    expect(teh?.unitMacros.kcal).toBe(110);
    expect((await db.places.get(DEMO_IDS.places.nasiKandar))?.defaultVariants['rice-nasi-kandar']).toBe(1);
    const saved = await db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID);
    expect(saved).toMatchObject({ ruleId: 'topDishes', feedback: 'dishCheck' });
    expect(saved?.dishCheck?.doneAt).toBeDefined();
    expect(saved?.dishCheck?.dishes.filter((d) => d.answer).map((d) => `${d.key}:${d.answer}`)).toEqual([
      'rice-economy:right',
      'rice-nasi-kandar:less',
      'teh-o-ais:more',
    ]);

    // The next "teh o ais" you type starts at the number you gave.
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    await user.click(await within(sheet).findByRole('textbox', { name: 'What did you eat?' }, SLOW));
    await user.paste('teh o ais');
    await user.click(within(sheet).getByRole('button', { name: 'Estimate' }));
    expect(await screen.findByRole('heading', { name: 'Check your meal' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('110 kcal', {}, SLOW)).toBeInTheDocument();
  });

  it('a deep link → one answer → Back → Continue picks up where it stopped', async () => {
    const { user, router } = startApp('/insights/dishes');
    await screen.findByRole('list', { name: 'Dishes to check' }, SLOW);
    await user.click(answerButton('Rice (economy rice)', '~200', 'Looks right'));
    expect(await screen.findByText('1 of 27', {}, SLOW)).toBeInTheDocument();

    // A deep link has nowhere to go back to, so Back lands on Insights.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('1 of 27 checked. Pick up where you left off.', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('1 of 27', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo answer/ })).toBeNull();
  });
});

describe('F-timing · Timing detail from Today', () => {
  it('Today → Timing details → yesterday → Back', async () => {
    const { user, router } = startApp('/');
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Timing details' }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Timing' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights/timing');
    expect(nav()).toBeNull();
    expect(await screen.findByText('Fri 16 Oct · Today', {}, SLOW)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Timing numbers' }, SLOW);
    expect(within(list).getByText('Breakfast · 1 h 10 min later than your usual 9:30am')).toBeInTheDocument();
    expect(within(list).getByText('Waiting for a Going to sleep tap')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous: Thu' }));
    expect(await screen.findByText('Thu 15 Oct · Yesterday', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?day=2026-10-15');
    expect(await screen.findByRole('heading', { name: 'The day in numbers' }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('Skipped: no Going to sleep tap this day', {}, SLOW)).toBeInTheDocument();

    // The day switch replaced the entry, so Back returns to Today.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(nav()).not.toBeNull();
  });

  it('Diary day → Timing details carries the day, and Insights › When you ate opens today', async () => {
    const { user, router } = startApp('/diary?day=2026-10-15');
    await user.click(await screen.findByRole('button', { name: 'Timing details' }, SLOW));
    expect(await screen.findByText('Thu 15 Oct · Yesterday', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.search).toBe('?day=2026-10-15');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Thu 15 Oct · Yesterday', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diary');

    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'Insights' }));
    await user.click(await screen.findByRole('button', { name: 'Timing details' }, SLOW));
    expect(await screen.findByText('Fri 16 Oct · Today', {}, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights/timing');
    expect(router.state.location.search).toBe('');
  });
});
