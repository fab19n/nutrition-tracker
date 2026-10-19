import { screen, waitFor, within } from '@testing-library/react';
import { db } from '@/db/db';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

const RECIPE = '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang';
const NAME = 'Kari ayam kentang';

setupFlows();

/** Today's "1,230 eaten · window closes 10:40pm" line, as a number. */
async function eatenToday(): Promise<number> {
  const line = await screen.findByText(/^[\d,]+ eaten · /, {}, SLOW);
  return Number((line.textContent ?? '').split(' ')[0]?.replace(/,/g, ''));
}

describe('F13 · cook a pot', () => {
  it('Log → Pot → New pot → recipe → Save, then logs a serving from Today with Undo', async () => {
    const { user, router } = startApp('/');
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    expect(await eatenToday()).toBe(1230);

    // Log sheet → Pot → New pot: the New pot screen takes the sheet's place.
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    await user.click(await within(sheet).findByRole('button', { name: 'Pot' }, SLOW));
    const pots = await findDialog('Pots in the fridge');
    await user.click(within(pots).getByRole('button', { name: 'New pot' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'New pot' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/more/pots/new');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(nav()).toBeNull();

    // The design's example recipe: ~4,030 for the pot, 8 servings, ~500 each.
    await user.type(screen.getByLabelText('Name'), NAME);
    await user.type(screen.getByLabelText('Recipe'), RECIPE);
    await user.click(screen.getByRole('button', { name: 'Split into ingredients' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Ingredients' }, SLOW)).toBeInTheDocument();
    const cookingOil = screen.getByText('Cooking oil', { selector: 'span' }).closest('li') as HTMLElement;
    expect(within(cookingOil).getByRole('button', { name: '4 tbsp' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('~4,030 kcal', { selector: 'output' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Common servings' })).getByRole('button', { name: '8' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('~500 kcal a serving', { selector: 'output' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save pot' }));
    expect(await screen.findByText('Pot saved · ~500 kcal a serving', {}, SLOW)).toBeInTheDocument();
    const saved = (await db.pots.toArray()).find((p) => p.name === NAME);
    expect(saved).toMatchObject({ servings: 8, servingsLeft: 8, recipeText: RECIPE });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/more/pots/${saved?.id}`));
    expect(await screen.findByRole('heading', { level: 1, name: NAME }, SLOW)).toBeInTheDocument();

    // Back from the new pot lands on Today (it sits where the Log sheet was).
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.location.search).toBe('');

    // Log sheet → Pot → Log 1 serving: Today's eaten goes up by ~500.
    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const again = await findDialog('Log food');
    await user.click(await within(again).findByRole('button', { name: 'Pot' }, SLOW));
    const fridge = await findDialog('Pots in the fridge');
    expect(within(fridge).getByText('8 of 8 servings left · ~500 each')).toBeInTheDocument();
    await user.click(within(fridge).getByRole('button', { name: `Log 1 serving of ${NAME}` }));

    const toast = await screen.findByText('Saved · ~500 kcal · 7 left', {}, SLOW);
    await user.hover(toast);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(async () => expect((await db.pots.get(saved?.id ?? ''))?.servingsLeft).toBe(7));
    await waitFor(async () => {
      const eaten = await eatenToday();
      expect(eaten - 1230).toBeGreaterThanOrEqual(490);
      expect(eaten - 1230).toBeLessThanOrEqual(510);
    });
    // ~500 off the 570 left: about 70 left today.
    expect(await findHero(/^[67]\d kcal left today\./)).toBeInTheDocument();

    // Undo puts the serving back in the pot and Today back where it was.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();
    await waitFor(async () => expect(await eatenToday()).toBe(1230));
    await waitFor(async () => expect((await db.pots.get(saved?.id ?? ''))?.servingsLeft).toBe(8));
  });
});
