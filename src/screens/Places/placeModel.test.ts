// @vitest-environment node
import type { OrderOption } from '@/db/logging';
import type { MealItem, Pot } from '@/domain/types';
import {
  avgKcalLabel,
  homeDishLine,
  isLearning,
  lastVisitLabel,
  learnedValue,
  orderDetailLine,
  orderExtras,
  orderLoggedToday,
  potLine,
  spendLabel,
  timesLabel,
  visitsLabel,
  visitsLine,
  visitsShort,
} from './placeModel';

const TODAY = '2026-10-16';

function item(name: string, catalogueId?: string, extra: Partial<MealItem> = {}): MealItem {
  const base: MealItem = { id: name, name, unitMacros: { kcal: 100, proteinG: 0, carbsG: 0, fatG: 0 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' };
  return catalogueId ? { ...base, catalogueId, ...extra } : { ...base, ...extra };
}

function order(name: string, items: MealItem[], times: number, kcal: number): Pick<OrderOption, 'name' | 'items' | 'times' | 'kcal'> {
  return { name, items, times, kcal };
}

describe('visits and numbers', () => {
  it('counts visits in words', () => {
    expect(visitsLabel(0)).toBe('No visits in 30 days');
    expect(visitsLabel(1)).toBe('1 visit in 30 days');
    expect(visitsLabel(14)).toBe('14 visits in 30 days');
    expect(visitsShort(0)).toBe('No visits');
    expect(visitsShort(1)).toBe('1 visit');
    expect(visitsShort(1200)).toBe('1,200 visits');
    expect(isLearning({ visits: 2 })).toBe(true);
    expect(isLearning({ visits: 3 })).toBe(false);
  });

  it('says when the last visit was', () => {
    expect(lastVisitLabel(undefined, TODAY)).toBeUndefined();
    expect(lastVisitLabel(TODAY, TODAY)).toBe('last today');
    expect(lastVisitLabel('2026-10-15', TODAY)).toBe('last yesterday');
    expect(lastVisitLabel('2026-10-13', TODAY)).toBe('last Tue');
    expect(lastVisitLabel('2026-10-02', TODAY)).toBe('last Fri 2 Oct');
    expect(visitsLine({ visits: 14, lastVisitDay: TODAY }, TODAY)).toBe('14 visits in 30 days · last today');
    expect(visitsLine({ visits: 0 }, TODAY)).toBe('No visits in 30 days');
  });

  it('rounds averages to 10 and picks the spend to show', () => {
    expect(avgKcalLabel(null)).toBeUndefined();
    expect(avgKcalLabel(787.27)).toBe('~790');
    expect(spendLabel({ spendWeekRm: 16.8, spend30Rm: 122 })).toBe('RM 16.80 this week');
    expect(spendLabel({ spendWeekRm: 0, spend30Rm: 24 })).toBe('RM 24.00 in 30 days');
    expect(spendLabel({ spendWeekRm: 0, spend30Rm: 0 })).toBeUndefined();
  });
});

describe('usual order detail', () => {
  const rice = item('Nasi kandar rice', 'rice-nasi-kandar');
  const ayam = item('Ayam goreng', 'ayam-goreng-mamak');
  const kuah = item('Kuah campur', 'kuah-campur', {
    variants: [
      { id: 's', label: 'Sikit', macros: { kcal: 60, proteinG: 0, carbsG: 0, fatG: 0 } },
      { id: 'n', label: 'Normal', macros: { kcal: 120, proteinG: 0, carbsG: 0, fatG: 0 } },
      { id: 'b', label: 'Banjir', macros: { kcal: 220, proteinG: 0, carbsG: 0, fatG: 0 } },
    ],
    selectedVariant: 2,
  });

  it('names what the order name leaves out, skipping the rice', () => {
    expect(orderExtras(order('Nasi kandar ayam goreng', [rice, ayam, kuah], 9, 950))).toEqual(['Kuah campur banjir']);
    expect(orderDetailLine(order('Nasi kandar ayam goreng', [rice, ayam, kuah], 9, 954))).toBe('Kuah campur banjir · 9 times · ~950 kcal');
  });

  it('keeps sentence case across several extras and stops at two', () => {
    const plate = order('Economy rice', [item('Rice', 'rice-economy'), item('Ayam masak merah'), item('Kangkung belacan'), item('Kubis goreng')], 9, 670);
    expect(orderDetailLine(plate)).toBe('Ayam masak merah, kangkung belacan · 9 times · ~670 kcal');
  });

  it('is just how often and how much when the name says it all', () => {
    expect(orderDetailLine(order('Roti canai + teh tarik', [item('Roti canai + dhal'), item('Teh tarik')], 6, 560))).toBe('6 times · ~560 kcal');
    expect(orderDetailLine(order('Teh o ais kurang', [item('Teh o ais')], 1, 60))).toBe('Once · ~60 kcal');
    expect(orderDetailLine(order('Teh o ais kurang', [item('Teh o ais')], 0, 60))).toBe('~60 kcal');
    expect(timesLabel(2)).toBe('2 times');
  });

  it('knows an order already eaten today', () => {
    expect(orderLoggedToday({ name: 'Roti canai + teh tarik' }, ['roti canai teh tarik'])).toBe(true);
    expect(orderLoggedToday({ name: 'Nasi kandar ayam goreng' }, ['roti canai teh tarik'])).toBe(false);
  });
});

describe('learned and home lines', () => {
  it('writes the learned value with its change', () => {
    expect(learnedValue({ variantLabel: 'Mamak big', changePct: 30, kcal: 430 })).toBe('Mamak big, +30%');
    expect(learnedValue({ variantLabel: 'Sikit', changePct: -50, kcal: 60 })).toBe('Sikit, −50%');
    expect(learnedValue({ variantLabel: 'Normal', kcal: 330 })).toBe('Normal');
    expect(learnedValue({ kcal: 418 })).toBe('Your version · ~420');
  });

  it('writes home dishes and pots', () => {
    expect(homeDishLine({ key: 'x', name: 'Ikan goreng', times: 6, kcal: 188 })).toBe('6 times · ~190 each');
    const pot: Pot = {
      id: 'p',
      name: 'Kari ayam',
      recipeText: '',
      ingredients: [{ id: 'i', name: 'All', amount: '', macros: { kcal: 4030, proteinG: 0, carbsG: 0, fatG: 0 }, source: 'catalogue' }],
      servings: 8,
      servingsLeft: 2.5,
      cookedOn: '2026-10-14',
      expiresOn: '2026-10-18',
      createdAt: '2026-10-14T10:30:00.000Z',
    };
    // The same clear day as the Pots screens and C38 ("Clears Sunday").
    expect(potLine(pot, TODAY)).toBe('2½ of 8 left · ~500 a serving · clears Sunday');
    expect(potLine({ ...pot, expiresOn: TODAY }, TODAY)).toBe('2½ of 8 left · ~500 a serving · clears today');
    expect(potLine({ ...pot, expiresOn: '2026-10-17' }, TODAY)).toBe('2½ of 8 left · ~500 a serving · clears tomorrow');
    expect(potLine({ ...pot, expiresOn: '2026-10-30' }, TODAY)).toBe('2½ of 8 left · ~500 a serving · clears Fri 30 Oct');
  });
});
