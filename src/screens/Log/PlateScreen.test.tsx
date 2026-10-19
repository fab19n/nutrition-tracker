import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { mealMacros } from '@/domain/meal';
import { resetUiState, useUiStore } from '@/state/ui';
import { renderLogRoutes } from './testHarness';

beforeEach(async () => {
  await resetAll();
  await loadDemoData();
  resetUiState();
});

const dish = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}, about`) });

describe('S24 Plate builder', () => {
  it('starts at the economy-rice stall with your last plate there: 670 kcal', async () => {
    renderLogRoutes(PATHS.plate);
    expect(await screen.findByRole('heading', { name: 'Build your plate' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Place:\s*Kedai near home/ })).toBeInTheDocument();
    expect(await screen.findByText('670 kcal')).toBeInTheDocument();
    expect(screen.getByText('likely 570–770')).toBeInTheDocument();

    expect(within(screen.getByRole('group', { name: 'Rice' })).getByRole('button', { name: '1 scoop' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Kuah on rice' })).getByRole('button', { name: 'Some' })).toHaveAttribute('aria-pressed', 'true');
    expect(await dish('Ayam masak merah')).toHaveAttribute('aria-pressed', 'true');
    expect(await dish('Kangkung belacan')).toHaveAttribute('aria-pressed', 'true');
    expect(await dish('Kubis goreng')).toHaveAttribute('aria-pressed', 'true');
    expect(await dish('Ayam goreng')).toHaveAttribute('aria-pressed', 'false');
    // Taugeh is one of the stall's most-picked dishes.
    expect(await dish('Taugeh')).toHaveAccessibleName(/picked often/);

    for (const heading of ['Protein', 'Vegetables', 'Tofu and egg']) expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText('Tap a dish to add it, tap again for 2')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Price in RM' })).toHaveValue('9.50');
    expect(screen.getByRole('button', { name: /^Oil here: Medium, remembered/ })).toBeInTheDocument();
  });

  it('cycles a dish 0 → 1 → 2 → 0', async () => {
    const user = userEvent.setup();
    renderLogRoutes(PATHS.plate);
    await screen.findByText('670 kcal');
    await user.click(await dish('Ayam goreng'));
    expect(screen.getByText('950 kcal')).toBeInTheDocument();
    await user.click(await dish('Ayam goreng'));
    expect(screen.getByText('1,230 kcal')).toBeInTheDocument();
    expect(await dish('Ayam goreng')).toHaveAccessibleName(/2 on your plate/);
    await user.click(await dish('Ayam goreng'));
    expect(screen.getByText('670 kcal')).toBeInTheDocument();
  });

  it('goes to Review with the plate, saves it, and Back from Review keeps the plate', async () => {
    const user = userEvent.setup();
    renderLogRoutes(PATHS.plate);
    await screen.findByText('670 kcal');
    await user.click(await dish('Telur dadar'));
    expect(screen.getByText('850 kcal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByRole('heading', { name: 'Check your plate' })).toBeInTheDocument();
    const names = screen.getAllByRole('button', { name: /^More for / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'More for Rice (economy rice)',
      'More for Ayam masak merah',
      'More for Telur dadar',
      'More for Kangkung belacan',
      'More for Kubis goreng',
      'More for Kuah on rice',
    ]);
    expect(screen.getByText('850 kcal')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Price/ })).toHaveValue('9.50');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Build your plate' })).toBeInTheDocument();
    expect(await screen.findByText('850 kcal')).toBeInTheDocument();
    expect(await dish('Telur dadar')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved · ~850 kcal')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();
    const plates = (await db.meals.where('logicalDay').equals('2026-10-16').toArray()).filter((m) => m.method === 'plate');
    const dinner = plates.find((m) => m.id !== DEMO_IDS.meals.todayLunch);
    expect(dinner?.name).toBe('Economy rice');
    expect(dinner?.placeId).toBe(DEMO_IDS.places.kedai);
    expect(dinner?.priceRm).toBe(9.5);
    expect(Math.round(mealMacros(dinner!).kcal)).toBe(850);
    // Review drops the draft as it unmounts, which can land just after Today first renders.
    await waitFor(() => expect(useUiStore.getState().reviewDraft).toBeNull());
  });

  it("after a save, the phone's back button from Today doesn't reopen the plate (and a double tap stacks no Review)", async () => {
    const user = userEvent.setup();
    const { router } = renderLogRoutes(PATHS.today);
    await act(() => router.navigate(PATHS.plate));
    await screen.findByText('670 kcal');
    const review = screen.getByRole('button', { name: 'Review' });
    fireEvent.click(review);
    fireEvent.click(review);
    expect(await screen.findByRole('heading', { name: 'Check your plate' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();

    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe(PATHS.today));
    expect(screen.queryByRole('heading', { name: 'Build your plate' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Check your plate' })).toBeNull();
  });

  it("starts a fresh plate when one was left on Review by the phone's back button", async () => {
    const user = userEvent.setup();
    const { router } = renderLogRoutes(PATHS.today);
    await act(() => router.navigate(PATHS.plate));
    await screen.findByText('670 kcal');
    await user.click(await dish('Telur dadar'));
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('heading', { name: 'Check your plate' })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('heading', { name: /Today screen/ })).toBeInTheDocument();

    await act(() => router.navigate(PATHS.plate));
    expect(await screen.findByText('670 kcal')).toBeInTheDocument();
    expect(await dish('Telur dadar')).toHaveAttribute('aria-pressed', 'false');
  });

  it('remembers a new oil level for the stall', async () => {
    const user = userEvent.setup();
    renderLogRoutes(PATHS.plate);
    await user.click(await screen.findByRole('button', { name: /^Oil here: Medium/ }));
    await waitFor(async () => expect((await db.places.get(DEMO_IDS.places.kedai))?.oilLevel).toBe('high'));
    expect(await screen.findByRole('button', { name: /^Oil here: High, remembered/ })).toBeInTheDocument();
  });

  it('adds a dish that is not on the trays', async () => {
    const user = userEvent.setup();
    renderLogRoutes(PATHS.plate);
    await screen.findByText('670 kcal');
    await user.click(screen.getByRole('button', { name: 'Another dish' }));
    const sheet = await screen.findByRole('dialog', { name: 'Another dish' });
    await user.type(within(sheet).getByRole('searchbox', { name: 'Search dishes' }), 'rendang');
    await user.click(await within(sheet).findByRole('button', { name: /^Rendang daging/ }));
    expect(await dish('Rendang daging')).toHaveAttribute('aria-pressed', 'true');
  });
});
