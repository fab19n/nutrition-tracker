import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PATHS } from '@/app/paths';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { now } from '@/domain/clock';
import { normaliseName } from '@/data/catalogue';
import type { MealItem } from '@/domain/types';
import { resetUiState, useUiStore } from '@/state/ui';
import { photoDraft } from './drafts';
import { initialContext, timeSettings } from './mealTime';
import { renderLogRoutes } from './testHarness';

const macros = (kcal: number, proteinG: number, carbsG: number, fatG: number) => ({ kcal, proteinG, carbsG, fatG });

/** What the estimator makes of a tablespoon from a tub, read off its label. */
const YOGURT: MealItem = {
  id: 'yogurt',
  name: 'Greek yogurt',
  variants: [
    { id: 'eaten', label: '20 g', grams: 20, macros: macros(19, 2, 1, 1) },
    { id: '100', label: '100 g', grams: 100, macros: macros(97, 9, 4, 5) },
  ],
  selectedVariant: 0,
  unitMacros: macros(19, 2, 1, 1),
  quantity: 1,
  uncertainty: 0.15,
  source: 'label',
};

const SWITCH = 'Save Greek yogurt to your foods';

beforeEach(async () => {
  await resetAll();
  await loadDemoData();
  resetUiState();
  useUiStore.getState().setReviewDraft({ ...photoDraft(undefined, '1 heaped tbsp', initialContext(now(), timeSettings(undefined))), items: [YOGURT] });
});

async function yogurtInFoods() {
  return (await db.personalItems.toArray()).find((p) => normaliseName(p.name) === normaliseName('Greek yogurt'));
}

describe('S11 products read off a nutrition label', () => {
  it('shows the Label tag and saves the product to your foods by default', async () => {
    const user = userEvent.setup();
    renderLogRoutes(PATHS.review);

    expect(await screen.findByText('Label')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await yogurtInFoods()).toBeDefined());
    const saved = await yogurtInFoods();
    expect(saved).toMatchObject({ scope: 'dish', selectedVariant: 0, unitMacros: macros(19, 2, 1, 1) });
    expect(saved?.catalogueId).toBeUndefined();
    expect(saved?.variants?.map((v) => v.label)).toEqual(['20 g', '100 g']);
  });

  it('leaves a one-off out when the switch is off', async () => {
    const user = userEvent.setup();
    renderLogRoutes(PATHS.review);

    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    expect(screen.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(/^Saved · ~/);
    expect(await yogurtInFoods()).toBeUndefined();
  });
});
