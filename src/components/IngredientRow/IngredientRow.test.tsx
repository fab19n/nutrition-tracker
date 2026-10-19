import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PotIngredient } from '@/domain/types';
import { AI_GUESS_NOTE, IngredientRow, editResult, parseKcalInput } from './IngredientRow';

const AYAM: PotIngredient = {
  id: 'ayam',
  name: 'Ayam',
  amount: '1 ekor',
  macros: { kcal: 2150, proteinG: 186, carbsG: 0, fatG: 153 },
  source: 'catalogue',
};
const OIL: PotIngredient = {
  id: 'oil',
  name: 'Cooking oil',
  amount: '4 tbsp',
  macros: { kcal: 480, proteinG: 0, carbsG: 0, fatG: 54 },
  source: 'catalogue',
  isOil: true,
};
const BERAS: PotIngredient = {
  id: 'beras',
  name: 'Beras',
  amount: '2 cawan',
  macros: { kcal: 1000, proteinG: 50, carbsG: 112.5, fatG: 38.9 },
  source: 'aiGuess',
};

describe('kcal input', () => {
  it('reads whole numbers with commas, a ~ or "kcal"', () => {
    expect(parseKcalInput('2,150')).toBe(2150);
    expect(parseKcalInput(' ~480 kcal')).toBe(480);
    expect(parseKcalInput('99.6')).toBe(100);
    expect(parseKcalInput('0')).toBe(0);
    expect(parseKcalInput('')).toBeUndefined();
    expect(parseKcalInput('-20')).toBeUndefined();
    expect(parseKcalInput('lots')).toBeUndefined();
  });

  it('only hands back kcal when it changed', () => {
    const start = { name: 'Ayam', amount: '1 ekor', kcal: '2150' };
    expect(editResult(start, { name: ' Ayam ', amount: 'half ekor ', kcal: '2150' })).toEqual({ name: 'Ayam', amount: 'half ekor' });
    expect(editResult(start, { name: 'Ayam', amount: '1 ekor', kcal: '1,900' })).toEqual({ name: 'Ayam', amount: '1 ekor', kcal: 1900 });
  });
});

describe('IngredientRow (C39)', () => {
  it('shows name, source, amount and ~kcal with labelled edit and remove', () => {
    render(<IngredientRow ingredient={AYAM} onSave={() => {}} onRemove={() => {}} />);
    expect(screen.getByText('Ayam')).toBeInTheDocument();
    expect(screen.getByText('Catalogue')).toBeInTheDocument();
    expect(screen.getByText('1 ekor')).toBeInTheDocument();
    expect(screen.getByText('~2,150')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Ayam' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Ayam' })).toBeInTheDocument();
  });

  it('is read-only on Pot detail', () => {
    render(<IngredientRow ingredient={OIL} readOnly oil={{ choices: [2, 4, 6], selected: 4, onSelect: () => {} }} />);
    expect(screen.getByText('4 tbsp')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks an AI guess with its tag and a note', () => {
    render(<IngredientRow ingredient={BERAS} onSave={() => {}} />);
    expect(screen.getByText('AI guess')).toBeInTheDocument();
    expect(screen.getByText(AI_GUESS_NOTE)).toBeInTheDocument();
  });

  it('shows the oil spoon chips with the current amount selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<IngredientRow ingredient={OIL} onSave={() => {}} oil={{ choices: [2, 4, 6], selected: 4, onSelect }} />);
    const chips = within(screen.getByRole('group', { name: 'Cooking oil amount' }));
    expect(chips.getByRole('button', { name: '4 tbsp' })).toHaveAttribute('aria-pressed', 'true');
    expect(chips.getByRole('button', { name: '2 tbsp' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(chips.getByRole('button', { name: '6 tbsp' }));
    expect(onSelect).toHaveBeenCalledWith(6);
  });

  it('edits the amount and hands back the change', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<IngredientRow ingredient={AYAM} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Edit Ayam' }));
    const form = screen.getByRole('form', { name: 'Edit Ayam' });
    expect(within(form).getByLabelText('Ingredient')).toHaveFocus();
    const amount = within(form).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, 'half ekor');
    await user.click(within(form).getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Ayam', amount: 'half ekor' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Ayam' })).toHaveFocus();
  });

  it('sets kcal by hand, and blocks a kcal that is not a number', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<IngredientRow ingredient={AYAM} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Edit Ayam' }));
    const kcal = screen.getByLabelText('kcal');
    await user.clear(kcal);
    await user.type(kcal, 'abc');
    expect(kcal).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter kcal as a number, like 350')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    await user.clear(kcal);
    await user.type(kcal, '1900{Enter}');
    expect(onSave).toHaveBeenCalledWith({ name: 'Ayam', amount: '1 ekor', kcal: 1900 });
  });

  it('cancels without saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<IngredientRow ingredient={AYAM} onSave={onSave} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Edit Ayam' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('~2,150')).toBeInTheDocument();
  });

  it('opens in the editor for a new row', () => {
    render(<IngredientRow ingredient={{ ...AYAM, name: '', amount: '' }} defaultEditing onSave={() => {}} />);
    expect(screen.getByRole('form', { name: 'Edit New ingredient' })).toBeInTheDocument();
    expect(screen.getByLabelText('Ingredient')).toHaveValue('');
  });

  it('removes', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<IngredientRow ingredient={AYAM} onSave={() => {}} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Remove Ayam' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
