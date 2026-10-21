import { normaliseName } from '@/data/catalogue';
import { mealMacros } from './meal';
import type { MealItem, MealLog, Variant } from './types';
import {
  OFTEN_ITEMS,
  OFTEN_MIN_COUNT,
  OFTEN_PLACES,
  SEARCH_QUERY_MAX,
  buildMealIndex,
  groupByDay,
  indexMeal,
  isEmptyQuery,
  matchNote,
  matchesQuery,
  normaliseForSearch,
  oftenLogged,
  parseQuery,
  searchMeals,
  sortNewestFirst,
  type MealSearchEntry,
} from './search';

let itemCount = 0;

function variant(label: string, kcal = 100): Variant {
  return { id: label.toLowerCase().replaceAll(' ', '-'), label, macros: { kcal, proteinG: 0, carbsG: 0, fatG: 0 } };
}

function item(name: string, over: Partial<MealItem> = {}): MealItem {
  itemCount += 1;
  return {
    id: `item-${itemCount}`,
    name,
    unitMacros: { kcal: 200, proteinG: 0, carbsG: 0, fatG: 0 },
    quantity: 1,
    uncertainty: 0.15,
    source: 'catalogue',
    ...over,
  };
}

/** An item with a portion chip chosen. */
function chip(name: string, label: string, over: Partial<MealItem> = {}): MealItem {
  return item(name, { variants: [variant('Other'), variant(label)], selectedVariant: 1, ...over });
}

function meal(id: string, day: string, over: Partial<MealLog> = {}): MealLog {
  return {
    id,
    eatenAt: `${day}T04:00:00.000Z`,
    logicalDay: day,
    slot: 'lunch',
    name: id,
    items: [item('Dish')],
    method: 'text',
    finished: 'all',
    createdAt: `${day}T04:00:00.000Z`,
    updatedAt: `${day}T04:00:00.000Z`,
    syncState: 'local',
    ...over,
  };
}

const DAY = '2026-10-14';

/** The meals the matching tests search, indexed on their own. */
const SAMPLES = {
  tehTarik: indexMeal(meal('m-teh', DAY, { name: 'Teh tarik', items: [item('Teh tarik')] })),
  rice: indexMeal(
    meal('m-rice', DAY, {
      name: 'Economy rice',
      items: [item('Rice', { catalogueId: 'rice-economy' }), item('Ayam masak merah'), item('Kangkung belacan')],
    }),
    'Kedai near home',
  ),
  kandar: indexMeal(
    meal('m-kandar', DAY, {
      name: 'Nasi kandar ayam goreng',
      slot: 'dinner',
      items: [chip('Nasi kandar rice', 'Mamak big'), item('Ayam goreng'), chip('Kuah campur', 'Banjir')],
    }),
    'Nasi kandar near home',
  ),
  typed: indexMeal(meal('m-typed', DAY, { name: 'Breakfast out', text: 'roti canai, teh tarik', items: [item('Roti canai + dhal')] })),
  placeOnly: indexMeal(meal('m-place', DAY, { name: 'Mixed plate', items: [item('Rice')] }), 'Medan selera nearby'),
  tehOAis: indexMeal(meal('m-teh-o', DAY, { name: 'Teh o ais', items: [chip('Teh o ais', 'Kurang', { catalogueId: 'teh-o-ais' })] })),
  kopiOAis: indexMeal(meal('m-kopi', DAY, { name: 'Kopi o ais', items: [item('Kopi o ais')] })),
  rotiCanai: indexMeal(meal('m-roti', DAY, { name: 'Roti canai', items: [item('Roti canai')] })),
  roticanai: indexMeal(meal('m-roticanai', DAY, { name: 'Roticanai', items: [item('Roticanai')] })),
  nasiLemak: indexMeal(meal('m-lemak', DAY, { name: 'Nasi lemak bungkus', items: [item('Nasi lemak bungkus')] })),
  accents: indexMeal(meal('m-accents', DAY, { name: 'Café Éclair', items: [item('Éclair')] })),
  ab: indexMeal(meal('m-ab', DAY, { name: 'Ab', items: [item('Ab')] })),
  abcd: indexMeal(meal('m-abcd', DAY, { name: 'Abcd', items: [item('Abcd')] })),
  cjk: indexMeal(meal('m-cjk', DAY, { name: '叉烧饭', items: [item('叉烧饭')] })),
  plainKandar: indexMeal(meal('m-plain-kandar', DAY, { name: 'Nasi kandar', items: [item('Nasi kandar')] }), 'Nasi kandar near home'),
  rotiKaya: indexMeal(meal('m-kaya', DAY, { name: 'Roti kaya mamak', items: [item('Roti kaya mamak')] })),
} satisfies Record<string, MealSearchEntry>;

type SampleKey = keyof typeof SAMPLES;

describe('normaliseForSearch', () => {
  it('lowercases, drops accents and apostrophes, reads & as and, and folds punctuation to one space', () => {
    expect(normaliseForSearch('Teh-O  Ais')).toBe('teh o ais');
    expect(normaliseForSearch('Café')).toBe('cafe');
    expect(normaliseForSearch('téh tarík')).toBe('teh tarik');
    expect(normaliseForSearch("Mum's")).toBe('mums');
    expect(normaliseForSearch('Mum’s')).toBe('mums');
    expect(normaliseForSearch('F&N')).toBe('f and n');
    expect(normaliseForSearch('  !! ')).toBe('');
    expect(normaliseForSearch('')).toBe('');
  });

  it('keeps non-Latin letters, which normaliseName drops', () => {
    expect(normaliseForSearch('叉烧饭')).toBe('叉烧饭');
    expect(normaliseForSearch('叉烧饭 + teh')).toBe('叉烧饭 teh');
    expect(normaliseName('叉烧饭')).toBe('');
  });

  it.each(['Teh-O  Ais', 'F&N', "Mum's", 'Roti canai + teh tarik', 'Nasi lemak (bungkus)', 'Café au lait', 'Ayam 2 pieces', 'Kopi O, peng!'])(
    'is the same as normaliseName for ASCII-based input: %s',
    (text) => {
      expect(normaliseForSearch(text)).toBe(normaliseName(text));
    },
  );
});

describe('parseQuery', () => {
  it('splits into distinct normalised words and keeps them run together', () => {
    expect(parseQuery('Teh  Tarik!')).toEqual({ tokens: ['teh', 'tarik'], flat: 'tehtarik' });
    expect(parseQuery('teh teh')).toEqual({ tokens: ['teh'], flat: 'teh' });
    expect(parseQuery('téh-tarík')).toEqual({ tokens: ['teh', 'tarik'], flat: 'tehtarik' });
  });

  it('is empty for nothing, spaces or punctuation', () => {
    for (const raw of ['', '   ', '!!', ' ? ! ']) {
      const q = parseQuery(raw);
      expect(q.tokens).toEqual([]);
      expect(isEmptyQuery(q)).toBe(true);
    }
    expect(isEmptyQuery(parseQuery('teh'))).toBe(false);
  });

  it('clips a long input to 80 characters before parsing', () => {
    expect(SEARCH_QUERY_MAX).toBe(80);
    const q = parseQuery(`${'a'.repeat(78)} bbbb`);
    expect(q.tokens).toEqual(['a'.repeat(78), 'b']);
    expect(parseQuery('x'.repeat(200)).flat).toHaveLength(80);
  });
});

describe('indexMeal', () => {
  it('has the kcal the Diary shows, with how much was finished', () => {
    const full = meal('a', DAY, { items: [item('A', { quantity: 2 }), item('B')] });
    const half = { ...full, finished: 'half' as const };
    expect(indexMeal(full).kcal).toBe(mealMacros(full).kcal);
    expect(indexMeal(full).kcal).toBe(600);
    expect(indexMeal(half).kcal).toBe(mealMacros(half).kcal);
    expect(indexMeal(half).kcal).toBe(300);
    expect(indexMeal(half).finished).toBe('half');
  });

  it('collects everything a meal can be found by', () => {
    const entry = indexMeal(
      meal('a', DAY, {
        name: 'Lunch at the stall',
        text: 'Kari ayam & rice',
        items: [chip('Nasi kandar rice', 'Mamak big'), item('Teh o ais', { catalogueId: 'teh-o-ais' })],
      }),
      'Medan selera nearby',
    );
    for (const part of ['lunch at the stall', 'nasi kandar rice', 'mamak big', 'teh o ais', 'kari ayam and rice', 'medan selera nearby', 'teh o peng']) {
      expect(entry.hay).toContain(part);
    }
    expect(entry.flat).not.toContain(' ');
    expect(entry.flat).toContain('mamakbig');
    expect(entry.nameNorm).toBe('lunch at the stall');
    expect(entry.textNorm).toBe('kari ayam and rice');
    expect(entry.placeNorm).toBe('medan selera nearby');
  });

  it('indexes each item by its saved name, portion label and catalogue aliases', () => {
    const entry = indexMeal(meal('a', DAY, { items: [chip('Teh o ais', 'Kurang', { catalogueId: 'teh-o-ais' }), item('Roti canai')] }));
    const [tea, roti] = entry.items;
    expect(tea).toMatchObject({ name: 'Teh o ais', variant: 'Kurang', catalogueId: 'teh-o-ais', nameNorm: 'teh o ais', variantNorm: 'kurang' });
    expect(tea?.norm).toContain('teh o ais kurang');
    expect(tea?.norm).toContain('teh o ice');
    expect(roti).toEqual({ name: 'Roti canai', nameNorm: 'roti canai', variantNorm: '', norm: 'roti canai' });
  });

  it('leaves out what a meal does not have', () => {
    const entry = indexMeal(meal('a', DAY, { name: 'Teh tarik', items: [item('Teh tarik')] }));
    for (const key of ['placeId', 'placeName', 'priceRm', 'photoId', 'text']) expect(entry).not.toHaveProperty(key);
    expect(entry.items[0]).not.toHaveProperty('variant');
    expect(entry.items[0]).not.toHaveProperty('catalogueId');
    expect(entry.isGuess).toBe(false);
    const full = indexMeal(meal('b', DAY, { placeId: 'p1', priceRm: 4.8, photoId: 'ph1', text: 'x', isGuess: true }), 'Home');
    expect(full).toMatchObject({ placeId: 'p1', placeName: 'Home', priceRm: 4.8, photoId: 'ph1', text: 'x', isGuess: true });
  });

  it('names a meal from its first item, then "Meal", when it has no name', () => {
    expect(indexMeal(meal('a', DAY, { name: '   ', items: [item('Karipap'), item('Teh')] })).name).toBe('Karipap');
    expect(indexMeal(meal('a', DAY, { name: '', items: [] })).name).toBe('Meal');
    expect(indexMeal(meal('a', DAY, { name: '  Teh tarik ' })).name).toBe('Teh tarik');
  });

  it('clips the typed text to 500 characters', () => {
    const entry = indexMeal(meal('a', DAY, { text: `${'a'.repeat(600)} zzzz` }));
    expect(entry.text).toHaveLength(500);
    expect(entry.hay).not.toContain('zzzz');
  });

  it('sorts on the parsed time, and 0 when it cannot be parsed', () => {
    expect(indexMeal(meal('a', DAY)).at).toBe(Date.parse(`${DAY}T04:00:00.000Z`));
    expect(indexMeal(meal('a', DAY, { eatenAt: 'later' })).at).toBe(0);
  });

  it('does not find an unknown catalogue id by anything but the saved name', () => {
    const entry = indexMeal(meal('a', DAY, { items: [item('Mystery dish', { catalogueId: 'not-in-the-catalogue' })] }));
    expect(entry.items[0]?.norm).toBe('mystery dish');
  });
});

describe('sortNewestFirst and buildMealIndex', () => {
  it('puts the newest logical day first and the latest meal first inside a day', () => {
    const index = buildMealIndex(
      [
        meal('old', '2026-10-01'),
        meal('late', '2026-10-05', { eatenAt: '2026-10-05T12:00:00.000Z' }),
        meal('early', '2026-10-05', { eatenAt: '2026-10-05T01:00:00.000Z' }),
        meal('new', '2026-10-09'),
      ],
      [],
    );
    expect(index.map((e) => e.id)).toEqual(['new', 'late', 'early', 'old']);
  });

  it('keeps a 1am supper with its own logical day, above that night\'s 11pm dinner and below the next day', () => {
    // 11pm MYT on 5 Oct is 15:00Z; 1am MYT on 6 Oct is 17:00Z the day before (still logical day 5 Oct).
    const index = buildMealIndex(
      [
        meal('dinner', '2026-10-05', { slot: 'dinner', eatenAt: '2026-10-05T15:00:00.000Z' }),
        meal('supper', '2026-10-05', { slot: 'supper', eatenAt: '2026-10-05T17:00:00.000Z' }),
        meal('next-day', '2026-10-06', { eatenAt: '2026-10-06T02:00:00.000Z' }),
      ],
      [],
    );
    expect(index.map((e) => e.id)).toEqual(['next-day', 'supper', 'dinner']);
    expect(groupByDay(index).map((g) => g.entries.map((e) => e.id))).toEqual([['next-day'], ['supper', 'dinner']]);
  });

  it('breaks ties by id and does not change the list it is given', () => {
    const entries = ['b', 'c', 'a'].map((id) => indexMeal(meal(id, DAY)));
    const before = entries.map((e) => e.id);
    expect(sortNewestFirst(entries).map((e) => e.id)).toEqual(['c', 'b', 'a']);
    expect(entries.map((e) => e.id)).toEqual(before);
  });

  it('names the Place of each meal, and leaves a missing or unknown Place without a name', () => {
    const index = buildMealIndex(
      [meal('here', '2026-10-03', { placeId: 'p1' }), meal('gone', '2026-10-02', { placeId: 'deleted' }), meal('nowhere', '2026-10-01')],
      [{ id: 'p1', name: 'Kedai near home' }],
    );
    expect(index.map((e) => e.placeName)).toEqual(['Kedai near home', undefined, undefined]);
    expect(index[1]).toMatchObject({ placeId: 'deleted' });
    expect(index[1]).not.toHaveProperty('placeName');
    expect(index[2]).not.toHaveProperty('placeId');
  });
});

describe('matchesQuery', () => {
  const cases: [query: string, sample: SampleKey, expected: boolean, why: string][] = [
    ['teh tarik', 'tehTarik', true, 'the meal name'],
    ['kangkung', 'rice', true, 'an item only (the name is Economy rice)'],
    ['roti canai', 'typed', true, 'the typed text'],
    ['teh tarik', 'typed', true, 'the typed text, second word'],
    ['medan', 'placeOnly', true, 'the Place only'],
    ['teh o peng', 'tehOAis', true, 'a catalogue alias'],
    ['teh o sejuk', 'tehOAis', true, 'another alias'],
    ['banjir', 'kandar', true, 'a portion label'],
    ['mamak big', 'kandar', true, 'a two-word portion label'],
    ['kurang', 'tehOAis', true, 'a portion label on a drink'],
    ['tehtarik', 'tehTarik', true, 'spacing: words run together'],
    ['nasilemak', 'nasiLemak', true, 'spacing: words run together, longer name'],
    ['roti canai', 'roticanai', true, 'spacing: the meal was typed without one'],
    ['tarik teh', 'tehTarik', true, 'any order'],
    ['TEH TARIK', 'tehTarik', true, 'capitals'],
    ['téh tarík', 'tehTarik', true, 'accents in the query'],
    ['cafe eclair', 'accents', true, 'accents in the meal'],
    ['teh-tarik', 'tehTarik', true, 'punctuation'],
    ['ayam kangkung', 'rice', true, 'words in different items'],
    ['ai', 'rotiCanai', false, 'two letters must start a word (canai)'],
    ['ai', 'tehOAis', true, 'two letters start a word (ais)'],
    ['o', 'tehOAis', true, 'one letter is a word'],
    ['o', 'tehTarik', false, 'one letter must start a word'],
    ['kopi o', 'kopiOAis', true, 'a short word with a long one'],
    ['a b', 'ab', false, 'two one-letter words never use the spacing rule'],
    ['ab cd', 'abcd', true, 'four letters run together do'],
    ['ikan', 'plainKandar', false, 'run together it would start inside "kandar" (nasikandar)'],
    ['ikan', 'kandar', false, 'not in the name, items or Place of a nasi kandar plate'],
    ['dara', 'kandar', false, 'not "kan-DAR-a" across kandar and ayam'],
    ['ayam', 'rotiKaya', false, 'not "k-AYA-M" across kaya and mamak'],
    ['ayamamak', 'rotiKaya', false, 'a run-together hit that starts inside a word'],
    ['kaya', 'rotiKaya', true, 'a word of the name'],
    ['rotikaya', 'rotiKaya', true, 'run together from the first word'],
    ['kayamamak', 'rotiKaya', true, 'run together from a later word, through the rest of the name'],
    ['tehtarik', 'typed', true, 'run together inside the typed text'],
    ['饭', 'cjk', true, 'a single non-Latin character is found anywhere'],
    ['叉烧饭', 'cjk', true, 'a non-Latin name'],
    ['nasi lemakk', 'nasiLemak', false, 'a typo'],
    ['nasi kandar', 'tehTarik', false, 'another meal'],
    ['kedai', 'rice', true, 'the Place of a meal with a name'],
    ['home', 'tehTarik', false, 'a meal without a Place'],
    ['', 'tehTarik', true, 'an empty query matches everything'],
    ['!!', 'rice', true, 'punctuation only is an empty query'],
  ];

  it.each(cases)('%j in %s is %s (%s)', (query, sample, expected) => {
    expect(matchesQuery(SAMPLES[sample], parseQuery(query))).toBe(expected);
  });
});

describe('searchMeals', () => {
  const index = buildMealIndex(
    [
      meal('home-breakfast', '2026-10-16', { slot: 'breakfast', name: 'Bread, kaya, kopi', placeId: 'home', items: [item('Bread'), item('Kopi')] }),
      meal('kandar-dinner', '2026-10-15', { slot: 'dinner', name: 'Nasi kandar ayam goreng', placeId: 'kandar', items: [item('Ayam goreng')] }),
      meal('home-dinner', '2026-10-14', { slot: 'dinner', name: 'Rice, ayam masak kicap', placeId: 'home', items: [item('Ayam masak kicap')] }),
      meal('stall-supper', '2026-10-13', { slot: 'supper', name: 'Roti canai', placeId: 'kandar', items: [item('Roti canai')] }),
      meal('no-place', '2026-10-12', { slot: 'snack', name: 'Karipap', items: [item('Karipap')] }),
    ],
    [
      { id: 'home', name: 'Home' },
      { id: 'kandar', name: 'Nasi kandar near home' },
    ],
  );
  const ids = (list: readonly MealSearchEntry[]) => list.map((e) => e.id);

  it('returns everything for no text and no filter', () => {
    expect(ids(searchMeals(index, parseQuery('')))).toEqual(ids(index));
    expect(ids(searchMeals(index, parseQuery('')))).toHaveLength(5);
  });

  it('filters by slot, with or without text', () => {
    expect(ids(searchMeals(index, parseQuery(''), { slot: 'dinner' }))).toEqual(['kandar-dinner', 'home-dinner']);
    expect(ids(searchMeals(index, parseQuery('ayam'), { slot: 'dinner' }))).toEqual(['kandar-dinner', 'home-dinner']);
    expect(ids(searchMeals(index, parseQuery('masak'), { slot: 'dinner' }))).toEqual(['home-dinner']);
    expect(ids(searchMeals(index, parseQuery('masak'), { slot: 'supper' }))).toEqual([]);
  });

  it('filters by Place id exactly, so Home leaves out "Nasi kandar near home"', () => {
    expect(ids(searchMeals(index, parseQuery(''), { placeId: 'home' }))).toEqual(['home-breakfast', 'home-dinner']);
    expect(ids(searchMeals(index, parseQuery(''), { placeId: 'kandar' }))).toEqual(['kandar-dinner', 'stall-supper']);
    // The word "home" finds both Places by name, which is why the exact filter exists.
    expect(ids(searchMeals(index, parseQuery('home')))).toEqual(['home-breakfast', 'kandar-dinner', 'home-dinner', 'stall-supper']);
    expect(ids(searchMeals(index, parseQuery(''), { placeId: 'unknown' }))).toEqual([]);
  });

  it('combines the text and both filters', () => {
    expect(ids(searchMeals(index, parseQuery('ayam'), { placeId: 'home', slot: 'dinner' }))).toEqual(['home-dinner']);
    expect(ids(searchMeals(index, parseQuery('ayam'), { placeId: 'home', slot: 'breakfast' }))).toEqual([]);
  });

  it('does not find a word that only exists where two words meet', () => {
    // "nasi kandar" run together holds "ikan"; neither word does.
    expect(ids(searchMeals(index, parseQuery('ikan')))).toEqual([]);
    expect(ids(searchMeals(index, parseQuery('nasikandar')))).toEqual(['kandar-dinner', 'stall-supper']);
  });

  it('keeps the order of the index', () => {
    expect(ids(searchMeals(index, parseQuery('kandar')))).toEqual(['kandar-dinner', 'stall-supper']);
    expect(ids(searchMeals(index, parseQuery('ayam')))).toEqual(['kandar-dinner', 'home-dinner']);
  });
});

describe('matchNote', () => {
  const note = (sample: SampleKey, query: string) => matchNote(SAMPLES[sample], parseQuery(query));

  it('says nothing when the name shows the match', () => {
    expect(note('tehTarik', 'teh tarik')).toBeUndefined();
    expect(note('tehTarik', 'tehtarik')).toBeUndefined();
    expect(note('nasiLemak', 'nasilemak')).toBeUndefined();
  });

  it('says nothing for an empty query', () => {
    expect(note('rice', '')).toBeUndefined();
    expect(note('rice', '!!')).toBeUndefined();
  });

  it('names the item an item-only match found', () => {
    expect(note('rice', 'kangkung')).toBe('Includes Kangkung belacan');
  });

  it('names the portion when the portion label matched, and only the item when its name did', () => {
    expect(note('kandar', 'banjir')).toBe('Includes Kuah campur banjir');
    expect(note('kandar', 'mamak')).toBe('Includes Nasi kandar rice mamak big');
    expect(note('kandar', 'kuah')).toBe('Includes Kuah campur');
    expect(note('rice', 'kangkung')).toBe('Includes Kangkung belacan');
    expect(note('tehOAis', 'peng')).toBe('Includes Teh o ais');
  });

  it('is found by the spacing-tolerant match too', () => {
    const entry = indexMeal(meal('a', DAY, { name: 'Breakfast', items: [item('Teh tarik')] }));
    expect(matchNote(entry, parseQuery('tehtarik'))).toBe('Includes Teh tarik');
  });

  it('does not explain a match that only exists across two words', () => {
    const plate = indexMeal(meal('a', DAY, { name: 'Breakfast', items: [item('Nasi kandar')], text: 'nasi kandar' }));
    expect(matchNote(plate, parseQuery('ikan'))).toBeUndefined();
    expect(matchesQuery(plate, parseQuery('ikan'))).toBe(false);
    const toast = indexMeal(meal('b', DAY, { name: 'Breakfast', items: [item('Roti kaya mamak')] }));
    expect(matchNote(toast, parseQuery('ayam'))).toBeUndefined();
    expect(matchNote(toast, parseQuery('kaya'))).toBe('Includes Roti kaya mamak');
  });

  it('finds words run together from the start of a later word', () => {
    const entry = indexMeal(meal('a', DAY, { name: 'Breakfast', items: [item('Kopi teh tarik')] }));
    expect(matchNote(entry, parseQuery('tehtarik'))).toBe('Includes Kopi teh tarik');
  });

  it('lists up to two items, then counts the rest', () => {
    const lunch = (names: string[]) => indexMeal(meal('a', DAY, { name: 'Lunch', items: names.map((n) => item(n)) }));
    expect(matchNote(lunch(['Ayam goreng', 'Kubis']), parseQuery('ayam'))).toBe('Includes Ayam goreng');
    expect(matchNote(lunch(['Ayam goreng', 'Ayam masak merah']), parseQuery('ayam'))).toBe('Includes Ayam goreng, Ayam masak merah');
    expect(matchNote(lunch(['Ayam A', 'Ayam B', 'Ayam C']), parseQuery('ayam'))).toBe('Includes Ayam A, Ayam B and 1 more');
    expect(matchNote(lunch(['Ayam A', 'Ayam B', 'Ayam C', 'Ayam D']), parseQuery('ayam'))).toBe('Includes Ayam A, Ayam B and 2 more');
  });

  it('collapses the same item listed twice', () => {
    const entry = indexMeal(meal('a', DAY, { name: 'Lunch', items: [item('Telur dadar'), item('Telur dadar'), item('Telur dadar')] }));
    expect(matchNote(entry, parseQuery('telur'))).toBe('Includes Telur dadar');
  });

  it('quotes what you typed when only the typed text matched, clipped past 40 characters', () => {
    // The typed text only counts when no item says it.
    expect(note('typed', 'roti')).toBe('Includes Roti canai + dhal');
    expect(note('typed', 'tarik')).toBe('You typed “roti canai, teh tarik”');
    const onlyText = indexMeal(meal('a', DAY, { name: 'Sarapan', text: 'roti canai, teh tarik', items: [item('Dish')] }));
    expect(matchNote(onlyText, parseQuery('tarik'))).toBe('You typed “roti canai, teh tarik”');
    const long = indexMeal(meal('b', DAY, { name: 'Sarapan', text: `teh tarik ${'x'.repeat(60)}`, items: [item('Dish')] }));
    const noteText = matchNote(long, parseQuery('tarik'));
    expect(noteText).toBe(`You typed “teh tarik ${'x'.repeat(29)}…”`);
  });

  it('says nothing for a Place-only match, which the meta line already shows', () => {
    expect(note('placeOnly', 'medan')).toBeUndefined();
  });
});

describe('groupByDay', () => {
  it('groups contiguous entries by logical day, in order', () => {
    const index = buildMealIndex(
      [meal('a', '2026-10-16'), meal('b', '2026-10-16', { eatenAt: '2026-10-16T08:00:00.000Z' }), meal('c', '2026-10-15'), meal('d', '2026-10-13')],
      [],
    );
    const groups = groupByDay(index);
    expect(groups.map((g) => g.day)).toEqual(['2026-10-16', '2026-10-15', '2026-10-13']);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([['b', 'a'], ['c'], ['d']]);
  });

  it('is empty for no entries', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('oftenLogged', () => {
  /** A meal `n` days before 20 Oct, newest first once indexed. */
  let seq = 0;
  function logged(items: MealItem[], over: Partial<MealLog> = {}, placeName?: string): MealSearchEntry {
    seq += 1;
    const day = `2026-09-${String(30 - seq).padStart(2, '0')}`;
    return indexMeal(meal(`often-${seq}`, day, { name: 'Meal', items, ...over }), placeName);
  }
  const index = (entries: MealSearchEntry[]) => sortNewestFirst(entries);

  beforeEach(() => {
    seq = 0;
  });

  it('has the defaults the idle state shows', () => {
    expect([OFTEN_ITEMS, OFTEN_PLACES, OFTEN_MIN_COUNT]).toEqual([6, 3, 2]);
  });

  it('counts a meal once per item, even when the item is listed twice', () => {
    const result = oftenLogged(index([logged([item('Telur'), item('Telur')]), logged([item('Telur')])]), { minCount: 3 });
    expect(result.items).toEqual([]);
    expect(oftenLogged(index([logged([item('Telur'), item('Telur')]), logged([item('Telur')])])).items).toEqual([{ label: 'Telur', count: 2 }]);
  });

  it('leaves out check-in guesses', () => {
    const result = oftenLogged(index([logged([item('Karipap')], { isGuess: true }), logged([item('Karipap')], { isGuess: true }), logged([item('Karipap')])]));
    expect(result.items).toEqual([]);
  });

  it('leaves out rice and gravy, which are on every plate', () => {
    const plate = () => logged([item('Rice', { catalogueId: 'rice-economy' }), item('Kuah campur', { catalogueId: 'kuah-campur' }), item('Telur dadar')]);
    expect(oftenLogged(index([plate(), plate(), plate()])).items).toEqual([{ label: 'Telur dadar', count: 3 }]);
  });

  it('merges two catalogue ids with the same name into one', () => {
    const result = oftenLogged(
      index([logged([item('Ayam goreng', { catalogueId: 'ayam-goreng-tray' })]), logged([item('Ayam goreng', { catalogueId: 'ayam-goreng-mamak' })])]),
    );
    expect(result.items).toEqual([{ label: 'Ayam goreng', count: 2 }]);
  });

  it('drops anything logged once and sorts by count, with ties going to the most recent', () => {
    const entries = [
      logged([item('Once')]),
      logged([item('Roti canai')]),
      logged([item('Teh tarik')]),
      logged([item('Teh tarik'), item('Roti canai')]),
      logged([item('Teh tarik')]),
      logged([item('Karipap')]),
      logged([item('Karipap')]),
    ];
    const result = oftenLogged(index(entries));
    // Entries were created newest first (seq 1 is the newest day).
    expect(result.items.map((s) => `${s.label}:${s.count}`)).toEqual(['Teh tarik:3', 'Roti canai:2', 'Karipap:2']);
  });

  it('shows at most six items and three Places, and fewer when there are fewer', () => {
    const names = ['A one', 'B two', 'C three', 'D four', 'E five', 'F six', 'G seven', 'H eight'];
    const entries = names.flatMap((n, i) => [0, 1].map(() => logged([item(n)], { placeId: `p${i}` }, `Place ${i}`)));
    const result = oftenLogged(index(entries));
    expect(result.items).toHaveLength(6);
    expect(result.places).toHaveLength(3);
    const narrow = oftenLogged(index(entries), { items: 2, places: 1 });
    expect(narrow.items).toHaveLength(2);
    expect(narrow.places).toHaveLength(1);

    const few = oftenLogged(index([logged([item('Telur')]), logged([item('Telur')])]));
    expect(few.items).toHaveLength(1);
    expect(few.places).toEqual([]);
  });

  it('counts Places by id, with the Place id on each suggestion', () => {
    const entries = [
      logged([item('A')], { placeId: 'home' }, 'Home'),
      logged([item('B')], { placeId: 'kandar' }, 'Nasi kandar near home'),
      logged([item('C')], { placeId: 'home' }, 'Home'),
      logged([item('D')], { placeId: 'kandar' }, 'Nasi kandar near home'),
      logged([item('E')], { placeId: 'home' }, 'Home'),
      logged([item('F')], { placeId: 'kedai' }, 'Kedai near home'),
    ];
    expect(oftenLogged(index(entries)).places).toEqual([
      { label: 'Home', count: 3, placeId: 'home' },
      { label: 'Nasi kandar near home', count: 2, placeId: 'kandar' },
    ]);
  });

  it('is empty for an empty index', () => {
    expect(oftenLogged([])).toEqual({ items: [], places: [] });
  });
});
