import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { fmtApprox, fmtKcal } from '@/domain/format';
import { dailyTargetFor, startingMaintenance } from '@/domain/targets';
import { resetUiState, useUiStore } from '@/state/ui';
import SetupFlow from './SetupFlow';

const pwa = vi.hoisted(() => ({
  state: { canPrompt: false, platform: 'other' as 'ios' | 'android' | 'other', isStandalone: false },
}));

vi.mock('@/app/pwa', () => ({
  usePwaInstall: () => ({ ...pwa.state, prompt: () => Promise.resolve() }),
}));

function renderSetup(path = '/setup') {
  const router = createMemoryRouter(
    [
      { path: '/setup/*', element: <SetupFlow /> },
      { path: '/', element: <h1>Today screen</h1> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The S04 result line as the user reads it (the target is bold, so it spans two nodes). */
function resultLine(text: string) {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

beforeEach(async () => {
  await resetAll();
  resetUiState();
  pwa.state = { canPrompt: false, platform: 'other', isStandalone: false };
});

afterEach(async () => {
  await resetAll();
});

describe('SetupFlow (S01–S07)', () => {
  it('walks every step and creates an active Cut goal whose daily target matches the engine', async () => {
    const user = userEvent.setup();
    const router = renderSetup();

    expect(await screen.findByRole('heading', { level: 1, name: 'Kira Makan' })).toBeInTheDocument();
    expect(screen.getByText('A calorie budget that speaks Malaysian food')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get started' }));

    // S02 About you
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Age'), '30');
    await user.click(screen.getByRole('button', { name: 'Male' }));
    await user.type(screen.getByLabelText('Height'), '172');
    expect(screen.getByText(/An estimate is fine/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Today's weight"), '78.6');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S03 activity on a day without workouts
    expect(screen.getByRole('heading', { name: "On a day without workouts, you're mostly…" })).toBeInTheDocument();
    expect(screen.getByText('Workouts are added separately, on the days you do them.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /WFH, mostly sitting/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S04 goal and pace: live result from the engine
    const maintenance = startingMaintenance({ sex: 'male', weightKg: 78.6, heightCm: 172, age: 30, activity: 'sedentary' });
    const target = (pace: number) => dailyTargetFor({ template: 'cut', paceKgPerWeek: pace }, maintenance, 1400);
    expect(screen.getByRole('radio', { name: /Cut/ })).toHaveAttribute('aria-checked', 'true');
    expect(resultLine(`Starting maintenance ${fmtApprox(maintenance)} → daily target ${fmtKcal(target(0.5))}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '0.25 kg' }));
    expect(resultLine(`Starting maintenance ${fmtApprox(maintenance)} → daily target ${fmtKcal(target(0.25))}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '0.5 kg' }));
    expect(screen.getByRole('group', { name: 'Daily minimum' })).toHaveTextContent('1,400');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S05 regulars
    expect(screen.getByRole('heading', { name: 'Your regulars' })).toBeInTheDocument();
    const roti = screen.getByRole('button', { name: /Roti canai \+ teh tarik/ });
    await user.click(roti);
    expect(roti).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S06 places: Home is pre-added
    expect(screen.getByRole('heading', { name: 'Your main Places' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Home' })).toHaveValue('Home');
    await user.type(screen.getByRole('textbox', { name: 'Your mamak' }), 'Nasi kandar near home');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S07 your day
    expect(screen.getByRole('heading', { name: 'Your day' })).toBeInTheDocument();
    expect(screen.getByText('A 2am supper counts as the night before.')).toBeInTheDocument();
    expect(screen.getByText('Weeks start on Monday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5am' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByText('Today screen')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');

    const profile = await db.profile.get('me');
    expect(profile).toMatchObject({ age: 30, sex: 'male', heightCm: 172, activity: 'sedentary', rolloverHour: 5, dailyMinimumKcal: 1400 });
    const active = await db.goals.where('status').equals('active').toArray();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ template: 'cut', paceKgPerWeek: 0.5 });
    const versions = await db.goalVersions.toArray();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ dailyKcal: target(0.5), maintenanceKcal: maintenance, goalId: active[0]?.id });

    await waitFor(async () => {
      const usuals = await db.usuals.toArray();
      expect(usuals.map((u) => u.name)).toEqual(['Roti canai + teh tarik']);
      expect(usuals[0]?.items.map((i) => i.catalogueId)).toEqual(['roti-canai-dhal', 'teh-tarik']);
    });
    const places = await db.places.toArray();
    expect(places.map((p) => [p.name, p.type]).sort()).toEqual([
      ['Home', 'home'],
      ['Nasi kandar near home', 'mamak'],
    ]);
    expect(useUiStore.getState().toast?.message).toBe(`All set · ${fmtKcal(target(0.5))} a day`);
  });

  it('checks the numbers on About you before moving on', async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Get started' }));

    await user.type(screen.getByLabelText('Age'), '5');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByText('Age between 16 and 100')).toBeInTheDocument();
    expect(screen.getByLabelText('Age')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Pick one')).toBeInTheDocument();
    expect(screen.getByText('Add your height')).toBeInTheDocument();
  });

  it('goes back a step without losing answers', async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await user.type(screen.getByLabelText('Age'), '41');
    await user.click(screen.getByRole('button', { name: 'Female' }));
    await user.type(screen.getByLabelText('Height'), '160');
    await user.type(screen.getByLabelText("Today's weight"), '62,5');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: /On your feet a fair bit/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Female default minimum.
    expect(screen.getByRole('group', { name: 'Daily minimum' })).toHaveTextContent('1,200');
    await user.click(screen.getByRole('button', { name: 'Raise daily minimum' }));
    expect(screen.getByRole('group', { name: 'Daily minimum' })).toHaveTextContent('1,250');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Age')).toHaveValue('41');
    expect(screen.getByLabelText("Today's weight")).toHaveValue('62,5');
  });

  it('"Explore with sample data" loads the demo and opens Today', async () => {
    const user = userEvent.setup();
    const router = renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }));

    expect(await screen.findByText('Today screen')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect((await db.profile.get('me'))?.demoMode).toBe(true);
    expect(await db.meals.count()).toBeGreaterThan(0);
  });

  it('redirects to Today when a profile already exists', async () => {
    await loadDemoData();
    renderSetup('/setup');
    expect(await screen.findByText('Today screen')).toBeInTheDocument();
  });

  it('shows the install prompt in a browser, and not once installed', async () => {
    pwa.state = { canPrompt: false, platform: 'ios', isStandalone: false };
    const { unmount } = render(
      <RouterProvider router={createMemoryRouter([{ path: '/setup/*', element: <SetupFlow /> }], { initialEntries: ['/setup'] })} />,
    );
    expect(await screen.findByRole('heading', { name: 'Add Kira Makan to your home screen' })).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    unmount();

    pwa.state = { canPrompt: false, platform: 'ios', isStandalone: true };
    renderSetup();
    expect(await screen.findByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add Kira Makan to your home screen' })).not.toBeInTheDocument();
  });
});
