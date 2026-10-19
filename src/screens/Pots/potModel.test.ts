import type { PotIngredient } from '@/domain/types';
import { splitRecipe } from '@/estimate/recipe';
import { applyIngredientEdit, blankIngredient, clearsText, cookAgainPath, cookedText, logLabel, servingToast, withOilTbsp } from './potModel';

const TODAY = '2026-10-16'; // Fri
const [AYAM, , KENTANG, , OIL] = splitRecipe('1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang') as PotIngredient[];

describe('copy', () => {
  it('says when a pot clears', () => {
    expect(clearsText('active', '2026-10-18', TODAY)).toBe('Clears Sunday');
    expect(clearsText('active', '2026-10-17', TODAY)).toBe('Clears tomorrow');
    expect(clearsText('clearsToday', TODAY, TODAY)).toBe('Clears today');
    expect(clearsText('cleared', '2026-10-14', TODAY)).toBe('Cleared');
    expect(clearsText('active', '2026-10-30', TODAY)).toBe('Clears Fri 30 Oct');
  });

  it('says when it was cooked', () => {
    expect(cookedText('2026-10-14', TODAY)).toBe('cooked Wed');
    expect(cookedText(TODAY, TODAY)).toBe('cooked today');
    expect(cookedText('2026-10-15', TODAY)).toBe('cooked yesterday');
    expect(cookedText('2026-10-01', TODAY)).toBe('cooked Thu 1 Oct');
  });

  it('writes the log toast and buttons', () => {
    expect(servingToast(503.75, 2)).toBe('Saved · ~500 kcal · 2 left');
    expect(servingToast(251.9, 2.5)).toBe('Saved · ~250 kcal · 2½ left');
    expect(servingToast(503.75, 0)).toBe('Saved · ~500 kcal · none left');
    expect(logLabel(1)).toBe('Log 1 serving');
    expect(logLabel(0.5)).toBe('Log ½ serving');
    expect(logLabel(2)).toBe('Log 2 servings');
  });

  it('links Cook again to a pre-filled New pot', () => {
    expect(cookAgainPath('pot-kari-ayam')).toBe('/more/pots/new?recipe=pot-kari-ayam');
  });
});

describe('applyIngredientEdit', () => {
  it('re-scales a known ingredient when its amount changes', () => {
    const next = applyIngredientEdit(AYAM!, { name: 'Ayam', amount: 'half ekor' }, false);
    expect(next).toMatchObject({ id: AYAM!.id, name: 'Ayam', amount: 'half ekor', source: 'catalogue' });
    expect(next?.macros.kcal).toBe(1075);
  });

  it('lets a typed kcal win and tags it as your correction', () => {
    const next = applyIngredientEdit(KENTANG!, { name: 'Kentang', amount: '4 biji', kcal: 400 }, false);
    expect(next).toMatchObject({ amount: '4 biji', source: 'yourCorrection' });
    expect(next?.macros.kcal).toBe(400);
  });

  it('keeps everything on a rename of a known ingredient', () => {
    const next = applyIngredientEdit(AYAM!, { name: 'Ayam kampung', amount: '1 ekor' }, false);
    expect(next).toMatchObject({ name: 'Ayam kampung', amount: '1 ekor', macros: AYAM!.macros });
  });

  it('reads a new row from its name and amount', () => {
    const blank = blankIngredient('new-1');
    expect(applyIngredientEdit(blank, { name: 'Telur', amount: '2 biji' }, true)).toMatchObject({
      id: 'new-1',
      name: 'Telur',
      amount: '2 biji',
      source: 'catalogue',
      macros: { kcal: 160 },
    });
    expect(applyIngredientEdit(blank, { name: 'Daun sup', amount: '' }, true)).toMatchObject({ name: 'Daun sup', source: 'aiGuess' });
    expect(applyIngredientEdit(blank, { name: 'minyak', amount: '2 sudu' }, true)).toMatchObject({ isOil: true, amount: '2 tbsp' });
    expect(applyIngredientEdit(blank, { name: '  ', amount: '2 biji' }, true)).toBeNull();
  });

  it('reads a renamed guess again', () => {
    const [guess] = splitRecipe('2 biji tomato') as PotIngredient[];
    const next = applyIngredientEdit(guess!, { name: 'Kentang', amount: '2 biji' }, false);
    expect(next).toMatchObject({ name: 'Kentang', source: 'catalogue', macros: { kcal: 230 } });
  });

  it('switches oil between the chips', () => {
    expect(withOilTbsp(OIL!, 2)).toMatchObject({ id: OIL!.id, name: 'Cooking oil', amount: '2 tbsp', isOil: true, macros: { kcal: 240 } });
  });
});
