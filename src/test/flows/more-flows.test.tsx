import { act, screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { mealMacros } from '@/domain/meal';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

setupFlows();

const LUNCH = DEMO_IDS.meals.todayLunch;

/** Picks the first portion chip in a group that isn't selected yet; returns its label. */
async function pickOtherPortion(user: ReturnType<typeof startApp>['user'], group: HTMLElement): Promise<string> {
  const other = within(group)
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'false');
  if (!other) throw new Error('No other portion');
  await user.click(other);
  return other.textContent ?? '';
}

describe('F04 · repeat meal', () => {
  it('logs a Usual from the Log sheet in a few taps', async () => {
    const { user, router } = startApp('/');
    await findHero(/^570 kcal left today\./);

    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    await user.click(await within(sheet).findByRole('button', { name: 'Usuals' }, SLOW));
    const usuals = await findDialog('Your usuals');
    await user.click(within(usuals).getByRole('button', { name: 'Log Teh o ais kurang' }));

    expect(await screen.findByRole('heading', { name: 'Your usual order' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/log/review');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved · ~60 kcal', {}, SLOW)).toBeInTheDocument();
    expect(await findHero(/^510 kcal left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('F06 · fix an entry', () => {
  it('edits a meal from the Diary, saves, and Back returns to the Diary', async () => {
    const { user, router } = startApp('/diary');
    await user.click(await screen.findByText('Economy rice', {}, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Entry' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/diary/entry/${LUNCH}`);
    const before = Math.round(mealMacros((await db.meals.get(LUNCH))!).kcal);

    await user.click(await screen.findByRole('button', { name: 'Edit entry' }, SLOW));
    expect(await screen.findByRole('heading', { name: 'Edit entry' }, SLOW)).toBeInTheDocument();
    const rice = screen.getAllByRole('group', { name: / portion$/ })[0] as HTMLElement;
    await pickOtherPortion(user, rice);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/^Saved · ~/, {}, SLOW)).toBeInTheDocument();

    // Back on the entry, with the new total saved.
    expect(await screen.findByRole('heading', { level: 1, name: 'Entry' }, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/entry/${LUNCH}`));
    const after = Math.round(mealMacros((await db.meals.get(LUNCH))!).kcal);
    expect(after).not.toBe(before);

    // One Back goes to the Diary, not to the entry as it was before the edit.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary'));
    expect(nav()).not.toBeNull();
  });

  it('cancelling an edit returns to the entry, and Back from there to the Diary', async () => {
    const { user, router } = startApp('/diary');
    await user.click(await screen.findByText('Economy rice', {}, SLOW));
    await screen.findByRole('heading', { level: 1, name: 'Entry' }, SLOW);

    await user.click(await screen.findByRole('button', { name: 'Edit entry' }, SLOW));
    await screen.findByRole('heading', { name: 'Edit entry' }, SLOW);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Entry' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/diary/entry/${LUNCH}`);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Diary' }, SLOW)).toBeInTheDocument();
  });
});

describe('Insights evidence', () => {
  it('opens a meal from the evidence sheet and Back brings the sheet back', async () => {
    const { user, router } = startApp('/insights');
    await user.click(await screen.findByRole('button', { name: 'See 11 drinks' }, SLOW));
    const sheet = await findDialog(/Drinks were/);
    expect(new URLSearchParams(router.state.location.search).get('sheet')).toBe('evidence');
    expect(nav()).not.toBeNull();

    const rows = await within(sheet).findAllByRole('button', { name: /Teh tarik|Milo ais/ }, SLOW);
    await user.click(rows[0] as HTMLElement);
    expect(await screen.findByRole('heading', { level: 1, name: 'Entry' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/diary\/entry\//);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(nav()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await findDialog(/Drinks were/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/insights');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
    expect(router.state.location.pathname).toBe('/insights');
  });
});

describe('Back through a logging flow', () => {
  it('Meal ideas → Review → Back → Back lands on Today with no stale screens in between', async () => {
    const { user, router } = startApp('/');
    await user.click(await screen.findByRole('button', { name: 'Meal ideas for dinner' }, SLOW));
    const logThis = await screen.findAllByRole('button', { name: /^Log this: / }, SLOW);
    await user.click(logThis[0] as HTMLElement);
    expect(await screen.findByRole('heading', { name: 'Check your meal' }, SLOW)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Meal ideas' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');

    // The phone's back button from Today doesn't reopen the logging screens.
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).not.toBe('/log/review'));
    expect(router.state.location.pathname).not.toBe('/ideas');
  });

  it('after a text meal is saved, the phone’s back button from Today doesn’t reopen Log or Review', async () => {
    const { user, router } = startApp('/');
    await findHero(/^570 kcal left today\./);
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    await user.click(within(sheet).getByRole('textbox', { name: 'What did you eat?' }));
    await user.paste('teh tarik');
    await user.click(within(sheet).getByRole('button', { name: 'Estimate' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }, SLOW));
    expect(await findHero(/^3[0-9]0 kcal left today\./)).toBeInTheDocument();

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Plate → Review → Back → Back returns to Today, and the phone’s back button stays there', async () => {
    const { user, router } = startApp('/');
    await findHero(/^570 kcal left today\./);
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    await user.click(await within(sheet).findByRole('button', { name: 'Plate' }, SLOW));
    await screen.findByText('670 kcal', {}, SLOW);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('heading', { name: 'Check your plate' }, SLOW)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Build your plate' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the check-in "Let me add it" opens Log at last night’s dinner time and the day stays to confirm', async () => {
    const { deleteMeal } = await import('@/db/actions');
    const { putDayRecord } = await import('@/db/repo');
    await deleteMeal('meal-2026-10-15-dinner');
    await putDayRecord(db, { logicalDay: '2026-10-15', status: 'unconfirmed' });

    const { user, router } = startApp('/');
    await user.click(await screen.findByRole('button', { name: /^Yesterday looks incomplete\./ }, SLOW));
    const sheet = await findDialog('Morning check-in');
    await user.click(await within(sheet).findByRole('radio', { name: 'I ate more. Let me add it' }, SLOW));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));

    const log = await findDialog('Log food');
    expect(router.state.location.search).toMatch(/^\?sheet=log&at=/);
    expect(await within(log).findByRole('button', { name: /^Time:\s*Last night \d/ }, SLOW)).toBeInTheDocument();

    // Closing Log goes back to Today (the check-in is still waiting there).
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
    expect(await screen.findByRole('button', { name: /^Yesterday looks incomplete\./ }, SLOW)).toBeInTheDocument();
  });
});
