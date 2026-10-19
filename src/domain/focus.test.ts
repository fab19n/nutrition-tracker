import { describe, expect, it } from 'vitest';
import { buildDemoMeals } from '@/db/seed/demoMeals';
import { FOCUS_RULES, focusProgress, focusRuleIdOf, hasSugarChoice, isFocusRuleId, isNasiKandarRice } from './focus';
import { instantAt } from './day';
import type { MealItem, MealLog, MealSlot, Variant } from './types';

const WEEK = '2026-10-12';
const TODAY = '2026-10-16';

const macros = (kcal: number) => ({ kcal, proteinG: 0, carbsG: 0, fatG: 0 });
const v = (label: string, kcal: number): Variant => ({ id: label.toLowerCase(), label, macros: macros(kcal) });

function item(name: string, opts: { catalogueId?: string; variants?: Variant[]; selected?: number; quantity?: number } = {}): MealItem {
  const selected = opts.selected ?? 0;
  const out: MealItem = {
    id: `${name}-${selected}`,
    name,
    unitMacros: opts.variants?.[selected]?.macros ?? macros(100),
    quantity: opts.quantity ?? 1,
    uncertainty: 0.15,
    source: 'catalogue',
  };
  if (opts.catalogueId) out.catalogueId = opts.catalogueId;
  if (opts.variants) {
    out.variants = opts.variants;
    out.selectedVariant = selected;
  }
  return out;
}

const sugar = [v('Kosong', 70), v('Kurang', 140), v('Normal', 200)];
const nkRice = [v('Small', 250), v('Normal', 330), v('Mamak big', 430)];
const tehTarik = (selected: number, quantity = 1) => item('Teh tarik', { catalogueId: 'teh-tarik', variants: sugar, selected, quantity });
const rice = (selected: number) => item('Nasi kandar rice', { catalogueId: 'rice-nasi-kandar', variants: nkRice, selected });

let n = 0;
function meal(day: string, hour: number, minute: number, items: MealItem[], extra: Partial<MealLog> = {}): MealLog {
  n += 1;
  const slot: MealSlot = hour < 11 ? 'breakfast' : hour < 17 ? 'lunch' : 'dinner';
  return {
    id: `m${n}`,
    eatenAt: instantAt(day, hour, minute),
    logicalDay: day,
    slot,
    name: items.map((i) => i.name).join(' + '),
    items,
    method: 'text',
    finished: 'all',
    createdAt: instantAt(day, hour, minute),
    updatedAt: instantAt(day, hour, minute),
    syncState: 'local',
    ...extra,
  };
}

describe('focus rules', () => {
  it('knows the three rule ids and finds a rule from a label saved without an id', () => {
    expect(isFocusRuleId('drinksKurang')).toBe(true);
    expect(isFocusRuleId('somethingElse')).toBe(false);
    expect(focusRuleIdOf({ label: 'Kurang manis for drinks' })).toBe('drinksKurang');
    expect(focusRuleIdOf({ label: '  half rice at Nasi Kandar ' })).toBe('halfRiceNasiKandar');
    expect(focusRuleIdOf({ label: 'Anything', ruleId: 'windowUnder12h' })).toBe('windowUnder12h');
    expect(focusRuleIdOf({ label: 'Walk after dinner' })).toBeUndefined();
    expect(focusRuleIdOf(undefined)).toBeUndefined();
    expect(FOCUS_RULES.windowUnder12h.label).toBe('Keep eating days under 12 hours');
  });

  it('spots drinks with a sugar choice and nasi kandar rice', () => {
    expect(hasSugarChoice(tehTarik(2))).toBe(true);
    expect(hasSugarChoice(item('Kopi', { variants: [v('Small', 1), v('Big', 2)] }))).toBe(false);
    expect(isNasiKandarRice(rice(1))).toBe(true);
    expect(isNasiKandarRice(item('Rice', { catalogueId: 'rice-economy' }))).toBe(false);
  });
});

describe('focusProgress', () => {
  it('drinksKurang counts kurang and kosong drinks out of every drink with a sugar choice', () => {
    const meals = [
      meal('2026-10-12', 9, 30, [tehTarik(1), item('Roti canai')]),
      meal('2026-10-13', 9, 30, [tehTarik(2, 2)]),
      meal('2026-10-14', 20, 0, [tehTarik(0)]),
      // A guess and last week's drink don't count.
      meal('2026-10-15', 20, 0, [tehTarik(2)], { isGuess: true }),
      meal('2026-10-09', 9, 30, [tehTarik(1)]),
    ];
    const progress = focusProgress('drinksKurang', { meals, today: TODAY });
    expect(progress).toMatchObject({ done: 2, total: 4, label: '2 of 4' });
    expect(progress.description).toBe('2 of 4 drinks kurang or kosong so far');
  });

  it('drinksKurang says so when there are no drinks yet', () => {
    const progress = focusProgress('drinksKurang', { meals: [meal(WEEK, 9, 0, [item('Roti canai')])], today: WEEK });
    expect(progress).toMatchObject({ done: 0, total: 0, label: 'No drinks yet' });
  });

  it('halfRiceNasiKandar counts visits with small rice', () => {
    const meals = [
      meal('2026-10-12', 20, 30, [rice(0), item('Ayam goreng')]),
      meal('2026-10-13', 20, 30, [rice(2), item('Kuah campur')]),
      meal('2026-10-14', 13, 30, [item('Rice', { catalogueId: 'rice-economy' })]),
    ];
    expect(focusProgress('halfRiceNasiKandar', { meals, today: TODAY })).toMatchObject({ done: 1, total: 2, label: '1 of 2' });
    expect(focusProgress('halfRiceNasiKandar', { meals: [], today: TODAY }).label).toBe('No visits yet');
  });

  it('windowUnder12h counts finished days with a window of 12 hours or less', () => {
    const meals = [
      // Mon: 9:00 → 21:00 = exactly 12 h.
      meal('2026-10-12', 9, 0, [item('Roti')]),
      meal('2026-10-12', 21, 0, [item('Rice')]),
      // Tue: 8:00 → 23:30 = 15.5 h.
      meal('2026-10-13', 8, 0, [item('Roti')]),
      meal('2026-10-13', 23, 30, [item('Maggi')]),
      // Wed: a single meal.
      meal('2026-10-14', 13, 0, [item('Rice')]),
      // Today is still going and isn't counted, even with a long day so far.
      meal(TODAY, 6, 0, [item('Roti')]),
      meal(TODAY, 19, 0, [item('Rice')]),
    ];
    const progress = focusProgress('windowUnder12h', { meals, today: TODAY });
    expect(progress).toMatchObject({ done: 2, total: 3, label: '2 of 3' });
    expect(progress.description).toBe('2 of 3 days under 12 hours so far');
    expect(focusProgress('windowUnder12h', { meals: [meal(WEEK, 9, 0, [item('Roti')])], today: WEEK }).label).toBe('From tomorrow');
  });

  it('reads the demo week: 2 of 3 drinks kurang, 0 of 1 nasi kandar visits small, 4 of 4 days under 12 hours', () => {
    const meals = buildDemoMeals();
    expect(focusProgress('drinksKurang', { meals, today: TODAY }).label).toBe('2 of 3');
    expect(focusProgress('halfRiceNasiKandar', { meals, today: TODAY }).label).toBe('0 of 1');
    expect(focusProgress('windowUnder12h', { meals, today: TODAY }).label).toBe('4 of 4');
  });
});
