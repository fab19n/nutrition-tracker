import type { PotIngredient } from '@/domain/types';
import {
  OIL_TBSP_CHOICES,
  ingredientFromText,
  kcalPerServing,
  oilIngredient,
  oilTbsp,
  parseRecipeLine,
  quantityText,
  recipeTotal,
  reestimateIngredient,
  splitRecipe,
  splitRecipeLines,
  withIngredientKcal,
} from './recipe';

const PLAN_EXAMPLE = '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang';

function byName(list: PotIngredient[], name: string): PotIngredient {
  const found = list.find((i) => i.name === name);
  if (!found) throw new Error(`No ${name} in ${list.map((i) => i.name).join(', ')}`);
  return found;
}

/** kcal of the only ingredient a line gives. */
function kcalOf(text: string): number {
  const [only, ...rest] = splitRecipe(text);
  if (!only || rest.length > 0) throw new Error(`Expected one ingredient from "${text}"`);
  return only.macros.kcal;
}

describe('splitRecipe: the plan example (S27)', () => {
  const ingredients = splitRecipe(PLAN_EXAMPLE);

  it('splits into Ayam, Santan, Kentang, Rempah and bawang, then Cooking oil last', () => {
    expect(ingredients.map((i) => i.name)).toEqual(['Ayam', 'Santan', 'Kentang', 'Rempah and bawang', 'Cooking oil']);
    expect(ingredients.map((i) => i.id)).toEqual(['ing-1', 'ing-2', 'ing-3', 'ing-4', 'ing-5']);
  });

  it('gives each ingredient the design kcal (±10%)', () => {
    const expected: [string, number][] = [
      ['Ayam', 2150],
      ['Santan', 800],
      ['Kentang', 350],
      ['Rempah and bawang', 250],
      ['Cooking oil', 480],
    ];
    for (const [name, kcal] of expected) {
      const got = byName(ingredients, name).macros.kcal;
      expect(Math.abs(got - kcal) / kcal, `${name}: ${got}`).toBeLessThanOrEqual(0.1);
    }
  });

  it('totals about 4,030 kcal and about 500 a serving over 8', () => {
    const total = recipeTotal(ingredients).kcal;
    expect(Math.abs(total - 4030) / 4030).toBeLessThanOrEqual(0.1);
    expect(Math.round(total / 10) * 10).toBe(4030);
    expect(Math.round(kcalPerServing(ingredients, 8) / 10) * 10).toBe(500);
  });

  it('reads amounts the way the demo pot shows them', () => {
    expect(byName(ingredients, 'Ayam').amount).toBe('1 ekor');
    expect(byName(ingredients, 'Santan').amount).toBe('1 tin');
    expect(byName(ingredients, 'Kentang').amount).toBe('3 biji');
    expect(byName(ingredients, 'Rempah and bawang').amount).toBe('rempah kari, bawang');
    expect(byName(ingredients, 'Cooking oil').amount).toBe('4 tbsp');
  });

  it('marks oil for the spoon chips and keeps macros that match the kcal', () => {
    const oil = byName(ingredients, 'Cooking oil');
    expect(oil.isOil).toBe(true);
    expect(oilTbsp(oil)).toBe(4);
    expect(oil.macros.fatG).toBeCloseTo(54, 0);
    const ayam = byName(ingredients, 'Ayam');
    expect(ayam.isOil).toBeUndefined();
    expect(ayam.macros.proteinG).toBeGreaterThan(150);
    expect(ingredients.every((i) => i.source === 'catalogue')).toBe(true);
  });

  it('uses the ids it is given', () => {
    const ids = splitRecipe(PLAN_EXAMPLE, { makeId: (i) => `pot-x-${i}` }).map((i) => i.id);
    expect(ids).toEqual(['pot-x-0', 'pot-x-1', 'pot-x-2', 'pot-x-3', 'pot-x-4']);
  });
});

describe('splitRecipe: separators', () => {
  it('splits on new lines, "dan", "and", "+", "&" and semicolons', () => {
    const list = splitRecipe('1 ekor ayam\n1 tin santan dan 3 kentang and garam + air & bawang; gula');
    expect(list.map((i) => i.name)).toEqual(['Ayam', 'Santan', 'Kentang', 'Garam', 'Air', 'Rempah and bawang', 'Gula']);
  });

  it('keeps decimal points and thousands inside numbers', () => {
    expect(splitRecipeLines('1.5 kg ayam. 1,000 g kentang')).toEqual(['1.5 kg ayam', '1000 g kentang']);
  });

  it('drops bullets and empty lines', () => {
    expect(splitRecipeLines('- 1 ekor ayam\n\n* 1 tin santan\n , ,')).toEqual(['1 ekor ayam', '1 tin santan']);
  });

  it('merges every spice, onion and garlic line into one allowance for the pot', () => {
    const list = splitRecipe('serai, halia, 3 ulas bawang putih, 2 biji bawang besar, cili kering');
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Rempah and bawang');
    expect(list[0]?.macros.kcal).toBe(250);
    expect(list[0]?.amount).toBe('serai, halia, 3 ulas bawang putih, 2 biji bawang besar, cili kering');
  });

  it('sums several oil lines into one', () => {
    const list = splitRecipe('2 sudu minyak, ayam, 1 sudu minyak masak');
    expect(list.map((i) => i.name)).toEqual(['Ayam', 'Cooking oil']);
    expect(list[1]?.amount).toBe('3 tbsp');
    expect(list[1]?.macros.kcal).toBe(360);
  });
});

describe('splitRecipe: units and numbers', () => {
  it.each([
    ['2 ekor ayam', 4300],
    ['dua ekor ayam', 4300],
    ['seekor ayam', 2150],
    ['setengah ekor ayam', 1075],
    ['half a whole chicken', 1075],
    ['1 kg ayam', 1433],
    ['500g ayam', 717],
    ['ayam 1 ekor', 2150],
    ['1 kotak santan', 400],
    ['satu kotak santan', 400],
    ['½ tin santan', 400],
    ['1/2 tin santan', 400],
    ['200 ml santan', 400],
    ['1½ cawan santan', 750],
    ['santan', 800],
    ['tiga biji kentang', 345],
    ['3 pieces potato', 345],
    ['500 g kentang', 383],
    ['2-4 kentang', 345],
    ['2 sudu kecil gula', 32],
    ['1 sudu besar gula', 48],
    ['1 tbsp sugar', 48],
    ['2 sudu susu pekat', 120],
    ['2 biji telur', 160],
  ])('%s → ~%i kcal', (text, kcal) => {
    expect(kcalOf(text)).toBeCloseTo(kcal, -1);
  });

  it.each([
    ['4 sudu minyak', 4, 480],
    ['minyak 6 sudu', 6, 720],
    ['2 tbsp oil', 2, 240],
    ['enam sudu minyak masak', 6, 720],
    ['3 sudu kecil minyak', 1, 120],
    ['60 ml minyak', 4, 480],
    ['minyak', 4, 480],
  ])('%s → oil %i tbsp', (text, tbsp, kcal) => {
    const [oil] = splitRecipe(text);
    expect(oil?.isOil).toBe(true);
    expect(oilTbsp(oil as PotIngredient)).toBeCloseTo(tbsp, 5);
    expect(oil?.macros.kcal).toBe(kcal);
  });

  it('reads a line into quantity, unit and name', () => {
    expect(parseRecipeLine('4 sudu minyak')).toMatchObject({ quantity: 4, unit: 'tbsp', nameTokens: ['minyak'] });
    expect(parseRecipeLine('2 sudu kecil garam')).toMatchObject({ quantity: 2, unit: 'tsp', nameTokens: ['garam'] });
    expect(parseRecipeLine('secawan air')).toMatchObject({ quantity: 1, unit: 'cup', nameTokens: ['air'] });
    expect(parseRecipeLine('tin santan')).toMatchObject({ quantity: 1, unit: 'can', nameTokens: ['santan'] });
    expect(parseRecipeLine('a can of santan')).toMatchObject({ quantity: 1, unit: 'can', nameTokens: ['santan'] });
    expect(parseRecipeLine('1 1/2 cawan beras')).toMatchObject({ quantity: 1.5, unit: 'cup', nameTokens: ['beras'] });
    expect(parseRecipeLine('rempah kari')).toEqual({ text: 'rempah kari', nameTokens: ['rempah', 'kari'] });
  });

  it('forgives a one-letter typo in a pot word', () => {
    expect(splitRecipe('3 kentan')[0]?.name).toBe('Kentang');
    expect(splitRecipe('1 tin santn')[0]?.name).toBe('Santan');
  });

  it('formats quantities with halves and quarters', () => {
    expect(quantityText(1)).toBe('1');
    expect(quantityText(0.5)).toBe('½');
    expect(quantityText(2.5)).toBe('2½');
    expect(quantityText(1.25)).toBe('1¼');
    expect(quantityText(0.3)).toBe('0.3');
    expect(quantityText(1200)).toBe('1,200');
  });
});

describe('splitRecipe: unknown lines', () => {
  it('turns a line the catalogue doesn’t know into an AI guess the user can edit', () => {
    const [beras] = splitRecipe('2 cawan beras');
    expect(beras).toMatchObject({ name: 'Beras', amount: '2 cawan', source: 'aiGuess' });
    expect(beras?.macros.kcal).toBeGreaterThan(0);
    expect(beras?.macros.kcal).toBeLessThanOrEqual(2000);
  });

  it('gives a modest guess for a name with no amount, and caps big ones', () => {
    const [tepung] = splitRecipe('tepung jagung');
    expect(tepung).toMatchObject({ name: 'Tepung jagung', amount: '', source: 'aiGuess' });
    expect(tepung?.macros.kcal).toBe(150);
    expect(splitRecipe('10 kg daging')[0]?.macros.kcal).toBe(2000);
  });

  it('only takes a dish from the general catalogue when the other words just describe it', () => {
    expect(splitRecipe('2 biji telur ayam')[0]).toMatchObject({ name: 'Telur rebus', source: 'catalogue' });
    expect(splitRecipe('1 packet rendang paste')[0]).toMatchObject({ name: 'Rendang paste', source: 'aiGuess' });
    // Pot words may carry any extra word.
    expect(splitRecipe('1 ekor ayam kampung')[0]).toMatchObject({ name: 'Ayam', source: 'catalogue' });
  });

  it('keeps known lines alongside unknown ones', () => {
    const list = splitRecipe('1 ekor ayam, 2 cawan beras, garam');
    expect(list.map((i) => [i.name, i.source])).toEqual([
      ['Ayam', 'catalogue'],
      ['Beras', 'aiGuess'],
      ['Garam', 'catalogue'],
    ]);
    expect(list[2]?.macros.kcal).toBe(0);
  });
});

describe('splitRecipe: chicken pieces and cuts', () => {
  it.each([
    // A ketul is about 120 g with bone, at the whole bird's 2,150 kcal for 1.5 kg.
    ['2 ketul ayam', '2 ketul', 344],
    ['ayam 8 ketul', '8 ketul', 1376],
    ['ayam 2 potong', '2 ketul', 344],
    ['2 biji ayam', '2 ketul', 344],
    ['ayam 8', '8 ketul', 1376],
    ['2 peha ayam', '2 peha', 573],
    ['4 keping dada ayam', '4 dada', 1032],
    ['sayap ayam 10', '10 sayap', 1290],
    ['10 kepak ayam', '10 kepak', 1290],
    ['6 chicken drumsticks', '6 drumstick', 946],
    ['peha ayam', '1 peha', 287],
  ])('%s → %s, ~%i kcal', (text, amount, kcal) => {
    const [only, ...rest] = splitRecipe(text);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ name: 'Ayam', amount, source: 'catalogue' });
    expect(only?.macros.kcal).toBe(kcal);
    // Every piece lands in the 100–300 kcal a piece range, never a whole bird.
    expect((only?.macros.kcal ?? 0) / Number.parseInt(amount, 10)).toBeLessThan(300);
  });

  it('still reads whole birds and weights the old way', () => {
    expect(splitRecipe('1 ekor ayam')[0]).toMatchObject({ amount: '1 ekor', macros: { kcal: 2150 } });
    expect(splitRecipe('ayam 1')[0]).toMatchObject({ amount: '1 ekor', macros: { kcal: 2150 } });
    expect(splitRecipe('1 ekor ayam, potong 12')).toHaveLength(1);
    expect(splitRecipe('500 g dada ayam')[0]).toMatchObject({ name: 'Ayam', amount: '500 g', macros: { kcal: 717 } });
  });

  it('re-reads an edited chicken amount as pieces', () => {
    const [ayam] = splitRecipe('1 ekor ayam') as [PotIngredient];
    expect(reestimateIngredient(ayam, '2 ketul').macros.kcal).toBe(344);
    expect(reestimateIngredient(ayam, '2').macros.kcal).toBe(344);
    expect(reestimateIngredient(ayam, '2 peha').macros.kcal).toBe(573);
    expect(reestimateIngredient(ayam, '1 ekor').macros.kcal).toBe(2150);
  });
});

describe('splitRecipe: titles and headings', () => {
  const POT = '1 ekor ayam\n1 tin santan\n3 kentang\n4 sudu minyak';

  it('skips a title line naming a cooked dish', () => {
    const list = splitRecipe(`Kari ayam\n${POT}`);
    expect(list.map((i) => i.name)).toEqual(['Ayam', 'Santan', 'Kentang', 'Cooking oil']);
    expect(recipeTotal(list).kcal).toBe(3775);
  });

  it('drops a title before a colon and keeps what follows', () => {
    const curry = splitRecipe('Kari ayam: 1 ekor ayam. 2 kotak santan. 4 kentang.');
    expect(curry.map((i) => [i.name, i.amount])).toEqual([
      ['Ayam', '1 ekor'],
      ['Santan', '2 kotak'],
      ['Kentang', '4 biji'],
    ]);
    expect(recipeTotal(curry).kcal).toBe(3410);
    const merah = splitRecipe('Ayam masak merah: 1 ekor ayam, 2 sudu minyak');
    expect(merah.map((i) => i.name)).toEqual(['Ayam', 'Cooking oil']);
    expect(recipeTotal(merah).kcal).toBe(2390);
  });

  it('skips a title that names an ingredient a later line measures', () => {
    expect(splitRecipe('Ayam masak merah\n1 ekor ayam\n2 sudu minyak').map((i) => i.amount)).toEqual(['1 ekor', '2 tbsp']);
  });

  it('skips a first line that repeats the pot name', () => {
    expect(splitRecipe('Lauk Ahad\n1 tin santan').map((i) => i.name)).toEqual(['Lauk ahad', 'Santan']);
    expect(splitRecipe('Lauk Ahad\n1 tin santan', { title: 'lauk ahad' }).map((i) => i.name)).toEqual(['Santan']);
  });

  it('keeps a first line that is an ingredient, and a lone dish name', () => {
    expect(splitRecipe('ayam\n1 tin santan').map((i) => i.name)).toEqual(['Ayam', 'Santan']);
    expect(splitRecipe('sardin\n2 biji bawang').map((i) => i.name)).toEqual(['Sardin masak', 'Rempah and bawang']);
    expect(splitRecipe('Kari ayam').map((i) => i.name)).toEqual(['Kari ayam']);
  });

  it('keeps a name whose amount follows the colon', () => {
    expect(splitRecipeLines('Santan: 1 tin')).toEqual(['Santan  1 tin']);
    expect(splitRecipe('Santan: 1 tin\nKentang: 3')[0]).toMatchObject({ name: 'Santan', amount: '1 tin' });
    expect(splitRecipe('Santan: 1 tin\nKentang: 3')[1]).toMatchObject({ name: 'Kentang', amount: '3 biji' });
  });

  it('drops headings and head counts, and stops at the method', () => {
    expect(splitRecipeLines('Bahan-bahan:\n1 ekor ayam\nUntuk 8 orang\nCara:\ntumis bawang\nmasukkan ayam')).toEqual(['1 ekor ayam']);
    expect(splitRecipeLines('Ingredients\n1 tin santan\nServes 6\nMethod\n1. Fry the onions')).toEqual(['1 tin santan']);
    expect(splitRecipeLines('Cara memasak: tumis bawang')).toEqual([]);
    expect(splitRecipe('Untuk 8 orang')).toEqual([]);
  });

  it('leaves times alone', () => {
    expect(splitRecipeLines('1 ekor ayam, masak 10:30')).toEqual(['1 ekor ayam', 'masak 10:30']);
  });
});

describe('splitRecipe: Malay unit words', () => {
  it.each([
    ['2 peket santan', 'Santan', '2 kotak', 800],
    ['1 peket santan kara', 'Santan', '1 kotak', 400],
    ['1 pkt santan', 'Santan', '1 kotak', 400],
    ['gula melaka 2 keping', 'Gula melaka', '2 keping', 342],
    ['2 keping tauhu', 'Tauhu', '2 keping', 220],
    ['tauhu 2 keping', 'Tauhu', '2 keping', 220],
    ['tempe 2 keping', 'Tempe', '2 keping', 312],
    ['1 bungkus mee kuning', 'Mee kuning', '1 peket', 765],
  ])('%s → %s %s, ~%i kcal', (text, name, amount, kcal) => {
    const [only, ...rest] = splitRecipe(text);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ name, amount, source: 'catalogue' });
    expect(only?.macros.kcal).toBe(kcal);
  });

  it('keeps ikat, batang, helai and inci out of the name', () => {
    expect(parseRecipeLine('sayur kangkung 1 ikat')).toMatchObject({ quantity: 1, unit: 'bunch', nameTokens: ['sayur', 'kangkung'] });
    expect(parseRecipeLine('2 batang serai')).toMatchObject({ quantity: 2, unit: 'stalk', nameTokens: ['serai'] });
    expect(parseRecipeLine('5 helai daun kari')).toMatchObject({ quantity: 5, unit: 'leaf', nameTokens: ['daun', 'kari'] });
    expect(parseRecipeLine('1 inci halia')).toMatchObject({ quantity: 1, unit: 'inch', nameTokens: ['halia'] });
    expect(parseRecipeLine('ikat kangkung')).toMatchObject({ quantity: 1, unit: 'bunch', nameTokens: ['kangkung'] });
    expect(splitRecipe('sayur kangkung 1 ikat')[0]).toMatchObject({ name: 'Sayur kangkung', amount: '1 ikat', source: 'aiGuess', macros: { kcal: 50 } });
    expect(splitRecipe('2 batang serai, 5 helai daun kari, 1 inci halia')).toHaveLength(1);
  });
});

describe('splitRecipe: raw ingredients and spoon measures', () => {
  it('reads dried ikan bilis and fresh mee kuning raw, not as the cooked sides', () => {
    expect(splitRecipe('250 g ikan bilis')[0]).toMatchObject({ name: 'Ikan bilis', macros: { kcal: 700 } });
    expect(splitRecipe('ikan bilis 1 cawan')[0]).toMatchObject({ name: 'Ikan bilis', amount: '1 cawan', macros: { kcal: 252 } });
    expect(splitRecipe('mee kuning 500g')[0]).toMatchObject({ name: 'Mee kuning', amount: '500 g', macros: { kcal: 850 } });
    // Already cooked, the catalogue sides still match.
    expect(splitRecipe('1 senduk ikan bilis goreng')[0]?.name).toBe('Ikan bilis + kacang');
    expect(splitRecipe('2 keping tauhu goreng')[0]).toMatchObject({ name: 'Tauhu goreng', macros: { kcal: 220 } });
  });

  it('calls a cooked dish by the cup a guess', () => {
    expect(splitRecipe('1 cawan nasi putih')[0]).toMatchObject({ name: 'Nasi putih', source: 'aiGuess' });
    expect(splitRecipe('1½ cawan santan')[0]?.source).toBe('catalogue');
  });

  it('lets a bought amount of a pot ingredient win over a dish name on the same line', () => {
    expect(splitRecipe('Kari ayam 1 ekor ayam')[0]).toMatchObject({ name: 'Ayam', amount: '1 ekor', macros: { kcal: 2150 } });
    expect(splitRecipe('500 g bawang')[0]?.name).toBe('Rempah and bawang');
  });
});

describe('splitRecipe: decimal commas', () => {
  it('reads "1,5 kg" as one and a half kilos', () => {
    expect(splitRecipeLines('1,5 kg ayam, 0,5 cawan santan')).toEqual(['1.5 kg ayam', '0.5 cawan santan']);
    expect(splitRecipe('1,5 kg ayam')[0]).toMatchObject({ amount: '1½ kg', macros: { kcal: 2150 } });
  });

  it('still splits a list on commas between numbers and names', () => {
    expect(splitRecipeLines('santan 2,3 kentang')).toEqual(['santan 2', '3 kentang']);
  });
});

describe('splitRecipe: empty and odd input', () => {
  it.each(['', '   ', ',,,', '\n\n', '4', '500 g', '🍲🍲', 'and dan and'])('gives nothing for %j', (text) => {
    expect(splitRecipe(text)).toEqual([]);
  });

  it('never throws', () => {
    const odd = ['1/0 tin santan', '0 ekor ayam', '-3 kentang', '9'.repeat(400), 'ayam '.repeat(500), '½½½ santan', '1e9 g ayam'];
    for (const text of odd) expect(() => splitRecipe(text)).not.toThrow();
    expect(() => splitRecipe(undefined as unknown as string)).not.toThrow();
    expect(splitRecipe(null as unknown as string)).toEqual([]);
  });
});

describe('editing ingredients', () => {
  const [ayam, , , , oil] = splitRecipe(PLAN_EXAMPLE) as [PotIngredient, PotIngredient, PotIngredient, PotIngredient, PotIngredient];

  it('re-reads an edited amount and keeps the id and name', () => {
    const half = reestimateIngredient(ayam, 'half ekor');
    expect(half).toMatchObject({ id: ayam.id, name: 'Ayam', amount: 'half ekor', source: 'catalogue' });
    expect(half.macros.kcal).toBe(1075);
    expect(reestimateIngredient({ ...ayam, name: 'Ayam kampung' }, '1 ekor').macros.kcal).toBe(2150);
  });

  it('re-reads an oil amount as tablespoons', () => {
    const six = reestimateIngredient(oil, '6 tbsp');
    expect(six).toMatchObject({ id: oil.id, isOil: true, amount: '6 tbsp' });
    expect(six.macros.kcal).toBe(720);
  });

  it('keeps a hand-set kcal when the new amount can’t be read', () => {
    const mine = withIngredientKcal({ id: 'x', name: 'Rendang paste', amount: '1 packet', macros: { kcal: 150, proteinG: 7.5, carbsG: 16.9, fatG: 5.8 }, source: 'aiGuess' }, 300);
    expect(mine.source).toBe('yourCorrection');
    const edited = reestimateIngredient(mine, '2 packets');
    expect(edited.macros.kcal).toBe(300);
    expect(edited.amount).toBe('2 packets');
  });

  it('updates a guess when its amount changes', () => {
    const [beras] = splitRecipe('1 cawan beras') as [PotIngredient];
    expect(reestimateIngredient(beras, '2 cawan').macros.kcal).toBe(beras.macros.kcal * 2);
  });

  it('sets kcal by hand and scales the macros to match', () => {
    const edited = withIngredientKcal(ayam, 1075);
    expect(edited.source).toBe('yourCorrection');
    expect(edited.macros.kcal).toBe(1075);
    expect(edited.macros.proteinG).toBeCloseTo(ayam.macros.proteinG / 2, 0);
    expect(withIngredientKcal(ayam, Number.NaN).macros.kcal).toBe(ayam.macros.kcal);
    expect(withIngredientKcal({ ...ayam, macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 } }, 200).macros.kcal).toBe(200);
  });

  it('builds the oil line for each chip', () => {
    expect(OIL_TBSP_CHOICES).toEqual([2, 4, 6]);
    expect(OIL_TBSP_CHOICES.map((t) => oilIngredient(t, 'oil').macros.kcal)).toEqual([240, 480, 720]);
    expect(oilIngredient(2, 'oil')).toMatchObject({ name: 'Cooking oil', amount: '2 tbsp', isOil: true, source: 'catalogue' });
    expect(oilTbsp({ amount: '1 cawan', isOil: true })).toBeUndefined();
    expect(oilTbsp({ amount: '4 tbsp' })).toBeUndefined();
  });

  it('reads one typed line as a new ingredient', () => {
    expect(ingredientFromText('2 biji telur', 'new-1')).toMatchObject({ id: 'new-1', name: 'Telur rebus', amount: '2 biji', source: 'catalogue' });
    expect(ingredientFromText('  ', 'new-2')).toBeUndefined();
  });

  it('splits a pot into servings', () => {
    expect(kcalPerServing([ayam], 0)).toBe(0);
    expect(kcalPerServing([ayam], Number.NaN)).toBe(0);
    expect(kcalPerServing([ayam, oil], 2)).toBe((ayam.macros.kcal + oil.macros.kcal) / 2);
  });
});
