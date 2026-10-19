import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { resetUiState, useUiStore } from '@/state/ui';
import { SLOW, renderPots } from './testRouter';

const RECIPE = '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang';
const KARI_AYAM = DEMO_IDS.pots.kariAyam;
const TODAY = '2026-10-16';

/** The IngredientRow card that holds an ingredient's name. */
function row(name: string): HTMLElement {
  const found = screen.getByText(name, { selector: 'span' }).closest('li');
  if (!found) throw new Error(`No row for ${name}`);
  return found;
}

function wholePot(): string {
  return screen.getByText('Whole pot').parentElement?.querySelector('output')?.textContent ?? '';
}

function perServing(): string {
  return screen.getByText(/kcal a serving$/, { selector: 'output' }).textContent ?? '';
}

async function splitExample(user: ReturnType<typeof userEvent.setup>, recipe = RECIPE) {
  await user.type(screen.getByLabelText('Name'), 'Kari ayam');
  await user.type(screen.getByLabelText('Recipe'), recipe);
  await user.click(screen.getByRole('button', { name: 'Split into ingredients' }));
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('NewPotScreen (S27)', () => {
  it('splits the example recipe into ~4,030 kcal and ~500 a serving over 8, then saves', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots', '/more/pots/new');
    expect(screen.getByRole('heading', { level: 1, name: 'New pot' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recipe')).toHaveAttribute('placeholder', '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak…');
    expect(screen.getByRole('button', { name: 'Split into ingredients' })).toBeDisabled();

    await splitExample(user);
    // Splitting: a short skeleton first.
    expect(screen.getByRole('status')).toHaveTextContent('Splitting the recipe');
    expect(await screen.findByRole('heading', { level: 2, name: 'Ingredients' }, SLOW)).toBeInTheDocument();

    expect(row('Ayam')).toHaveTextContent('~2,150');
    expect(row('Santan')).toHaveTextContent('~800');
    expect(row('Kentang')).toHaveTextContent('~350');
    expect(row('Rempah and bawang')).toHaveTextContent('~250');
    expect(row('Cooking oil')).toHaveTextContent('~480');
    expect(within(row('Cooking oil')).getByRole('button', { name: '4 tbsp' })).toHaveAttribute('aria-pressed', 'true');
    expect(wholePot()).toBe('~4,030 kcal');
    expect(within(screen.getByRole('group', { name: 'Common servings' })).getByRole('button', { name: '8' })).toHaveAttribute('aria-pressed', 'true');
    expect(perServing()).toBe('~500 kcal a serving');
    expect(screen.queryByRole('button', { name: /^Split/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save pot' }));
    await expect.poll(() => db.pots.count()).toBe(2);
    const saved = (await db.pots.toArray()).find((p) => p.id !== KARI_AYAM);
    expect(saved).toMatchObject({ name: 'Kari ayam', servings: 8, servingsLeft: 8, cookedOn: TODAY, expiresOn: '2026-10-20', recipeText: RECIPE });
    expect(saved?.ingredients).toHaveLength(5);
    expect(router.state.location.pathname).toBe(`/more/pots/${saved?.id}`);
    expect(useUiStore.getState().toast?.message).toBe('Pot saved · ~500 kcal a serving');
  });

  it('changes servings with the chips and the stepper', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await splitExample(user);
    await screen.findByRole('heading', { name: 'Ingredients' }, SLOW);

    await user.click(within(screen.getByRole('group', { name: 'Common servings' })).getByRole('button', { name: '10' }));
    expect(perServing()).toBe('~400 kcal a serving');
    await user.click(screen.getByRole('button', { name: 'Raise servings' }));
    expect(screen.getByText('11', { selector: 'output' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Common servings' })).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'false');
    expect(perServing()).toBe('~370 kcal a serving');
    await user.click(screen.getByRole('button', { name: 'Lower servings' }));
    await user.click(screen.getByRole('button', { name: 'Lower servings' }));
    expect(perServing()).toBe('~450 kcal a serving');
  });

  it('sets the oil with the spoon chips', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await splitExample(user);
    await screen.findByRole('heading', { name: 'Ingredients' }, SLOW);
    await user.click(within(row('Cooking oil')).getByRole('button', { name: '6 tbsp' }));
    expect(row('Cooking oil')).toHaveTextContent('6 tbsp');
    expect(row('Cooking oil')).toHaveTextContent('~720');
    expect(wholePot()).toBe('~4,270 kcal');
  });

  it('tags an unknown ingredient as an AI guess', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await splitExample(user, '1 ekor ayam, 2 cawan beras');
    await screen.findByRole('heading', { name: 'Ingredients' }, SLOW);
    expect(within(row('Beras')).getByText('AI guess')).toBeInTheDocument();
    expect(within(row('Beras')).getByText('Not in the catalogue. A rough guess you can edit.')).toBeInTheDocument();
    expect(within(row('Ayam')).getByText('Catalogue')).toBeInTheDocument();
  });

  it('edits an amount, sets a kcal by hand, removes with undo and adds an ingredient', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await splitExample(user);
    await screen.findByRole('heading', { name: 'Ingredients' }, SLOW);

    // Amount: 3 → 5 kentang re-scales from the catalogue.
    await user.click(screen.getByRole('button', { name: 'Edit Kentang' }));
    const amount = screen.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '5 biji');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(row('Kentang')).toHaveTextContent('5 biji');
    expect(row('Kentang')).toHaveTextContent('~580');

    // kcal by hand: tagged as your correction.
    await user.click(screen.getByRole('button', { name: 'Edit Santan' }));
    const kcal = screen.getByLabelText('kcal');
    await user.clear(kcal);
    await user.type(kcal, '600');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(within(row('Santan')).getByText('Your correction')).toBeInTheDocument();
    expect(row('Santan')).toHaveTextContent('~600');
    expect(wholePot()).toBe('~4,060 kcal');

    // Remove, then Undo from the toast.
    await user.click(screen.getByRole('button', { name: 'Remove Rempah and bawang' }));
    expect(screen.queryByText('Rempah and bawang', { selector: 'span' })).not.toBeInTheDocument();
    expect(wholePot()).toBe('~3,810 kcal');
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Removed Rempah and bawang');
    toast?.undo?.();
    expect(await screen.findByText('Rempah and bawang', { selector: 'span' }, SLOW)).toBeInTheDocument();
    const names = screen.getAllByRole('button', { name: /^Edit / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Edit Ayam', 'Edit Santan', 'Edit Kentang', 'Edit Rempah and bawang', 'Edit Cooking oil']);

    // + Add ingredient opens a blank row in the editor.
    await user.click(screen.getByRole('button', { name: 'Add ingredient' }));
    const form = screen.getByRole('form', { name: 'Edit New ingredient' });
    expect(within(form).getByLabelText('Ingredient')).toHaveFocus();
    await user.type(within(form).getByLabelText('Ingredient'), 'Telur');
    await user.type(within(form).getByLabelText('Amount'), '2 biji');
    await user.click(within(form).getByRole('button', { name: 'Done' }));
    expect(row('Telur')).toHaveTextContent('~160');
    expect(wholePot()).toBe('~4,220 kcal');

    // A blank new row goes away on Cancel.
    await user.click(screen.getByRole('button', { name: 'Add ingredient' }));
    await user.click(within(screen.getByRole('form')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(6);
  });

  it('asks for a name before saving', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await user.type(screen.getByLabelText('Recipe'), RECIPE);
    await user.click(screen.getByRole('button', { name: 'Split into ingredients' }));
    await user.click(await screen.findByRole('button', { name: 'Save pot' }, SLOW));
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Name the pot first');
    expect(name).toHaveFocus();
    expect(await db.pots.count()).toBe(1);
    await user.type(name, 'Kari');
    expect(name).not.toHaveAttribute('aria-invalid');
  });

  it('offers Split again after the recipe changes', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await splitExample(user, '1 ekor ayam');
    await screen.findByRole('heading', { name: 'Ingredients' }, SLOW);
    await user.type(screen.getByLabelText('Recipe'), ', 1 tin santan');
    await user.click(screen.getByRole('button', { name: 'Split again' }));
    expect(await screen.findByText('Santan', { selector: 'span' }, SLOW)).toBeInTheDocument();
  });

  it('skips a pasted title line that repeats the pot name', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await user.type(screen.getByLabelText('Name'), 'Lauk Ahad');
    await user.type(screen.getByLabelText('Recipe'), 'Lauk Ahad{Enter}1 tin santan{Enter}3 kentang');
    await user.click(screen.getByRole('button', { name: 'Split into ingredients' }));
    await screen.findByRole('heading', { name: 'Ingredients' }, SLOW);
    const names = screen.getAllByRole('button', { name: /^Edit / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Edit Santan', 'Edit Kentang']);
    expect(wholePot()).toBe('~1,150 kcal');
  });

  it('reads chicken pieces as pieces, not whole birds', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await splitExample(user, 'ayam 8 ketul, 1 tin santan');
    await screen.findByRole('heading', { name: 'Ingredients' }, SLOW);
    expect(row('Ayam')).toHaveTextContent('8 ketul');
    expect(row('Ayam')).toHaveTextContent('~1,380');
  });

  it('says so when nothing in the recipe can be read', async () => {
    const user = userEvent.setup();
    renderPots('/more/pots/new');
    await splitExample(user, '4, 500 g');
    expect(await screen.findByText(/^No ingredients found in that/, {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save pot' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add ingredient' })).toBeInTheDocument();
  });

  it('cooks again: pre-filled from ?recipe= and saved as a new pot', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots', `/more/pots/new?recipe=${KARI_AYAM}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Cook again' })).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Kari ayam', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('From your Kari ayam recipe. Change anything for this pot.')).toBeInTheDocument();
    expect(screen.getByLabelText('Recipe')).toHaveValue(RECIPE);
    expect(row('Ayam')).toHaveTextContent('~2,150');
    expect(row('Cooking oil')).toHaveTextContent('~480');
    expect(wholePot()).toBe('~4,030 kcal');
    expect(perServing()).toBe('~500 kcal a serving');
    expect(screen.queryByRole('button', { name: /^Split/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save pot' }));
    await expect.poll(() => db.pots.count()).toBe(2);
    const fresh = (await db.pots.toArray()).find((p) => p.id !== KARI_AYAM);
    const source = await db.pots.get(KARI_AYAM);
    expect(fresh).toMatchObject({ name: 'Kari ayam', servings: 8, servingsLeft: 8, cookedOn: TODAY });
    expect(fresh?.ingredients.map((i) => i.name)).toEqual(source?.ingredients.map((i) => i.name));
    expect(fresh?.ingredients.some((i) => source?.ingredients.some((s) => s.id === i.id))).toBe(false);
    expect(source?.servingsLeft).toBe(3);
    expect(router.state.location.pathname).toBe(`/more/pots/${fresh?.id}`);
  });

  it('starts fresh when the recipe to cook again is gone', async () => {
    renderPots('/more/pots/new?recipe=pot-gone');
    expect(await screen.findByText("That recipe isn't here any more. Start this one fresh.", {}, SLOW)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('goes back to Pots without history', async () => {
    const user = userEvent.setup();
    const router = renderPots('/more/pots/new');
    await user.click(screen.getByRole('button', { name: 'Back to Pots' }));
    expect(router.state.location.pathname).toBe('/more/pots');
  });
});

