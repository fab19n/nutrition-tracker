import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { resetUiState } from '@/state/ui';
import SettingsScreen from './SettingsScreen';

function renderSettings() {
  const router = createMemoryRouter(
    [
      { path: '/more/settings', element: <SettingsScreen /> },
      { path: '/more', element: <h1>More screen</h1> },
      { path: '/more/export', element: <h1>Export screen</h1> },
      { path: '/more/weight', element: <h1>Weight screen</h1> },
      { path: '/more/soon/:what', element: <h1>Soon screen</h1> },
      { path: '/setup/*', element: <h1>Setup screen</h1> },
    ],
    { initialEntries: [PATHS.settings] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  await resetAll();
  resetUiState();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('SettingsScreen (S19)', () => {
  it('shows the profile, budget and day settings from the demo profile', async () => {
    renderSettings();

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Age/ })).toHaveTextContent('30');
    expect(screen.getByRole('button', { name: /^Sex/ })).toHaveTextContent('Male');
    expect(screen.getByRole('button', { name: /^Height/ })).toHaveTextContent('172 cm');
    expect(await screen.findByRole('button', { name: /^Weight/ })).toHaveTextContent('77.8 kg');
    expect(screen.getByRole('button', { name: /^Daily minimum/ })).toHaveTextContent('1,400 kcal');
    expect(screen.getByText('Weeks start on Monday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Day rollover/ })).toHaveTextContent('5am');
    expect(screen.getAllByText('Your target changes through a suggestion you approve.').length).toBeGreaterThan(0);
    expect(screen.getByText("Estimates are approximate. This app isn't medical advice.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave demo and start fresh/ })).toBeInTheDocument();
  });

  it('writes the theme to the profile', async () => {
    const user = userEvent.setup();
    renderSettings();

    const theme = await screen.findByRole('group', { name: 'Theme' });
    expect(within(theme).getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(theme).getByRole('button', { name: 'Dark' }));

    await waitFor(async () => expect((await db.profile.get('me'))?.theme).toBe('dark'));
    await waitFor(() => expect(within(theme).getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('writes the location and photo toggles to the profile', async () => {
    const user = userEvent.setup();
    renderSettings();

    const location = await screen.findByRole('switch', { name: 'Location' });
    expect(location).toHaveAttribute('aria-checked', 'true');
    await user.click(location);
    await waitFor(async () => expect((await db.profile.get('me'))?.useLocation).toBe(false));

    await user.click(screen.getByRole('switch', { name: 'Keep photos' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.keepPhotos).toBe(false));
  });

  it('edits the profile in a sheet without touching the target', async () => {
    const user = userEvent.setup();
    renderSettings();
    const versionsBefore = await db.goalVersions.toArray();

    await user.click(await screen.findByRole('button', { name: /^Height/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Profile and body' });
    const height = within(sheet).getByLabelText('Height');
    await user.clear(height);
    await user.type(height, '175');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.profile.get('me'))?.heightCm).toBe(175));
    expect(await db.goalVersions.toArray()).toEqual(versionsBefore);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Profile and body' })).not.toBeInTheDocument());
  });

  it('changes the day rollover in a sheet', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Day rollover/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Day rollover' });
    await user.click(within(sheet).getByRole('button', { name: '4am' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.rolloverHour).toBe(4));
  });

  it('only deletes everything after DELETE is typed', async () => {
    const user = userEvent.setup();
    const router = renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeDisabled();

    const field = within(dialog).getByRole('textbox');
    await user.type(field, 'delete');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'DELETE');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.setup);
    expect(await db.profile.count()).toBe(0);
    expect(await db.meals.count()).toBe(0);
  });

  it('cancelling the delete dialog keeps the data', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await db.meals.count()).toBeGreaterThan(0);
  });

  it('leaves demo mode for a fresh setup', async () => {
    const user = userEvent.setup();
    const router = renderSettings();

    await user.click(await screen.findByRole('button', { name: /Leave demo and start fresh/ }));
    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.setup);
    expect(await db.profile.count()).toBe(0);
  });

  it('links to export, reminders and backups', async () => {
    const user = userEvent.setup();
    const router = renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Export/ }));
    expect(router.state.location.pathname).toBe(PATHS.export);
    await router.navigate(PATHS.settings);
    await user.click(await screen.findByRole('button', { name: /^Backups/ }));
    expect(router.state.location.pathname).toBe(PATHS.soon('backups'));
    await router.navigate(PATHS.settings);
    await user.click(await screen.findByRole('button', { name: /^Reminders/ }));
    expect(router.state.location.pathname).toBe(PATHS.soon('reminders'));
  });
});
