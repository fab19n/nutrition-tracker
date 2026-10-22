import { byId } from '@/data/catalogue';
import { GUESS_NORMAL_INDEX, GUESS_UNCERTAINTY, guessMacrosFor, guessVariants } from '@/estimate/local/guess';
import {
  CHECKED_UNCERTAINTY,
  DISH_CHECK_LIMIT,
  dishEstimate,
  dishKeyOf,
  dishStats,
  loggedDayCount,
  planDishAnswer,
  stepVariant,
  topDishes,
  type DishEstimate,
  type DishSource,
  type DishStat,
} from './dishCheck';
import { instantAt } from './day';
import { itemFromCatalogue } from './meal';
import type { Macros, MealItem, MealLog, PersonalItem, Place, Variant } from './types';

const STAMP = '2026-10-01T00:00:00.000Z';

function macros(kcal: number): Macros {
  return { kcal, proteinG: 10, carbsG: 30, fatG: 5 };
}

function typed(name: string, kcal: number, extra: Partial<MealItem> = {}): MealItem {
  return { id: `item-${name}`, name, unitMacros: macros(kcal), quantity: 1, uncertainty: 0.15, source: 'yourCorrection', ...extra };
}

function catalogueItem(id: string, variant?: number): MealItem {
  const food = byId(id);
  if (!food) throw new Error(`No catalogue item ${id}`);
  return itemFromCatalogue(food, variant === undefined ? { id: `item-${id}` } : { variant, id: `item-${id}` });
}

let counter = 0;

function meal(day: string, items: MealItem[], opts: Partial<MealLog> & { hour?: number } = {}): MealLog {
  counter += 1;
  const { hour = 13, ...rest } = opts;
  return {
    id: `meal-${counter}`,
    eatenAt: instantAt(day, hour, 30),
    logicalDay: day,
    slot: 'lunch',
    name: 'Meal',
    items,
    method: 'text',
    finished: 'all',
    createdAt: STAMP,
    updatedAt: STAMP,
    syncState: 'local',
    ...rest,
  };
}

function place(id: string, defaultVariants: Place['defaultVariants'] = {}): Place {
  return { id, name: `Place ${id}`, type: 'mamak', defaultVariants, createdAt: STAMP };
}

function personal(p: Partial<PersonalItem> & Pick<PersonalItem, 'id' | 'scope' | 'name'>): PersonalItem {
  return { unitMacros: macros(100), uncertainty: 0.15, corrections: 1, createdAt: STAMP, updatedAt: STAMP, ...p };
}

const day = (n: number): string => `2026-10-${String(n).padStart(2, '0')}`;

describe('dishKeyOf', () => {
  it('is the catalogue id, else the normalised name', () => {
    expect(dishKeyOf({ catalogueId: 'rice-economy', name: 'Rice (economy rice)' })).toBe('rice-economy');
    expect(dishKeyOf({ name: '  Nasi  KERABU ' })).toBe('name:nasi kerabu');
    expect(dishKeyOf({ name: 'Teh-O Ais' })).toBe('name:teh o ais');
  });
});

describe('dishStats', () => {
  it('counts a dish once per meal, even with two lines of it', () => {
    const stats = dishStats(
      [
        meal(day(1), [catalogueItem('rice-economy'), { ...catalogueItem('rice-economy'), id: 'second-scoop' }, catalogueItem('kangkung-belacan')]),
        meal(day(2), [catalogueItem('rice-economy')]),
      ],
      [],
    );
    expect(stats.find((s) => s.key === 'rice-economy')?.times).toBe(2);
    expect(stats.find((s) => s.key === 'kangkung-belacan')?.times).toBe(1);
  });

  it('names a dish by the catalogue, else by what was logged, and keeps the newest item', () => {
    const older = catalogueItem('rice-economy', 0);
    const newer = catalogueItem('rice-economy', 2);
    const stats = dishStats(
      [
        meal(day(3), [newer], { id: 'newer' }),
        meal(day(1), [older, typed('Nasi kerabu', 520, { source: 'aiGuess' })], { id: 'older' }),
      ],
      [],
    );
    const rice = stats.find((s) => s.key === 'rice-economy');
    expect(rice).toMatchObject({ name: 'Rice (economy rice)', catalogueId: 'rice-economy', times: 2 });
    expect(rice?.latest.selectedVariant).toBe(2);
    expect(rice?.lastEatenAt).toBe(instantAt(day(3), 13, 30));
    const kerabu = stats.find((s) => s.key === 'name:nasi kerabu');
    expect(kerabu).toMatchObject({ name: 'Nasi kerabu', times: 1 });
    expect(kerabu?.catalogueId).toBeUndefined();
  });

  it('leaves out guesses, a pot serving without a catalogue id, pending estimates, 0 kcal and pot ingredients', () => {
    const stats = dishStats(
      [
        meal(day(1), [catalogueItem('karipap')], { isGuess: true }),
        meal(day(1), [typed('Kari ayam', 500)], { method: 'pot' }),
        meal(day(1), [typed('Soto', 300, { pendingEstimate: true })]),
        meal(day(1), [typed('Air kosong', 0)]),
        meal(day(1), [catalogueItem('santan')]),
        meal(day(1), [catalogueItem('minyak-masak')]),
      ],
      [],
    );
    expect(stats).toEqual([]);
  });

  it('keeps a catalogue item that sits beside a pot serving, such as rice', () => {
    const stats = dishStats([meal(day(1), [typed('Kari ayam', 500), catalogueItem('rice-economy')], { method: 'pot' })], []);
    expect(stats.map((s) => s.key)).toEqual(['rice-economy']);
  });

  describe('the Place a dish belongs to', () => {
    const kedai = place('kedai');
    const home = place('home');
    const lunch = (n: number, placeId?: string): MealLog => meal(day(n), [catalogueItem('rice-economy')], placeId ? { placeId } : {});

    it('is the Place holding 3 of 4 logs', () => {
      const stats = dishStats([lunch(1, 'kedai'), lunch(2, 'kedai'), lunch(3, 'kedai'), lunch(4, 'home')], [kedai, home]);
      expect(stats[0]?.placeId).toBe('kedai');
    });

    it('is none when no Place holds 60% (2 of 4)', () => {
      const stats = dishStats([lunch(1, 'kedai'), lunch(2, 'kedai'), lunch(3, 'home'), lunch(4, 'home')], [kedai, home]);
      expect(stats[0]?.placeId).toBeUndefined();
    });

    it('is none with a single log there', () => {
      expect(dishStats([lunch(1, 'kedai')], [kedai])[0]?.placeId).toBeUndefined();
    });

    it('is none when most logs have no Place', () => {
      const stats = dishStats([lunch(1, 'kedai'), lunch(2, 'kedai'), lunch(3), lunch(4), lunch(5)], [kedai]);
      expect(stats[0]?.placeId).toBeUndefined();
    });

    it('is none when the Place was deleted', () => {
      const stats = dishStats([lunch(1, 'kedai'), lunch(2, 'kedai'), lunch(3, 'kedai')], [home]);
      expect(stats[0]?.placeId).toBeUndefined();
    });

    it('is the Place with the most logs when another holds the rest (3 + 2 of 5 is 60%)', () => {
      const stats = dishStats([lunch(1, 'home'), lunch(2, 'kedai'), lunch(3, 'kedai'), lunch(4, 'home'), lunch(5, 'kedai')], [kedai, home]);
      expect(stats[0]?.placeId).toBe('kedai');
    });
  });
});

describe('loggedDayCount', () => {
  it('counts days with a real meal', () => {
    const meals = [
      meal(day(1), [typed('A', 100)]),
      meal(day(1), [typed('B', 100)]),
      meal(day(2), [typed('C', 100)], { isGuess: true }),
      meal(day(3), [typed('D', 100)]),
    ];
    expect(loggedDayCount(meals)).toBe(2);
    expect(loggedDayCount([])).toBe(0);
  });
});

describe('topDishes', () => {
  function stat(key: string, times: number, lastDay: number, name = key): DishStat {
    return { key, name, times, latest: typed(name, 100), lastEatenAt: instantAt(day(lastDay), 13, 30) };
  }

  it('lists dishes logged twice or more, most often first, then newest, then by name', () => {
    const list = topDishes([stat('once', 1, 9), stat('b', 3, 1, 'Bubur'), stat('a', 3, 1, 'Ayam'), stat('c', 3, 5, 'Cendol'), stat('d', 2, 9, 'Dosai')]);
    expect(list.map((s) => s.key)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('breaks a full tie by key', () => {
    const list = topDishes([stat('y', 2, 1, 'Same'), stat('x', 2, 1, 'Same')]);
    expect(list.map((s) => s.key)).toEqual(['x', 'y']);
  });

  it('keeps 30 of 31', () => {
    const stats = Array.from({ length: 31 }, (_, i) => stat(`dish-${String(i).padStart(2, '0')}`, 2, 1));
    expect(topDishes(stats)).toHaveLength(DISH_CHECK_LIMIT);
    expect(topDishes(stats, 5)).toHaveLength(5);
  });
});

describe('stepVariant', () => {
  const chip = (label: string, kcal: number): Variant => ({ id: label, label, macros: macros(kcal) });

  it('goes by kcal, not position', () => {
    const chips = [chip('Big', 430), chip('Small', 250), chip('Normal', 330)];
    expect(stepVariant(chips, 1, 'more')).toBe(2);
    expect(stepVariant(chips, 2, 'more')).toBe(0);
    expect(stepVariant(chips, 2, 'less')).toBe(1);
  });

  it('is undefined at either end', () => {
    const chips = [chip('Half', 100), chip('1 scoop', 200), chip('1.5 scoops', 300)];
    expect(stepVariant(chips, 2, 'more')).toBeUndefined();
    expect(stepVariant(chips, 0, 'less')).toBeUndefined();
    expect(stepVariant(chips, 1, 'more')).toBe(2);
    expect(stepVariant(chips, 1, 'less')).toBe(0);
  });

  it('skips a chip with the same kcal and takes the lower index on a tie', () => {
    const chips = [chip('A', 100), chip('B', 100), chip('C', 200), chip('D', 200)];
    expect(stepVariant(chips, 0, 'more')).toBe(2);
    expect(stepVariant(chips, 3, 'less')).toBe(0);
  });

  it('is undefined for a selection out of range', () => {
    expect(stepVariant([chip('A', 100)], 4, 'more')).toBeUndefined();
    expect(stepVariant([], 0, 'less')).toBeUndefined();
  });
});

describe('dishEstimate', () => {
  const nasiKandar = place('nk', { 'rice-nasi-kandar': 2 });
  const ctx = (p: PersonalItem[] = [], places: Place[] = [nasiKandar]) => ({ personal: p, places });

  function statFor(item: MealItem, extra: Partial<DishStat> = {}): DishStat {
    const stat: DishStat = {
      key: dishKeyOf(item),
      name: byId(item.catalogueId ?? '')?.name ?? item.name,
      times: 4,
      latest: item,
      lastEatenAt: STAMP,
      ...extra,
    };
    if (item.catalogueId) stat.catalogueId = item.catalogueId;
    return stat;
  }

  it('shows the catalogue number with the catalogue label and unit when nothing is learned', () => {
    const estimate = dishEstimate(statFor(catalogueItem('rice-economy')), ctx());
    expect(estimate).toMatchObject({ source: 'catalogue', scope: 'dish', kcal: 200, portion: '1 scoop' });
    expect(estimate.placeId).toBeUndefined();
    expect(estimate.item.id).toBe('rice-economy');
  });

  it('keeps the catalogue entry’s own label (MyFCD, SG FoodID, USDA)', () => {
    const food = byId('rice-economy');
    if (!food) throw new Error('catalogue changed');
    food.source = 'myfcd';
    try {
      expect(dishEstimate(statFor(catalogueItem('rice-economy')), ctx()).source).toBe('myfcd');
    } finally {
      food.source = 'catalogue';
    }
  });

  it('uses the catalogue unit for a dish without chips', () => {
    expect(byId('ayam-goreng-tray')?.variants).toHaveLength(1);
    expect(dishEstimate(statFor(catalogueItem('ayam-goreng-tray')), ctx())).toMatchObject({ kcal: 280, portion: 'a piece' });
  });

  it('is Place default, kept at that Place, for a Place-scoped correction', () => {
    const own = personal({
      id: 'p-rice',
      scope: 'place',
      placeId: 'nk',
      name: 'Rice (nasi kandar)',
      catalogueId: 'rice-nasi-kandar',
      selectedVariant: 2,
      unitMacros: byId('rice-nasi-kandar')?.variants[2]?.macros ?? macros(430),
    });
    const estimate = dishEstimate(statFor(catalogueItem('rice-nasi-kandar'), { placeId: 'nk' }), ctx([own]));
    expect(estimate).toMatchObject({ source: 'placeDefault', scope: 'place', placeId: 'nk', kcal: 430, portion: 'Mamak big' });
  });

  it('is Place default for a Place’s learned portion alone', () => {
    const estimate = dishEstimate(statFor(catalogueItem('rice-nasi-kandar', 1), { placeId: 'nk' }), ctx());
    expect(estimate).toMatchObject({ source: 'placeDefault', scope: 'place', placeId: 'nk', kcal: 430, portion: 'Mamak big' });
  });

  it('is Your correction, kept for the dish, for a dish-scoped correction', () => {
    const own = personal({
      id: 'p-teh',
      scope: 'dish',
      name: 'Teh o ais',
      catalogueId: 'teh-o-ais',
      selectedVariant: 1,
      unitMacros: byId('teh-o-ais')?.variants[1]?.macros ?? macros(60),
    });
    const estimate = dishEstimate(statFor(catalogueItem('teh-o-ais')), ctx([own]));
    expect(estimate).toMatchObject({ source: 'yourCorrection', scope: 'dish', kcal: 60, portion: 'Kurang' });
  });

  it('prefers the Place correction over the dish one, and the dish one over the Place’s learned portion', () => {
    const dishOwn = personal({ id: 'd', scope: 'dish', name: 'Rice', catalogueId: 'rice-nasi-kandar', selectedVariant: 0, unitMacros: macros(250) });
    const placeOwn = personal({ id: 'p', scope: 'place', placeId: 'nk', name: 'Rice', catalogueId: 'rice-nasi-kandar', selectedVariant: 1, unitMacros: macros(330) });
    const stat = statFor(catalogueItem('rice-nasi-kandar'), { placeId: 'nk' });
    expect(dishEstimate(stat, ctx([dishOwn, placeOwn]))).toMatchObject({ source: 'placeDefault', scope: 'place', kcal: 330 });
    expect(dishEstimate(stat, ctx([dishOwn]))).toMatchObject({ source: 'yourCorrection', scope: 'dish', kcal: 250 });
  });

  it('ignores everything learned at a Place for a dish that has no Place', () => {
    const placeOwn = personal({ id: 'p', scope: 'place', placeId: 'nk', name: 'Rice', catalogueId: 'rice-nasi-kandar', selectedVariant: 2, unitMacros: macros(430) });
    const estimate = dishEstimate(statFor(catalogueItem('rice-nasi-kandar', 1)), ctx([placeOwn]));
    expect(estimate).toMatchObject({ source: 'catalogue', scope: 'dish', kcal: 330, portion: 'Normal' });
  });

  it('shows an AI guess as logged, with its chips', () => {
    const variants = guessVariants(guessMacrosFor(300));
    const guess = typed('Nasi kerabu', 300, {
      source: 'aiGuess',
      uncertainty: GUESS_UNCERTAINTY,
      variants,
      selectedVariant: GUESS_NORMAL_INDEX,
      quantity: 2,
      question: 'Roughly how big was it?',
    });
    const estimate = dishEstimate(statFor(guess), ctx());
    expect(estimate).toMatchObject({ source: 'aiGuess', scope: 'dish', kcal: 300 });
    expect(estimate.item.quantity).toBe(1);
    expect(estimate.item.id).toBe('name:nasi kerabu');
    expect(estimate.portion).toBe(variants[GUESS_NORMAL_INDEX]?.label);
  });

  it('is a typed value as Your correction, with 1 portion', () => {
    const estimate = dishEstimate(statFor(typed('Mum’s sambal', 180)), ctx());
    expect(estimate).toMatchObject({ source: 'yourCorrection', scope: 'dish', kcal: 180, portion: '1 portion' });
  });

  it('finds a correction saved for a dish the catalogue lacks, by name, Place first', () => {
    const dishOwn = personal({ id: 'd', scope: 'dish', name: 'Nasi  Kerabu', unitMacros: macros(480) });
    const placeOwn = personal({ id: 'p', scope: 'place', placeId: 'nk', name: 'nasi kerabu', unitMacros: macros(520) });
    const stat = statFor(typed('Nasi kerabu', 300, { source: 'aiGuess' }));
    expect(dishEstimate(stat, ctx([dishOwn]))).toMatchObject({ source: 'yourCorrection', scope: 'dish', kcal: 480 });
    expect(dishEstimate({ ...stat, placeId: 'nk' }, ctx([dishOwn, placeOwn]))).toMatchObject({ source: 'placeDefault', scope: 'place', placeId: 'nk', kcal: 520 });
    // The Place correction is not looked at without the Place.
    expect(dishEstimate(stat, ctx([placeOwn]))).toMatchObject({ source: 'aiGuess', kcal: 300 });
  });

  it('treats a catalogue id that has gone as a typed dish, using the logged snapshot', () => {
    const gone = typed('Old dish', 410, { catalogueId: 'removed-dish', source: 'myfcd' });
    const stat = statFor(gone, { name: 'Old dish' });
    expect(byId('removed-dish')).toBeUndefined();
    expect(dishEstimate(stat, ctx())).toMatchObject({ source: 'myfcd', scope: 'dish', kcal: 410 });
    const saved = personal({ id: 's', scope: 'dish', name: 'Old dish', catalogueId: 'removed-dish', unitMacros: macros(330) });
    expect(dishEstimate(stat, ctx([saved]))).toMatchObject({ source: 'yourCorrection', kcal: 330 });
  });
});

describe('planDishAnswer', () => {
  function estimateOf(item: MealItem, source: DishSource = 'catalogue', extra: Partial<DishEstimate> = {}): DishEstimate {
    return { item, source, scope: 'dish', kcal: item.unitMacros.kcal, portion: '1 portion', ...extra };
  }
  const rice = (variant: number): MealItem => catalogueItem('rice-economy', variant);

  it('resizes counted portions instead of doubling them ("1 piece" never becomes "2 pieces")', () => {
    const roti = catalogueItem('roti-canai-dhal', 0);
    expect(roti.variants?.map((v) => [v.label, v.macros.kcal])).toEqual([['1 piece', 360], ['2 pieces', 720]]);

    const more = planDishAnswer(estimateOf(roti), 'more');
    expect(more).toMatchObject({ kind: 'scale', fromKcal: 360, toKcal: 450 });
    expect(more.item?.selectedVariant).toBe(0);
    // Two pieces stay two of the bigger piece.
    expect(more.item?.variants?.map((v) => [v.label, v.macros.kcal])).toEqual([['1 piece', 450], ['2 pieces', 900]]);

    const less = planDishAnswer(estimateOf(roti), 'less');
    expect(less).toMatchObject({ kind: 'scale', fromKcal: 360, toKcal: 290 });
    expect(less.item?.variants?.map((v) => v.macros.kcal)).toEqual([290, 575]);
  });

  describe('Looks right', () => {
    it('changes nothing on a catalogue dish', () => {
      expect(planDishAnswer(estimateOf(rice(1)), 'right')).toEqual({ kind: 'none', fromKcal: 200, toKcal: 200 });
    });

    it('changes nothing on a Place default or a correction of yours', () => {
      expect(planDishAnswer(estimateOf(rice(1), 'placeDefault'), 'right').kind).toBe('none');
      expect(planDishAnswer(estimateOf(rice(1), 'yourCorrection'), 'right').kind).toBe('none');
      expect(planDishAnswer(estimateOf(rice(1), 'myfcd'), 'right').item).toBeUndefined();
    });

    it('makes an AI guess your own value, with the range tightened to ±20%', () => {
      const guess = typed('Nasi kerabu', 300, { source: 'aiGuess', uncertainty: GUESS_UNCERTAINTY });
      const plan = planDishAnswer(estimateOf(guess, 'aiGuess'), 'right');
      expect(plan).toMatchObject({ kind: 'confirm', fromKcal: 300, toKcal: 300 });
      expect(plan.item?.uncertainty).toBe(CHECKED_UNCERTAINTY);
      expect(plan.item?.unitMacros.kcal).toBe(300);
      expect(guess.uncertainty).toBe(GUESS_UNCERTAINTY);
    });

    it('never widens a range that is already tighter', () => {
      const guess = typed('Teh', 100, { source: 'aiGuess', uncertainty: 0.1 });
      expect(planDishAnswer(estimateOf(guess, 'aiGuess'), 'right').item?.uncertainty).toBe(0.1);
    });
  });

  describe('Usually more and less with chips', () => {
    it('takes the next chip up and the one below (Rice: Half 100, 1 scoop 200, 1.5 scoops 300)', () => {
      const more = planDishAnswer(estimateOf(rice(1)), 'more');
      expect(more).toMatchObject({ kind: 'variant', fromKcal: 200, toKcal: 300 });
      expect(more.item).toMatchObject({ selectedVariant: 2, unitMacros: { kcal: 300 } });
      expect(more.item?.variants).toHaveLength(3);

      const less = planDishAnswer(estimateOf(rice(1)), 'less');
      expect(less).toMatchObject({ kind: 'variant', fromKcal: 200, toKcal: 100 });
      expect(less.item).toMatchObject({ selectedVariant: 0, unitMacros: { kcal: 100 } });
    });

    it('scales the chip in use when the top chip is already the one (1.5 scoops: more → 375)', () => {
      const more = planDishAnswer(estimateOf(rice(2)), 'more');
      expect(more).toMatchObject({ kind: 'scale', fromKcal: 300, toKcal: 375 });
      expect(more.item?.unitMacros.kcal).toBe(375);
      expect(more.item?.selectedVariant).toBe(2);
      expect(more.item?.variants?.[2]?.macros.kcal).toBe(375);
      // The other chips stay as they were.
      expect(more.item?.variants?.[0]?.macros.kcal).toBe(100);
      expect(more.item?.variants?.[1]?.macros.kcal).toBe(200);
    });

    it('scales down at the lowest chip', () => {
      const less = planDishAnswer(estimateOf(rice(0)), 'less');
      expect(less).toMatchObject({ kind: 'scale', fromKcal: 100, toKcal: 80 });
      expect(less.item?.variants?.[0]?.macros.kcal).toBe(80);
    });

    it('Nasi kandar rice at Mamak big 430: more → scale 540, less → Normal 330', () => {
      const big = catalogueItem('rice-nasi-kandar', 2);
      const more = planDishAnswer(estimateOf(big), 'more');
      expect(more).toMatchObject({ kind: 'scale', fromKcal: 430, toKcal: 540 });
      expect(more.item?.variants?.[2]?.macros.kcal).toBe(540);
      expect(more.item?.unitMacros.kcal).toBe(540);
      const less = planDishAnswer(estimateOf(big), 'less');
      expect(less).toMatchObject({ kind: 'variant', toKcal: 330 });
      expect(less.item?.selectedVariant).toBe(1);
    });

    it('goes by kcal when the chips are not in order (Big 430, Small 250, Normal 330 at Small)', () => {
      const chips: Variant[] = [
        { id: 'big', label: 'Big', macros: macros(430) },
        { id: 'small', label: 'Small', macros: macros(250) },
        { id: 'normal', label: 'Normal', macros: macros(330) },
      ];
      const item = typed('Odd order', 250, { variants: chips, selectedVariant: 1 });
      const more = planDishAnswer(estimateOf(item), 'more');
      expect(more).toMatchObject({ kind: 'variant', toKcal: 330 });
      expect(more.item?.selectedVariant).toBe(2);
      const less = planDishAnswer(estimateOf(item), 'less');
      expect(less).toMatchObject({ kind: 'scale', fromKcal: 250, toKcal: 200 });
      expect(less.item?.variants?.[1]?.macros.kcal).toBe(200);
    });

    it('does not change the item it was given', () => {
      const item = rice(2);
      const before = JSON.stringify(item);
      planDishAnswer(estimateOf(item), 'more');
      planDishAnswer(estimateOf(item), 'less');
      expect(JSON.stringify(item)).toBe(before);
    });
  });

  describe('Usually more and less without chips', () => {
    const rotiDhal = typed('Roti canai + dhal', 360);

    it('scales ×1.25 and ×0.8, kcal to the nearest 5', () => {
      expect(planDishAnswer(estimateOf(rotiDhal), 'more')).toMatchObject({ kind: 'scale', fromKcal: 360, toKcal: 450 });
      // 288 rounds to 290.
      expect(planDishAnswer(estimateOf(rotiDhal), 'less')).toMatchObject({ kind: 'scale', fromKcal: 360, toKcal: 290 });
    });

    it('rounds grams to 0.1 and keeps the rest of the item', () => {
      const item = typed('Roti', 360, { unitMacros: { kcal: 360, proteinG: 9.3, carbsG: 44.7, fatG: 17.1 } });
      expect(planDishAnswer(estimateOf(item), 'more').item?.unitMacros).toEqual({ kcal: 450, proteinG: 11.6, carbsG: 55.9, fatG: 21.4 });
      expect(planDishAnswer(estimateOf(item), 'more').item).toMatchObject({ name: 'Roti', quantity: 1, uncertainty: 0.15 });
    });

    it('never goes under 5 kcal', () => {
      expect(planDishAnswer(estimateOf(typed('Air', 5)), 'less').item?.unitMacros.kcal).toBe(5);
    });

    it('drops a lone chip, so the remembered item carries no variants', () => {
      const lone = typed('Karipap', 150, { variants: [{ id: 'one', label: '1 piece', macros: macros(150) }], selectedVariant: 0 });
      const plan = planDishAnswer(estimateOf(lone), 'more');
      expect(plan).toMatchObject({ kind: 'scale', toKcal: 190 });
      expect(plan.item?.variants).toBeUndefined();
      expect(plan.item?.selectedVariant).toBeUndefined();
    });
  });

  describe('on an AI guess', () => {
    const variants = guessVariants(guessMacrosFor(300));
    const guess = typed('Nasi kerabu', 300, { source: 'aiGuess', uncertainty: GUESS_UNCERTAINTY, variants, selectedVariant: GUESS_NORMAL_INDEX });

    it('steps the guess’s own chips and tightens the range', () => {
      const plan = planDishAnswer(estimateOf(guess, 'aiGuess'), 'more');
      expect(plan.kind).toBe('variant');
      expect(plan.toKcal).toBeGreaterThan(300);
      expect(plan.item?.uncertainty).toBe(CHECKED_UNCERTAINTY);
    });

    it('tightens the range when it has to scale too', () => {
      const plan = planDishAnswer(estimateOf(typed('Plain', 200, { source: 'aiGuess', uncertainty: GUESS_UNCERTAINTY }), 'aiGuess'), 'less');
      expect(plan).toMatchObject({ kind: 'scale', toKcal: 160 });
      expect(plan.item?.uncertainty).toBe(CHECKED_UNCERTAINTY);
    });

    it('keeps the catalogue range on a catalogue dish', () => {
      expect(planDishAnswer(estimateOf(rice(1)), 'more').item?.uncertainty).toBe(0.15);
    });
  });
});
