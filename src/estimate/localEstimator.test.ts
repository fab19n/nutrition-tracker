import { byId } from '@/data/catalogue';
import { itemsRange } from '@/domain/meal';
import type { MealItem, PersonalItem, Place } from '@/domain/types';
import { createLocalEstimator, estimateLocally } from './localEstimator';
import type { EstimateContext, EstimateResult } from './types';

const SAMPLE = 'nasi kandar ayam goreng, kubis, kuah campur, teh o ais';
const AT = '2026-10-04T12:50:00.000Z';

function sequentialIds(): () => string {
  let n = 0;
  return () => `item-${(n += 1)}`;
}

function run(text: string, ctx: EstimateContext = { personal: [] }): EstimateResult {
  return estimateLocally({ text }, ctx, sequentialIds());
}

function kcalOf(item: MealItem): number {
  return item.unitMacros.kcal * item.quantity;
}

function chipOf(item: MealItem | undefined): string | undefined {
  return item?.variants?.[item.selectedVariant ?? -1]?.label;
}

function find(result: EstimateResult, catalogueId: string): MealItem {
  const item = result.items.find((i) => i.catalogueId === catalogueId);
  if (!item) throw new Error(`No ${catalogueId} in ${result.items.map((i) => i.name).join(', ')}`);
  return item;
}

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: 'place-nasi-kandar',
    name: 'Nasi kandar near home',
    type: 'mamak',
    defaultVariants: { 'rice-nasi-kandar': 2, 'kuah-campur': 2 },
    createdAt: AT,
    ...overrides,
  };
}

/** A saved correction, built the way the review screen saves one. */
function correction(catalogueId: string, label: string, scope: PersonalItem['scope'], placeId?: string): PersonalItem {
  const item = byId(catalogueId);
  const index = item?.variants.findIndex((v) => v.label === label) ?? -1;
  const variant = item?.variants[index];
  if (!item || !variant) throw new Error(`No ${label} chip on ${catalogueId}`);
  const personal: PersonalItem = {
    id: `personal-${catalogueId}-${scope}`,
    name: item.name,
    catalogueId,
    scope,
    variants: item.variants,
    selectedVariant: index,
    unitMacros: variant.macros,
    uncertainty: item.uncertainty,
    corrections: 2,
    createdAt: AT,
    updatedAt: AT,
  };
  if (placeId) personal.placeId = placeId;
  return personal;
}

describe('the design sample meal', () => {
  it('splits a nasi kandar order into five catalogue items with the expected range', () => {
    const result = run(SAMPLE);

    expect(result.method).toBe('local');
    expect(result.unmatched).toEqual([]);
    expect(result.items.map((i) => i.catalogueId)).toEqual([
      'rice-nasi-kandar',
      'ayam-goreng-mamak',
      'kubis',
      'kuah-campur',
      'teh-o-ais',
    ]);
    expect(result.items.map(kcalOf)).toEqual([330, 300, 70, 120, 110]);
    expect(result.items.every((i) => i.source === 'catalogue')).toBe(true);
    expect(itemsRange(result.items)).toEqual({ low: 790, high: 1070 });
  });

  it('asks the two questions that move the total most, on the items themselves', () => {
    const result = run(SAMPLE);
    const rice = find(result, 'rice-nasi-kandar');
    const kuah = find(result, 'kuah-campur');

    expect(result.questions).toEqual([
      { itemId: rice.id, question: 'How big was the rice?' },
      { itemId: kuah.id, question: 'Is there kuah under the rice?' },
    ]);
    expect(kuah.question).toBe('Is there kuah under the rice?');
    expect(find(result, 'teh-o-ais').question).toBeUndefined();
  });

  it('uses a dish-wide correction for teh o ais and stops asking about it', () => {
    const result = run(SAMPLE, { personal: [correction('teh-o-ais', 'Kurang', 'dish')] });
    const teh = find(result, 'teh-o-ais');

    expect(kcalOf(teh)).toBe(60);
    expect(chipOf(teh)).toBe('Kurang');
    expect(teh.source).toBe('yourCorrection');
    expect(result.questions.some((q) => q.itemId === teh.id)).toBe(false);
  });

  it("applies the Place's learned defaults: Mamak big rice and kuah banjir", () => {
    const result = run(SAMPLE, { place: place(), personal: [] });
    const rice = find(result, 'rice-nasi-kandar');
    const kuah = find(result, 'kuah-campur');

    expect([chipOf(rice), kcalOf(rice)]).toEqual(['Mamak big', 430]);
    expect([chipOf(kuah), kcalOf(kuah)]).toEqual(['Banjir', 220]);
    expect(rice.source).toBe('yourCorrection');
    expect(result.questions.map((q) => q.itemId)).toEqual([find(result, 'teh-o-ais').id]);
  });
});

describe('learned defaults order', () => {
  it('lets words in the text beat the Place default', () => {
    const rice = find(run('nasi kandar sikit, kuah campur', { place: place(), personal: [] }), 'rice-nasi-kandar');
    expect([chipOf(rice), kcalOf(rice), rice.source]).toEqual(['Small', 250, 'catalogue']);
  });

  it('prefers a correction saved for this Place over one saved for the dish', () => {
    const nasiKandar = place();
    const personal = [correction('teh-o-ais', 'Kurang', 'dish'), correction('teh-o-ais', 'Kosong', 'place', nasiKandar.id)];

    expect(chipOf(find(run('teh o ais', { place: nasiKandar, personal }), 'teh-o-ais'))).toBe('Kosong');
    expect(chipOf(find(run('teh o ais', { personal }), 'teh-o-ais'))).toBe('Kurang');
  });

  it('prefers a PersonalItem over the Place default for the same item', () => {
    const nasiKandar = place();
    const personal = [correction('rice-nasi-kandar', 'Normal', 'place', nasiKandar.id)];
    expect(chipOf(find(run('nasi kandar', { place: nasiKandar, personal }), 'rice-nasi-kandar'))).toBe('Normal');
  });

  it('matches your own items by the name you gave them', () => {
    const homeCurry: PersonalItem = {
      id: 'personal-mak-curry',
      name: "Mak's kari ayam",
      scope: 'dish',
      unitMacros: { kcal: 320, proteinG: 24, carbsG: 8, fatG: 21 },
      uncertainty: 0.2,
      corrections: 1,
      createdAt: AT,
      updatedAt: AT,
    };
    const [curry] = run('maks kari ayam', { personal: [homeCurry] }).items;
    expect(curry).toMatchObject({ name: "Mak's kari ayam", source: 'yourCorrection', unitMacros: { kcal: 320 } });
  });
});

describe('portion and sugar words', () => {
  it('reads "kurang manis" as Kurang', () => {
    const result = run('teh tarik kurang manis');
    expect(result.items).toHaveLength(1);
    expect([chipOf(result.items[0]), result.items[0]?.unitMacros.kcal]).toEqual(['Kurang', 140]);
    expect(result.questions).toEqual([]);
  });

  it('reads "roti canai 2 + teh o ais kosong" as two pieces and Kosong', () => {
    const result = run('roti canai 2 + teh o ais kosong');
    const roti = find(result, 'roti-canai');
    const teh = find(result, 'teh-o-ais');

    expect(kcalOf(roti)).toBe(600);
    expect(chipOf(roti) === '2 pieces' || roti.quantity === 2).toBe(true);
    expect([chipOf(teh), kcalOf(teh)]).toEqual(['Kosong', 5]);
  });

  it.each(['dua roti canai', 'roti canai x2', '2x roti canai', 'roti canai 2 pieces'])('reads "%s" as two pieces', (text) => {
    expect(kcalOf(find(run(text), 'roti-canai'))).toBe(600);
  });

  it('multiplies when there is no chip for the count', () => {
    const chicken = find(run('nasi kandar ayam goreng 3 ketul'), 'ayam-goreng-mamak');
    expect([chipOf(chicken), chicken.quantity, kcalOf(chicken)]).toEqual(['1 piece', 3, 900]);
  });

  it('keeps "mamak" in a dish name instead of reading it as a size', () => {
    const result = run('mee goreng mamak banjir');
    const mee = find(result, 'mee-goreng-mamak');

    expect(result.items).toHaveLength(1);
    expect(result.unmatched).toEqual([]);
    expect([chipOf(mee), kcalOf(mee)]).toEqual(['Normal', 830]);
    expect(result.questions).toEqual([{ itemId: mee.id, question: 'How big was the plate?' }]);
  });

  it('reads besar, mamak and big as the largest portion', () => {
    for (const text of ['nasi kandar besar', 'nasi kandar mamak', 'big nasi kandar']) {
      expect(chipOf(find(run(text), 'rice-nasi-kandar'))).toBe('Mamak big');
    }
  });

  it('switches a drink to its besar size and keeps the sugar word', () => {
    const result = run('teh o ais kosong besar');
    expect(result.items.map((i) => [i.catalogueId, chipOf(i)])).toEqual([['teh-o-ais-besar', 'Kosong']]);
  });

  it('matches "nasi lemak bungkus" as one item', () => {
    const result = run('nasi lemak bungkus');
    expect(result.items.map((i) => [i.catalogueId, kcalOf(i)])).toEqual([['nasi-lemak-bungkus', 490]]);
  });

  it('takes half a portion when there is no Half chip', () => {
    const nasiLemak = find(run('half nasi lemak'), 'nasi-lemak-bungkus');
    expect([nasiLemak.quantity, kcalOf(nasiLemak)]).toEqual([0.5, 245]);
    expect(chipOf(find(run('separuh murtabak'), 'murtabak'))).toBe('Half');
  });

  it('adds the kuah that "banjir" or "extra kuah" talks about', () => {
    for (const text of ['nasi kandar banjir, ayam goreng', 'nasi kandar extra kuah']) {
      expect(chipOf(find(run(text), 'kuah-campur'))).toBe('Banjir');
    }
  });

  it('reads ice requests as the iced drink without touching the sugar, and ignores spice requests', () => {
    expect(chipOf(find(run('teh tarik less ice'), 'teh-ais'))).toBe('Normal');
    expect(chipOf(find(run('teh o kurang ais'), 'teh-o-ais'))).toBe('Normal');
    expect(chipOf(find(run('teh o ais less ice'), 'teh-o-ais'))).toBe('Normal');
    const result = run('nasi goreng kampung tak pedas');
    expect([result.items.map((i) => i.catalogueId), result.unmatched]).toEqual([['nasi-goreng-kampung'], []]);
  });
});

describe('ambiguous names and typos', () => {
  it('reads plain rice and shared names by the kind of meal', () => {
    const result = run('nasi sikit, ayam goreng, kangkung');
    expect(result.items.map((i) => i.catalogueId)).toEqual(['rice-economy', 'ayam-goreng-tray', 'kangkung-belacan']);
    expect(chipOf(result.items[0])).toBe('Half');
  });

  it('reads plain rice and kuah by the Place type', () => {
    const kedai = place({ id: 'place-kedai', name: 'Kedai near home', type: 'economyRice', defaultVariants: {} });
    const result = run('nasi, ayam goreng, kuah banjir', { place: kedai, personal: [] });
    expect(result.items.map((i) => [i.catalogueId, chipOf(i)])).toEqual([
      ['rice-economy', '1 scoop'],
      ['ayam-goreng-tray', '1 piece'],
      ['kuah-on-rice', 'Banjir'],
    ]);
  });

  it('lets "nasi kandar" in the text outrank an economy-rice Place', () => {
    const kedai = place({ id: 'place-kedai', name: 'Kedai near home', type: 'economyRice', defaultVariants: {}, trays: ['ayam-goreng-tray'] });
    const result = run(SAMPLE, { place: kedai, personal: [] });
    expect(result.items.map((i) => i.catalogueId)).toEqual(['rice-nasi-kandar', 'ayam-goreng-mamak', 'kubis', 'kuah-campur', 'teh-o-ais']);
    expect(itemsRange(result.items)).toEqual({ low: 790, high: 1070 });
  });

  it('tolerates one-letter typos', () => {
    expect(run('nasi kandr ayam goreng').items.map((i) => i.catalogueId)).toEqual(['rice-nasi-kandar', 'ayam-goreng-mamak']);
    expect(run('teh tarek').items.map((i) => i.catalogueId)).toEqual(['teh-tarik']);
  });

  it('keeps soft separators inside names ("roti canai with dhal", "F&N")', () => {
    expect(run('roti canai with dhal and teh tarik').items.map((i) => i.catalogueId)).toEqual(['roti-canai-dhal', 'teh-tarik']);
    expect(run('F&N').items.map((i) => i.catalogueId)).toEqual(['soft-drink']);
  });
});

describe('unknown food', () => {
  it('turns "durian crepe" into one AI guess with a wide range and a size question', () => {
    const result = run('durian crepe');
    const [crepe] = result.items;

    expect(result.items).toHaveLength(1);
    expect(crepe).toMatchObject({ name: 'Durian crepe', source: 'aiGuess', uncertainty: 0.35 });
    expect(crepe?.catalogueId).toBeUndefined();
    expect(crepe?.variants?.map((v) => v.label)).toEqual(['Small', 'Normal', 'Big']);
    expect(chipOf(crepe)).toBe('Normal');
    expect(result.unmatched).toEqual(['durian crepe']);
    expect(result.questions).toEqual([{ itemId: crepe?.id, question: 'Roughly how big was it?' }]);
  });

  it('guesses 300 kcal when the words say nothing about the food', () => {
    const [item] = run('xyzzy').items;
    expect([item?.name, item?.unitMacros.kcal]).toEqual(['Xyzzy', 300]);
  });

  it('keeps a size word on a guessed dish and drops its question', () => {
    const result = run('2 durian crepe besar');
    expect([chipOf(result.items[0]), result.items[0]?.quantity, result.questions]).toEqual(['Big', 2, []]);
  });

  it('keeps recognised items next to unknown ones', () => {
    const result = run('chicken chop, teh o ais rm 4.50');
    expect(result.items.map((i) => [i.name, i.source])).toEqual([
      ['Chicken chop', 'aiGuess'],
      ['Teh o ais', 'catalogue'],
    ]);
    expect(result.unmatched).toEqual(['chicken chop']);
  });
});

describe('questions', () => {
  it('asks at most two, preferring the biggest swing', () => {
    const result = run('nasi kandar, mee goreng mamak, nasi goreng, teh tarik');
    expect(result.questions.map((q) => result.items.find((i) => i.id === q.itemId)?.catalogueId)).toEqual([
      'mee-goreng-mamak',
      'nasi-goreng',
    ]);
    expect(result.items.filter((i) => i.question)).toHaveLength(2);
  });

  it('asks about guessed dishes first and still caps at two', () => {
    const result = run('xyzzy, plugh, frobnicate, mee goreng mamak');
    expect(result.questions).toHaveLength(2);
    expect(result.questions.every((q) => q.question === 'Roughly how big was it?')).toBe(true);
  });

  it('skips items whose chips are less than 100 kcal apart', () => {
    expect(run('teh o').questions).toEqual([]);
  });
});

describe('odd input', () => {
  it.each(['', '   ', '!!!', ',,, + ... ;', '\n\n', '2', 'sikit', 'rm 12'])('returns nothing for %j', (text) => {
    expect(run(text)).toEqual({ items: [], questions: [], unmatched: [], method: 'local' });
  });

  it('never throws on values that are not text', () => {
    const odd = [undefined, null, 42, {}, ['nasi']] as unknown as string[];
    for (const text of odd) expect(() => estimateLocally({ text }, { personal: [] })).not.toThrow();
  });

  it('handles very long input', () => {
    const result = run(Array.from({ length: 50 }, () => 'teh tarik').join(', '));
    expect(result.items).toHaveLength(50);
    expect(result.questions).toHaveLength(2);
  });
});

/** [catalogue id or guess name, chip, kcal] for every item, to compare whole readings at once. */
function reading(text: string, ctx: EstimateContext = { personal: [] }): [string, string | undefined, number][] {
  return run(text, ctx).items.map((i) => [i.catalogueId ?? `guess:${i.name}`, chipOf(i), Math.round(kcalOf(i))]);
}

const atEconomyRice: EstimateContext = {
  place: place({ id: 'place-kedai', name: 'Kedai near home', type: 'economyRice', defaultVariants: {} }),
  personal: [],
};

describe('reviewed phrases', () => {
  it('never adds pot ingredients to a meal', () => {
    expect(reading('kaya')).toEqual([['kaya', '1 tbsp', 60]]);
    expect(reading('roti canai kari')).toEqual([['roti-canai', '1 piece', 300], ['kuah-kari', 'Normal', 100]]);
    expect(reading('nasi goreng minyak sikit')).toEqual([['nasi-goreng', 'Normal', 600]]);
    expect(reading('nasi goreng less oil')).toEqual([['nasi-goreng', 'Normal', 600]]);
    expect(reading('mee goreng mamak with onion')).toEqual([['mee-goreng-mamak', 'Normal', 830]]);
    expect(reading('roti telur bawang')).toEqual([['roti-telur-dhal', '1 piece', 420]]);
    expect(reading('nasi lemak pedas gila')).toEqual([['nasi-lemak-bungkus', '1 bungkus', 490]]);
    const sweet = run('teh tarik extra sugar');
    expect([reading('teh tarik extra sugar'), sweet.questions]).toEqual([[['teh-tarik', 'Normal', 200]], []]);
  });

  it('does not turn short everyday words into a different food', () => {
    expect(reading('kuih 3 biji')).toEqual([['kuih', '3 pieces', 390]]);
    expect(reading('kuih')).toEqual([['kuih', '1 piece', 130]]);
    expect(reading('ayam goreng tepung')).toEqual([['ayam-goreng-tepung', '1 piece', 320]]);
    expect(reading('paru goreng')).toEqual([['paru-goreng', '1 piece', 200]]);
  });

  it('keeps names written with "+" or "," whole', () => {
    expect(reading('roti telur + dhal')).toEqual([['roti-telur-dhal', '1 piece', 420]]);
    expect(reading('ulam + sambal')).toEqual([['ulam-sambal', '1 plate', 150]]);
    expect(reading('chapati + dhal')).toEqual([['chapati', '1 piece', 220]]);
    expect(reading('ikan bilis + kacang')).toEqual([['ikan-bilis-kacang', '1 scoop', 150]]);
    expect(reading('roti canai + dhal')).toEqual([['roti-canai-dhal', '1 piece', 360]]);
    expect(reading('Bread, kaya, kopi')).toEqual([['kaya-toast-kopi', '1 set', 380]]);
    // Separate foods still split.
    expect(reading('nasi lemak + teh tarik').map(([id]) => id)).toEqual(['nasi-lemak-bungkus', 'teh-tarik']);
  });

  it('reads "tambah" or "extra" before a food as adding it', () => {
    expect(reading('mee goreng mamak tambah telur')).toEqual([['mee-goreng-mamak', 'Normal', 830], ['telur-rebus', '1 egg', 80]]);
    expect(reading('maggi goreng tambah telur mata')).toEqual([['maggi-goreng', 'Normal', 700], ['telur-mata', '1 egg', 110]]);
    expect(reading('nasi lemak tambah ayam')).toEqual([['nasi-lemak-bungkus', '1 bungkus', 490], ['ayam-goreng-tray', '1 piece', 280]]);
    expect(reading('ckt extra cockles')[1]?.[1]).toBe('Normal');
  });

  it('reads "mamak" after kat, at or from as the Place', () => {
    expect(reading('nasi goreng kat mamak')).toEqual([['nasi-goreng', 'Normal', 600]]);
    expect(reading('mee goreng from the mamak')).toEqual([['mee-goreng-mamak', 'Normal', 830]]);
    expect(reading('nasi kandar mamak')).toEqual([['rice-nasi-kandar', 'Mamak big', 430]]);
  });

  it('gives a count right before a food to that food', () => {
    expect(reading('nasi kandar 2 ketul ayam goreng')).toEqual([['rice-nasi-kandar', 'Normal', 330], ['ayam-goreng-mamak', '2 pieces', 600]]);
    expect(reading('nasi kandar 2 ayam goreng')).toEqual([['rice-nasi-kandar', 'Normal', 330], ['ayam-goreng-mamak', '2 pieces', 600]]);
    expect(reading('nasi lemak 2 telur')).toEqual([['nasi-lemak-bungkus', '1 bungkus', 490], ['telur-rebus', '1 egg', 160]]);
    expect(reading('economy rice 2 meat 1 veg')).toEqual([['rice-economy', '1 scoop', 200], ['lauk', '1 scoop', 360], ['sayur-campur', '1 scoop', 80]]);
    // Counts after each food still count that food.
    expect(reading('teh tarik 2 roti canai 1').map(([id, , kcal]) => [id, kcal])).toEqual([['teh-tarik', 400], ['roti-canai', 300]]);
  });

  it('drops a food the text says no to', () => {
    expect(reading('mee goreng no egg')).toEqual([['mee-goreng-mamak', 'Normal', 830]]);
    expect(reading('roti canai no dhal')).toEqual([['roti-canai', '1 piece', 300]]);
    expect(reading('roti canai tak nak dhal')).toEqual([['roti-canai', '1 piece', 300]]);
    expect(reading('nasi lemak tanpa sambal')).toEqual([['nasi-lemak-bungkus', '1 bungkus', 490]]);
    expect(reading('nasi goreng kampung tak nak ikan bilis')).toEqual([['nasi-goreng-kampung', 'Normal', 650]]);
    expect(reading('mee goreng tanpa telur')).toEqual([['mee-goreng-mamak', 'Normal', 830]]);
    expect(run('roti canai dhal tak nak').unmatched).toEqual([]);
    // Sugar and ice phrases still mean what they say.
    expect(reading('teh tarik tak nak gula')).toEqual([['teh-tarik', 'Kosong', 70]]);
  });

  it('counts a nasi campur listed with its dishes as the rice plus those dishes', () => {
    expect(reading('nasi campur ayam goreng sayur kuah banjir', atEconomyRice)).toEqual([
      ['rice-economy', '1 scoop', 200],
      ['ayam-goreng-tray', '1 piece', 280],
      ['sayur-campur', '1 scoop', 80],
      ['kuah-on-rice', 'Banjir', 140],
    ]);
    expect(reading('nasi campur 3 lauk')).toEqual([['rice-economy', '1 scoop', 200], ['lauk', '1 scoop', 540]]);
    expect(reading('nasi campur')).toEqual([['nasi-campur', 'Typical', 670]]);
    expect(reading('nasi campur, teh o ais').map(([id]) => id)).toEqual(['nasi-campur', 'teh-o-ais']);
  });

  it('leaves chatter out of the meal but reports it', () => {
    const text =
      'I had a plate of nasi lemak with an extra fried egg and some sambal and a teh tarik kurang manis at the mamak near my office ' +
      'around 8am this morning before work, it was quite filling actually';
    const result = run(text);
    expect(result.items.map((i) => i.catalogueId)).toEqual(['nasi-lemak-bungkus', 'telur-mata', 'sambal', 'teh-tarik']);
    expect(result.items.every((i) => i.source === 'catalogue')).toBe(true);
    expect(reading('kopi kurang manis kaw')).toEqual([['kopi', 'Kurang', 110]]);
    for (const praise of ['nasi lemak sedap', 'best nasi lemak', 'nasi lemak sedap gila']) {
      expect(reading(praise)).toEqual([['nasi-lemak-bungkus', '1 bungkus', 490]]);
    }
    const loose = run('nasi lemak, teh tarik and fizzbuzz quux');
    expect(loose.items.map((i) => i.catalogueId)).toEqual(['nasi-lemak-bungkus', 'teh-tarik']);
  });

  it('scales the nearest counted chip to the typed count', () => {
    expect(reading('sate ayam 20 cucuk')).toEqual([['satay', '10 sticks', 920]]);
    expect(reading('satay 15 sticks')).toEqual([['satay', '10 sticks', 690]]);
    expect(reading('yong tau foo 12 pieces')).toEqual([['yong-tau-foo', '8 pieces', 720]]);
    expect(reading('durian 4 ulas')).toEqual([['durian', '3 seeds', 219]]);
    const many = run('satay 30');
    expect([reading('satay 30'), many.questions]).toEqual([[['satay', '10 sticks', 1380]], []]);
    expect(reading('roti canai 30')).toEqual([['roti-canai', '1 piece', 300]]);
  });

  it('picks the chip an alias names', () => {
    expect(reading('3 egg omelette', { place: place({ type: 'home' }), personal: [] })).toEqual([['omelette', '3 eggs', 280]]);
    expect(reading('garlic naan')).toEqual([['naan', 'Garlic', 350]]);
    expect(reading('naan keju')).toEqual([['naan', 'Cheese', 480]]);
    expect(reading('nasi ayam panggang')).toEqual([['chicken-rice', 'Roasted', 650]]);
    expect(reading('low fat milk')).toEqual([['susu', 'Low fat', 110]]);
    expect(reading('coke zero')).toEqual([['soft-drink', 'Zero sugar', 1]]);
    expect(reading('@home 3 egg omelette, sayur, small rice'.slice(6), { place: place({ type: 'home' }), personal: [] }).reduce((s, [, , k]) => s + k, 0)).toBe(510);
  });

  it('keeps a chip word after a typo fix and lets a modifier finish a misspelt name', () => {
    expect(reading('teh tarek kurang')).toEqual([['teh-tarik', 'Kurang', 140]]);
    expect(reading('teh tarek kosong')).toEqual([['teh-tarik', 'Kosong', 70]]);
    expect(reading('kuah campor banjir')).toEqual([['kuah-campur', 'Banjir', 220]]);
    expect(reading('mee gorng mamak')).toEqual([['mee-goreng-mamak', 'Normal', 830]]);
    expect(reading('kopi o ais kurng')).toEqual([['kopi-o-ais', 'Kurang', 60]]);
  });

  it('reads rice words next to drinks and food names the way they were meant', () => {
    expect(reading('nasi kandar ayam goreng kuah campur banjir teh o ais kurang nasi lebih')).toEqual([
      ['rice-nasi-kandar', 'Mamak big', 430],
      ['ayam-goreng-mamak', '1 piece', 300],
      ['kuah-campur', 'Banjir', 220],
      ['teh-o-ais', 'Kurang', 60],
    ]);
    expect(reading('separuh nasi lemak')).toEqual([['nasi-lemak-bungkus', '1 bungkus', 245]]);
    expect(reading('nasi kandar nasi besar ayam kari')).toEqual([['rice-nasi-kandar', 'Mamak big', 430], ['ayam-kari', '1 piece', 270]]);
  });

  it('keeps nasi kandar sides on the nasi kandar entries', () => {
    expect(reading('nasi kandar ayam goreng telur dadar bendi kuah banjir').map(([id]) => id)).toEqual([
      'rice-nasi-kandar',
      'ayam-goreng-mamak',
      'telur-dadar',
      'bendi-goreng',
      'kuah-campur',
    ]);
  });

  it('reads "kosong" after a dish as plain, not as the drink\'s sugar', () => {
    for (const text of ['mee goreng kosong, teh tarik', 'maggi goreng kosong, teh tarik', 'nasi lemak, roti bawang kosong, teh tarik']) {
      expect(chipOf(find(run(text), 'teh-tarik'))).toBe('Normal');
    }
    expect(chipOf(find(run('teh tarik, kosong'), 'teh-tarik'))).toBe('Kosong');
  });

  it('guesses unknown rice and noodle dishes as a plate, and asks only when it matters', () => {
    expect(run('nasi lontar biru').items[0]?.unitMacros.kcal).toBe(650);
    expect(run('mee siput muar').items[0]?.unitMacros.kcal).toBe(600);
    expect(reading('kopi o kaw')).toEqual([['kopi-o', 'Normal', 80]]);
    expect(reading('teh o kaw kosong')).toEqual([['teh-o', 'Kosong', 5]]);
    const small = run('papadom zork');
    expect(small.items[0]?.source).toBe('aiGuess');
    expect(small.questions).toEqual([]);
  });

  it('reads 100plus, sugar levels and fractions', () => {
    expect(reading('100plus')).toEqual([['100plus', 'Can (325 ml)', 80]]);
    expect(reading('100 plus')).toEqual([['100plus', 'Can (325 ml)', 80]]);
    expect(reading('chatime 0%')).toEqual([['bubble-tea', '0% sugar', 230]]);
    expect(reading('boba 25%')).toEqual([['bubble-tea', '50% sugar', 300]]);
    expect(reading('1/2 nasi lemak')).toEqual([['nasi-lemak-bungkus', '1 bungkus', 245]]);
    expect(reading('½ nasi lemak')).toEqual([['nasi-lemak-bungkus', '1 bungkus', 245]]);
  });

  it('passes words in other scripts on instead of dropping them', () => {
    const result = run('鸡饭');
    expect(result.items.map((i) => [i.name, i.source])).toEqual([['鸡饭', 'aiGuess']]);
    expect(result.unmatched).toEqual(['鸡饭']);
    expect(run('nasi lemak 鸡蛋').items.map((i) => i.name)).toEqual(['Nasi lemak bungkus', '鸡蛋']);
  });

  it('knows common drinks and their sizes', () => {
    expect(reading('air sirap bandung')).toEqual([['sirap-bandung', 'Normal', 220]]);
    expect(reading('f&n orange').map(([id]) => id)).toEqual(['soft-drink']);
    expect(reading('tealive brown sugar').map(([id]) => id)).toEqual(['bubble-tea']);
    expect(reading('limau').map(([id]) => id)).toEqual(['limau-ais']);
    expect(reading('teh o ais ikat tepi').map(([id]) => id)).toEqual(['teh-o-ais-besar']);
    expect(reading('teh tarik ikat tepi kurang')).toEqual([['teh-tarik-besar', 'Kurang', 210]]);
    for (const [text, id] of [
      ['teh halia', 'teh-halia'],
      ['neslo', 'neslo'],
      ['horlicks ais', 'horlicks'],
      ['milo o ais', 'milo-o-ais'],
    ] as const) {
      expect(reading(text).map(([found]) => found), text).toEqual([id]);
    }
  });

  it('knows common first-week mamak and hawker dishes', () => {
    for (const [text, id] of [
      ['mee bandung', 'mee-bandung'],
      ['nasi goreng pattaya', 'nasi-goreng-pattaya'],
      ['nasi goreng usa', 'nasi-goreng-usa'],
      ['nasi paprik', 'nasi-paprik'],
      ['nasi dagang', 'nasi-dagang'],
      ['nasi kerabu', 'nasi-kerabu'],
      ['nasi kukus ayam', 'nasi-kukus'],
      ['lontong', 'lontong'],
      ['ketupat', 'ketupat'],
      ['roti planta', 'roti-planta'],
      ['roti sardin', 'roti-sardin'],
      ['roti pisang', 'roti-pisang'],
      ['roti boom', 'roti-boom'],
      ['sotong goreng tepung', 'sotong-goreng-tepung'],
      ['calamari', 'sotong-goreng-tepung'],
      ['koay teow kungfu', 'kuey-teow-kungfu'],
      ['ayam geprek', 'ayam-geprek'],
      ['burger ramly', 'burger-ramly'],
      ['kfc', 'ayam-goreng-tepung'],
      ['mee jawa', 'mee-jawa'],
      ['kuey teow', 'char-kuey-teow'],
      ['toast', 'roti-putih'],
      ['roti canai telur', 'roti-telur-dhal'],
    ] as const) {
      expect(reading(text).map(([found]) => found), text).toEqual([id]);
    }
    expect(reading('2 eggs')).toEqual([['telur-rebus', '1 egg', 160]]);
  });

  it('reads plain laksa as curry laksa and veg at an economy-rice stall as a tray scoop', () => {
    expect(reading('laksa').map(([id]) => id)).toEqual(['curry-laksa']);
    expect(reading('sayur', atEconomyRice)).toEqual([['sayur-campur', '1 scoop', 80]]);
  });

  it('keeps guesses to a readable size', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `zork${i % 7}`).join(' ');
    const long = run(words);
    expect(long.items).toHaveLength(0);
    expect(long.unmatched.length).toBeGreaterThan(0);
    const token = run('q'.repeat(100_000));
    expect(token.items.every((i) => i.name.length <= 60)).toBe(true);
    const many = run(Array.from({ length: 80 }, () => 'teh tarik').join(', '));
    expect(many.items).toHaveLength(60);
  });
});

describe('createLocalEstimator', () => {
  it('resolves through the Estimator interface', async () => {
    const estimator = createLocalEstimator({ newId: sequentialIds() });
    const result = await estimator.estimate({ text: 'teh tarik' }, { personal: [] });
    expect(result.items.map((i) => i.id)).toEqual(['item-1']);
  });

  it('reads the photo caption', async () => {
    const result = await createLocalEstimator().estimate({ caption: 'kuah banjir', photo: new Blob(['x']) }, { personal: [] });
    expect(result.items.map((i) => chipOf(i))).toEqual(['Banjir']);
  });

  it('rejects when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createLocalEstimator().estimate({ text: 'teh tarik' }, { personal: [] }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
