import { act, screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

setupFlows();

describe('Shell flows on the demo world', () => {
  it('closes sheets with the back button and keeps the page underneath', async () => {
    const { user, router } = startApp('/');
    await findHero(/^570 kcal left today\./);

    await user.click(screen.getByRole('button', { name: 'Log food' }));
    await findDialog('Log food');
    expect(router.state.location.search).toBe('?sheet=log');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('');

    // Budget → makan swaps the content in one history entry, so one back closes it.
    await user.click(await findHero(/^570 kcal left today\./));
    const budget = await findDialog("This week's budget");
    await user.click(await within(budget).findByRole('button', { name: 'Change makan day' }, SLOW));
    await findDialog('Plan a makan day');
    expect(router.state.location.search).toBe('?sheet=makan');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();

    // A sheet opened on another tab closes back to that tab.
    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'Diary' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Diary|Fri 16 Oct/ }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    await findDialog('Log food');
    expect(router.state.location.pathname).toBe('/diary');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/diary');
    expect(router.state.location.search).toBe('');
  });

  it('closes a sheet opened from a link, even after it hands over to another sheet', async () => {
    const { user, router } = startApp('/?sheet=budget');
    const budget = await findDialog("This week's budget");
    await user.click(await within(budget).findByRole('button', { name: 'Change makan day' }, SLOW));
    const makan = await findDialog('Plan a makan day');
    const days = await within(makan).findByRole('group', { name: 'Makan day' }, SLOW);
    await user.click(within(days).getByRole('button', { name: 'Sun' }));
    await user.click(within(makan).getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Saving for Sunday', {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('');
  });

  it('drops a sheet’s own params when it closes, so the next Log starts at now', async () => {
    const { deleteMeal } = await import('@/db/actions');
    const { putDayRecord } = await import('@/db/repo');
    await deleteMeal('meal-2026-10-15-dinner');
    await putDayRecord(db, { logicalDay: '2026-10-15', status: 'unconfirmed' });

    // The check-in opened from a link (a notification), then "Let me add it".
    const { user, router } = startApp('/?sheet=checkin');
    const checkIn = await findDialog('Morning check-in');
    await user.click(await within(checkIn).findByRole('radio', { name: 'I ate more. Let me add it' }, SLOW));
    await user.click(within(checkIn).getByRole('button', { name: 'Done' }));
    const log = await findDialog('Log food');
    expect(await within(log).findByRole('button', { name: /^Time:\s*Last night \d/ }, SLOW)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');

    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const again = await findDialog('Log food');
    expect(await within(again).findByRole('button', { name: /^Time:\s*Now/ }, SLOW)).toBeInTheDocument();
  });

  it('shows the nav on tab roots and hides it on sub-screens', async () => {
    const { user, router } = startApp('/');
    await findHero(/^570 kcal left today\./);
    expect(nav()).not.toBeNull();

    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'More' }, SLOW)).toBeInTheDocument();
    expect(nav()).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /^Weight/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Weight' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/weight');
    expect(nav()).toBeNull();

    await act(() => router.navigate(-1));
    expect(await screen.findByRole('heading', { level: 1, name: 'More' }, SLOW)).toBeInTheDocument();
    expect(nav()).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' }, SLOW)).toBeInTheDocument();
    expect(nav()).toBeNull();
    // Weight opened from Settings goes back to Settings.
    await user.click(await screen.findByRole('button', { name: /^Weight/ }, SLOW));
    expect(await screen.findByRole('heading', { level: 1, name: 'Weight' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'More' }, SLOW)).toBeInTheDocument();
    expect(nav()).not.toBeNull();

    // A meal on Today opens its entry (S14), without the nav.
    await user.click(within(nav() as HTMLElement).getByRole('button', { name: 'Today' }));
    await user.click(await screen.findByText('Economy rice', {}, SLOW));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/diary\/entry\//));
    await waitFor(() => expect(nav()).toBeNull());
  });

  it('Delete everything returns to setup', async () => {
    const { user, router } = startApp('/more/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' }, SLOW)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }, SLOW));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' }, SLOW).catch(() =>
      screen.findByRole('dialog', { name: 'Delete everything?' }, SLOW),
    );
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'DELETE');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await screen.findByRole('heading', { level: 1, name: 'Kira Makan' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
    expect(nav()).toBeNull();
    expect(await screen.findByText('Everything on this phone is deleted')).toBeInTheDocument();
    expect(await db.profile.count()).toBe(0);
    expect(await db.meals.count()).toBe(0);

    // Everything else now goes to setup too.
    await act(() => router.navigate('/'));
    expect(await screen.findByRole('button', { name: 'Get started' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });
});
