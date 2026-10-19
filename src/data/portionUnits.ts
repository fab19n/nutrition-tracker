/**
 * The portion dictionary (plan §14.2): what a scoop, piece, plate, cup or senduk means in grams
 * or millilitres. Reference tables give values per 100 g; this is what turns them into how
 * people actually eat. Values are typical, not measured.
 */

/** food = a serving of a dish · drink = a drink container · cooking = a recipe measure · count = a counting word. */
export type PortionKind = 'food' | 'drink' | 'cooking' | 'count';

export interface PortionUnit {
  id: string;
  /** Caption wording, the same text used in CatalogueItem.unit ("a scoop"). Several units can share one. */
  label: string;
  kind: PortionKind;
  /** Words people type for it, Malay and English, lowercase. */
  aliases: string[];
  grams?: number;
  ml?: number;
  note: string;
}

export const PORTION_UNITS: PortionUnit[] = [
  // Servings
  {
    id: 'scoop-rice',
    label: 'a scoop',
    kind: 'food',
    aliases: ['scoop', 'scoops', 'scoop nasi', 'senduk nasi'],
    grams: 155,
    note: 'Economy-rice scoop of cooked white rice, about 200 kcal. Half ≈ 80 g, 1.5 scoops ≈ 230 g.',
  },
  {
    id: 'scoop-dish',
    label: 'a scoop',
    kind: 'food',
    aliases: ['scoop lauk', 'sudu lauk', 'cedok'],
    grams: 90,
    note: 'One serving spoon of a tray dish at a typical stall, 70–100 g. Gravy dishes include some kuah.',
  },
  {
    id: 'piece',
    label: 'a piece',
    kind: 'count',
    aliases: ['piece', 'pieces', 'pc', 'pcs', 'biji', 'sebiji', 'buah'],
    note: 'Counting word. The weight depends on the dish: see the piece sizes below or the catalogue entry.',
  },
  {
    id: 'piece-chicken',
    label: 'a piece',
    kind: 'food',
    aliases: ['ketul', 'seketul', 'ketul ayam'],
    grams: 120,
    note: 'Chicken piece with bone, about 120 g (about 85 g edible). A drumstick is nearer 100 g.',
  },
  {
    id: 'piece-fish',
    label: 'a piece',
    kind: 'food',
    aliases: ['ketul ikan', 'potong ikan'],
    grams: 90,
    note: 'Fish piece or half a kembung, about 90 g edible.',
  },
  {
    id: 'piece-roti',
    label: 'a piece',
    kind: 'food',
    aliases: ['keping roti canai'],
    grams: 90,
    note: 'Roti canai, about 90 g. Roti telur is nearer 130 g.',
  },
  {
    id: 'piece-kuih',
    label: 'a piece',
    kind: 'food',
    aliases: ['potong', 'sepotong', 'potong kuih'],
    grams: 50,
    note: 'Kuih or fritter, 40–60 g.',
  },
  {
    id: 'egg',
    label: 'an egg',
    kind: 'food',
    aliases: ['egg', 'eggs', 'telur', 'biji telur'],
    grams: 50,
    note: 'Grade B egg, about 50 g without the shell.',
  },
  {
    id: 'plate',
    label: 'a plate',
    kind: 'food',
    aliases: ['plate', 'pinggan', 'sepinggan'],
    grams: 350,
    note: 'Hawker or mamak rice or noodle plate, 300–400 g. Nasi kandar rice alone is about 255 g.',
  },
  {
    id: 'mamak-big',
    label: 'a plate',
    kind: 'food',
    aliases: ['mamak big', 'besar', 'big', 'large', 'tambah', 'banyak'],
    grams: 450,
    note: 'About 30% more than a normal plate. Nasi kandar rice ≈ 330 g instead of 255 g.',
  },
  {
    id: 'bowl',
    label: 'a bowl',
    kind: 'food',
    aliases: ['bowl', 'mangkuk', 'semangkuk'],
    grams: 550,
    ml: 350,
    note: 'Noodle soup bowl, about 550 g including about 350 ml of soup.',
  },
  {
    id: 'bowl-rice',
    label: 'a bowl',
    kind: 'food',
    aliases: ['rice bowl', 'mangkuk nasi'],
    grams: 155,
    note: 'Home rice bowl, about 155 g cooked rice (about 200 kcal).',
  },
  {
    id: 'senduk',
    label: 'a senduk',
    kind: 'food',
    aliases: ['senduk', 'sesenduk', 'sendok', 'ladle'],
    grams: 150,
    ml: 120,
    note: 'Home curry ladle: about 150 g with a piece of meat, potato and gravy, or about 120 ml of gravy alone.',
  },
  {
    id: 'bungkus',
    label: 'a bungkus',
    kind: 'food',
    aliases: ['bungkus', 'sebungkus', 'bungkusan', 'packet'],
    grams: 200,
    note: 'Wrapped nasi lemak, about 200 g.',
  },
  {
    id: 'slice-bread',
    label: 'a slice',
    kind: 'food',
    aliases: ['slice', 'slices', 'keping', 'sekeping'],
    grams: 30,
    note: 'Sandwich bread slice, about 30 g (about 75 kcal before spreads).',
  },
  {
    id: 'slice-fruit',
    label: 'a slice',
    kind: 'food',
    aliases: ['potong buah', 'wedge'],
    grams: 150,
    note: 'Cut fruit slice without rind: watermelon ≈ 200 g, papaya ≈ 150 g, pineapple ≈ 100 g.',
  },
  {
    id: 'stick',
    label: 'a stick',
    kind: 'food',
    aliases: ['stick', 'sticks', 'cucuk', 'secucuk', 'lidi'],
    grams: 25,
    note: 'Satay stick, about 25 g of cooked meat.',
  },
  {
    id: 'handful',
    label: 'a handful',
    kind: 'food',
    aliases: ['handful', 'genggam', 'segenggam'],
    grams: 30,
    note: 'Nuts or chips, about 30 g. Fruit like grapes, about 100 g.',
  },
  {
    id: 'seed',
    label: 'a seed',
    kind: 'food',
    aliases: ['ulas', 'seulas', 'biji durian', 'seed', 'seeds'],
    grams: 35,
    note: 'Durian flesh around one seed, about 35 g. Musang king seeds run bigger.',
  },
  {
    id: 'set',
    label: 'a set',
    kind: 'food',
    aliases: ['set', 'kopitiam set'],
    grams: 80,
    ml: 200,
    note: 'Kopitiam breakfast set: 2 slices of kaya toast (about 80 g) and a hot drink (about 200 ml).',
  },
  {
    id: 'pack-noodles',
    label: 'a pack',
    kind: 'food',
    aliases: ['pack', 'peket', 'paket', 'sepeket'],
    grams: 80,
    note: 'Instant noodle pack, about 80 g dry with the seasoning.',
  },
  {
    id: 'roll',
    label: 'a roll',
    kind: 'food',
    aliases: ['roll', 'gulung'],
    grams: 120,
    note: 'Fresh popiah roll, about 120 g.',
  },

  // Recipe measures (pots)
  {
    id: 'tbsp',
    label: 'a tbsp',
    kind: 'cooking',
    aliases: ['tbsp', 'tablespoon', 'sudu', 'sudu besar', 'sudu makan'],
    ml: 15,
    note: '15 ml. Oil ≈ 13.5 g (about 120 kcal), sugar ≈ 12 g, condensed milk ≈ 19 g. In recipes "sudu" usually means this.',
  },
  {
    id: 'tsp',
    label: 'a tsp',
    kind: 'cooking',
    aliases: ['tsp', 'teaspoon', 'sudu kecil', 'sudu teh'],
    ml: 5,
    note: '5 ml. Sugar ≈ 4 g (about 16 kcal), oil ≈ 4.5 g (about 40 kcal).',
  },
  {
    id: 'can-santan',
    label: 'a can',
    kind: 'cooking',
    aliases: ['tin', 'tin santan', 'can santan'],
    grams: 400,
    ml: 400,
    note: '400 ml can of full-fat coconut milk, about 800 kcal.',
  },
  {
    id: 'pack-santan',
    label: 'a pack',
    kind: 'cooking',
    aliases: ['kotak', 'kotak santan', 'pek santan'],
    grams: 200,
    ml: 200,
    note: 'Santan pack, 200 ml (about 400 kcal). Mini packs are 65 ml.',
  },
  {
    id: 'whole-chicken',
    label: 'a whole chicken',
    kind: 'cooking',
    aliases: ['ekor', 'seekor', 'ekor ayam', 'whole chicken'],
    grams: 1500,
    note: 'One ekor as sold, about 1.5 kg with bones and about 1 kg edible with skin (about 2,150 kcal).',
  },
  {
    id: 'pot',
    label: 'a pot',
    kind: 'cooking',
    aliases: ['pot', 'periuk', 'seperiuk'],
    grams: 2500,
    note: 'A family pot of curry, 6–10 servings, about 2.5 kg cooked.',
  },

  // Drinks
  {
    id: 'cup',
    label: 'a cup',
    kind: 'drink',
    aliases: ['cup', 'cawan', 'secawan'],
    ml: 250,
    note: 'Hot drink cup at a mamak or kopitiam, 200–250 ml. In recipes a cawan is 250 ml.',
  },
  {
    id: 'glass',
    label: 'a glass',
    kind: 'drink',
    aliases: ['glass', 'gelas', 'segelas'],
    ml: 300,
    note: 'Iced drink glass, about 300 ml including ice (about 250 ml of drink).',
  },
  {
    id: 'glass-besar',
    label: 'a glass',
    kind: 'drink',
    aliases: ['besar', 'jumbo', 'tarik besar', 'gelas besar', 'tall glass'],
    ml: 500,
    note: 'Besar or jumbo glass, about 500 ml: roughly 1.5 normal glasses of drink.',
  },
  {
    id: 'mug',
    label: 'a mug',
    kind: 'drink',
    aliases: ['mug', 'kole'],
    ml: 450,
    note: 'Big mug or besar hot drink, about 450 ml.',
  },
  {
    id: 'bag',
    label: 'a bag',
    kind: 'drink',
    aliases: ['ikat tepi', 'bungkus air', 'plastik', 'bag'],
    ml: 450,
    note: 'Takeaway drink bag, 400–500 ml.',
  },
  {
    id: 'can-drink',
    label: 'a can',
    kind: 'drink',
    aliases: ['can', 'tin air', 'canned drink'],
    ml: 325,
    note: 'Malaysian drink cans are usually 325 ml.',
  },
  {
    id: 'bottle',
    label: 'a bottle',
    kind: 'drink',
    aliases: ['bottle', 'botol', 'sebotol'],
    ml: 500,
    note: 'Drink bottle, usually 500 ml.',
  },
];

const BY_ID = new Map(PORTION_UNITS.map((unit) => [unit.id, unit]));

export function portionUnit(id: string): PortionUnit | undefined {
  return BY_ID.get(id);
}

/** Units whose aliases include this word ("sudu", "tin", "ketul"). A word can mean more than one unit. */
export function findPortionUnits(word: string): PortionUnit[] {
  const w = word.trim().toLowerCase();
  if (!w) return [];
  return PORTION_UNITS.filter((unit) => unit.aliases.includes(w));
}
