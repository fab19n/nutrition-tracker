import type { CatalogueItem, Macros } from '@/domain/types';
import {
  CATALOGUE,
  NAME_INDEX,
  PLATE_BASE_IDS,
  byId,
  defaultVariantOf,
  findByName,
  normaliseName,
  searchCatalogue,
  trayDishes,
} from './catalogue';
import { ALIAS_CHIPS, aliasChip } from './aliasChips';
import { PORTION_UNITS } from './portionUnits';

function item(id: string): CatalogueItem {
  const found = byId(id);
  if (!found) throw new Error(`Missing catalogue item ${id}`);
  return found;
}

function kcalOf(id: string, label?: string): number {
  const it = item(id);
  const v = label === undefined ? defaultVariantOf(it) : it.variants.find((x) => x.label === label);
  if (!v) throw new Error(`Missing variant ${label ?? '(default)'} on ${id}`);
  return v.macros.kcal;
}

/** Atwater energy from macros. */
function atwater(m: Macros): number {
  return 4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG;
}

const everyVariant = CATALOGUE.flatMap((it) => it.variants.map((v) => ({ id: it.id, v })));

describe('catalogue shape', () => {
  it('has at least 150 entries', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique kebab-case ids', () => {
    const ids = CATALOGUE.map((it) => it.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('uses sentence-case names', () => {
    for (const it of CATALOGUE) {
      expect(it.name.trim()).toBe(it.name);
      const first = it.name.charAt(0);
      expect(first, it.id).toBe(first.toUpperCase());
    }
  });

  it('has at least one variant per item, with unique ids and labels', () => {
    for (const it of CATALOGUE) {
      expect(it.variants.length, it.id).toBeGreaterThan(0);
      const ids = it.variants.map((v) => v.id);
      const labels = it.variants.map((v) => v.label);
      expect(new Set(ids).size, it.id).toBe(ids.length);
      expect(new Set(labels).size, it.id).toBe(labels.length);
      for (const v of it.variants) {
        expect(v.id, it.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(v.label.length, it.id).toBeGreaterThan(0);
      }
    }
  });

  it('has a defaultVariant in range', () => {
    for (const it of CATALOGUE) {
      expect(Number.isInteger(it.defaultVariant), it.id).toBe(true);
      expect(it.defaultVariant, it.id).toBeGreaterThanOrEqual(0);
      expect(it.defaultVariant, it.id).toBeLessThan(it.variants.length);
    }
  });

  it('has lowercase, trimmed, unique aliases', () => {
    for (const it of CATALOGUE) {
      expect(new Set(it.aliases).size, it.id).toBe(it.aliases.length);
      for (const alias of it.aliases) {
        expect(alias, it.id).toBe(alias.toLowerCase());
        expect(alias, it.id).toBe(alias.trim());
        expect(normaliseName(alias).length, `${it.id}: "${alias}"`).toBeGreaterThan(0);
      }
    }
  });

  it('marks every entry as a catalogue estimate with a sensible range and a note', () => {
    for (const it of CATALOGUE) {
      expect(it.source, it.id).toBe('catalogue');
      expect(it.uncertainty, it.id).toBeGreaterThanOrEqual(0.15);
      expect(it.uncertainty, it.id).toBeLessThanOrEqual(0.35);
      expect(it.note?.length ?? 0, it.id).toBeGreaterThan(0);
    }
  });

  it('uses unit wording from the portion dictionary', () => {
    const labels = new Set(PORTION_UNITS.map((u) => u.label));
    for (const it of CATALOGUE) expect(labels.has(it.unit), `${it.id}: ${it.unit}`).toBe(true);
  });

  it('asks follow-up questions as questions', () => {
    for (const it of CATALOGUE) {
      if (it.question === undefined) continue;
      expect(it.question, it.id).toMatch(/^[A-Z].*\?$/);
      expect(it.variants.length, `${it.id} needs answer chips`).toBeGreaterThan(1);
    }
  });

  it('follows the copy guide in names, notes and questions', () => {
    const avoid = /\b(please|successfully|bad|junk|unhealthy|cheat|guilty|naughty|exact|precise)\b|!/i;
    for (const it of CATALOGUE) {
      for (const text of [it.name, it.note ?? '', it.question ?? '', ...it.variants.map((v) => v.label)]) {
        expect(text, it.id).not.toMatch(avoid);
      }
    }
  });
});

describe('catalogue values', () => {
  it('has non-negative macros and whole-number kcal', () => {
    for (const { id, v } of everyVariant) {
      const { kcal, proteinG, carbsG, fatG } = v.macros;
      expect(Number.isInteger(kcal), `${id} ${v.label}`).toBe(true);
      for (const n of [kcal, proteinG, carbsG, fatG]) expect(n, `${id} ${v.label}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps kcal within 15% of 4P + 4C + 9F for every variant', () => {
    const off = everyVariant
      .map(({ id, v }) => ({ id, label: v.label, kcal: v.macros.kcal, atwater: atwater(v.macros) }))
      // A 2 kcal floor absorbs rounding on near-zero drinks (kosong, zero sugar).
      .filter((r) => Math.abs(r.kcal - r.atwater) > Math.max(0.15 * r.kcal, 2));
    expect(off).toEqual([]);
  });

  it('orders size choices from small to big', () => {
    const sizeSets = [
      ['Small', 'Normal', 'Mamak big'],
      ['Small', 'Normal', 'Big'],
      ['Half', '1 scoop', '1.5 scoops'],
      ['Sikit', 'Normal', 'Banjir'],
      ['Kosong', 'Kurang', 'Normal'],
    ];
    for (const it of CATALOGUE) {
      const labels = it.variants.map((v) => v.label);
      if (!sizeSets.some((set) => set.every((l, i) => labels[i] === l))) continue;
      const kcals = it.variants.map((v) => v.macros.kcal);
      for (let i = 1; i < kcals.length; i++) expect(kcals[i], it.id).toBeGreaterThan(kcals[i - 1] ?? 0);
    }
  });
});

describe('swaps', () => {
  it('reference existing, different, lighter items', () => {
    for (const it of CATALOGUE) {
      for (const swapId of it.swaps ?? []) {
        const swap = byId(swapId);
        expect(swap, `${it.id} → ${swapId}`).toBeDefined();
        if (!swap) continue;
        expect(swapId, it.id).not.toBe(it.id);
        expect(defaultVariantOf(swap).macros.kcal, `${it.id} → ${swapId}`).toBeLessThan(defaultVariantOf(it).macros.kcal);
      }
    }
  });
});

describe('plate builder trays', () => {
  it('has at least 10 tray dishes, one variant each, in every group', () => {
    const trays = trayDishes();
    expect(trays.length).toBeGreaterThanOrEqual(10);
    for (const it of trays) {
      expect(it.variants, it.id).toHaveLength(1);
      expect(it.category, it.id).toBe(it.plateGroup);
    }
    for (const group of ['protein', 'vegetables', 'tofuEgg'] as const) {
      expect(trayDishes(group).length, group).toBeGreaterThan(0);
    }
  });

  it('lists the design grid first in each group', () => {
    const ids = (group: 'protein' | 'vegetables' | 'tofuEgg') => trayDishes(group).map((it) => it.id);
    expect(ids('protein').slice(0, 4)).toEqual(['ayam-goreng-tray', 'ayam-masak-merah', 'ikan-goreng', 'telur-dadar']);
    expect(ids('vegetables').slice(0, 4)).toEqual(['kangkung-belacan', 'kubis-goreng', 'terung-sambal', 'taugeh']);
    expect(ids('tofuEgg').slice(0, 2)).toEqual(['tauhu-goreng', 'telur-rebus']);
  });

  it('has bases that exist', () => {
    for (const id of PLATE_BASE_IDS) expect(byId(id), id).toBeDefined();
  });
});

describe('required entries (design and demo data depend on these)', () => {
  type Expect = {
    id: string;
    name?: string;
    unit?: string;
    choices: [label: string, kcal: number][];
    defaultVariant?: number;
    plateGroup?: CatalogueItem['plateGroup'];
    question?: string;
    swaps?: string[];
  };

  const tray = (id: string, name: string, kcal: number, unit: string, plateGroup: Expect['plateGroup']): Expect => ({
    id,
    name,
    unit,
    choices: [[unit === 'an egg' ? '1 egg' : unit === 'a scoop' ? '1 scoop' : '1 piece', kcal]],
    plateGroup,
  });

  const required: Expect[] = [
    { id: 'rice-economy', name: 'Rice (economy rice)', choices: [['Half', 100], ['1 scoop', 200], ['1.5 scoops', 300]], defaultVariant: 1 },
    { id: 'kuah-on-rice', name: 'Kuah on rice', choices: [['None', 0], ['Some', 60], ['Banjir', 140]], defaultVariant: 1 },
    tray('ayam-goreng-tray', 'Ayam goreng', 280, 'a piece', 'protein'),
    tray('ayam-masak-merah', 'Ayam masak merah', 250, 'a piece', 'protein'),
    tray('ikan-goreng', 'Ikan goreng', 200, 'a piece', 'protein'),
    tray('telur-dadar', 'Telur dadar', 180, 'a piece', 'protein'),
    tray('kangkung-belacan', 'Kangkung belacan', 90, 'a scoop', 'vegetables'),
    tray('kubis-goreng', 'Kubis goreng', 70, 'a scoop', 'vegetables'),
    tray('terung-sambal', 'Terung sambal', 120, 'a scoop', 'vegetables'),
    tray('taugeh', 'Taugeh', 60, 'a scoop', 'vegetables'),
    tray('tauhu-goreng', 'Tauhu goreng', 110, 'a piece', 'tofuEgg'),
    tray('telur-rebus', 'Telur rebus', 80, 'an egg', 'tofuEgg'),
    { id: 'rice-nasi-kandar', name: 'Rice (nasi kandar)', choices: [['Small', 250], ['Normal', 330], ['Mamak big', 430]], defaultVariant: 1 },
    { id: 'ayam-goreng-mamak', name: 'Ayam goreng', choices: [['1 piece', 300], ['2 pieces', 600]], defaultVariant: 0 },
    { id: 'kubis', name: 'Kubis', choices: [['1 scoop', 70]] },
    {
      id: 'kuah-campur',
      name: 'Kuah campur',
      choices: [['Sikit', 60], ['Normal', 120], ['Banjir', 220]],
      defaultVariant: 1,
      question: 'Is there kuah under the rice?',
    },
    { id: 'teh-o-ais', name: 'Teh o ais', choices: [['Kosong', 5], ['Kurang', 60], ['Normal', 110]], defaultVariant: 2 },
    { id: 'teh-tarik', name: 'Teh tarik', choices: [['Kosong', 70], ['Kurang', 140], ['Normal', 200]], defaultVariant: 2 },
    { id: 'roti-canai-dhal', name: 'Roti canai + dhal', choices: [['1 piece', 360], ['2 pieces', 720]], defaultVariant: 0 },
    { id: 'mee-sup-ayam', name: 'Mee sup ayam', choices: [['Small', 350], ['Normal', 430], ['Mamak big', 560]], defaultVariant: 1 },
    { id: 'omelette', name: 'Omelette', choices: [['2 eggs', 190], ['3 eggs', 280]] },
  ];

  it.each(required)('$id', (spec) => {
    const it = item(spec.id);
    if (spec.name !== undefined) expect(it.name).toBe(spec.name);
    if (spec.unit !== undefined) expect(it.unit).toBe(spec.unit);
    expect(it.variants.map((v) => [v.label, v.macros.kcal])).toEqual(spec.choices);
    if (spec.defaultVariant !== undefined) expect(it.defaultVariant).toBe(spec.defaultVariant);
    if (spec.plateGroup !== undefined) expect(it.plateGroup).toBe(spec.plateGroup);
    if (spec.question !== undefined) expect(it.question).toBe(spec.question);
  });

  it('has the default kcal the design uses', () => {
    expect(kcalOf('roti-telur-dhal')).toBe(420);
    expect(kcalOf('mee-goreng-mamak')).toBe(830);
    expect(kcalOf('milo-ais')).toBe(250);
    expect(kcalOf('ayam-bakar')).toBe(290);
    expect(kcalOf('ulam-sambal')).toBe(150);
    expect(kcalOf('sayur-goreng')).toBe(130);
    expect(kcalOf('nasi-lemak-bungkus')).toBe(490);
    expect(kcalOf('kaya-toast-kopi')).toBe(380);
    expect(item('ulam-sambal').name).toBe('Ulam + sambal');
    expect(item('kaya-toast-kopi').name).toBe('Bread, kaya, kopi');
    expect(item('roti-telur-dhal').name).toBe('Roti telur + dhal');
  });

  it('gives milo ais kosong and kurang choices below normal', () => {
    expect(item('milo-ais').variants.map((v) => v.label)).toEqual(['Kosong', 'Kurang', 'Normal']);
    expect(defaultVariantOf(item('milo-ais')).label).toBe('Normal');
  });

  it('offers mee sup ayam as the lighter swap for mee goreng mamak', () => {
    expect(item('mee-goreng-mamak').swaps).toEqual(['mee-sup-ayam']);
  });

  it('has home dishes per senduk', () => {
    for (const id of ['kari-ayam-home', 'sayur-lodeh', 'ikan-masak-kicap']) {
      expect(item(id).unit, id).toBe('a senduk');
      expect(item(id).category, id).toBe('home');
    }
  });

  it('adds up to the design sample meals', () => {
    // S11 text review: rice normal, ayam goreng, kubis, kuah campur normal, teh o ais kurang.
    expect(
      kcalOf('rice-nasi-kandar', 'Normal') +
        kcalOf('ayam-goreng-mamak', '1 piece') +
        kcalOf('kubis') +
        kcalOf('kuah-campur', 'Normal') +
        kcalOf('teh-o-ais', 'Kurang'),
    ).toBe(880);
    // S24 plate: 1 scoop, ayam masak merah, kangkung belacan, kubis goreng, kuah some.
    expect(
      kcalOf('rice-economy', '1 scoop') +
        kcalOf('ayam-masak-merah') +
        kcalOf('kangkung-belacan') +
        kcalOf('kubis-goreng') +
        kcalOf('kuah-on-rice', 'Some'),
    ).toBe(670);
    // Usual at Nasi kandar near home: mamak big rice, ayam goreng, kuah banjir.
    expect(kcalOf('rice-nasi-kandar', 'Mamak big') + kcalOf('ayam-goreng-mamak', '1 piece') + kcalOf('kuah-campur', 'Banjir')).toBe(950);
    // Breakfast: roti canai + dhal and teh tarik.
    expect(kcalOf('roti-canai-dhal', '1 piece') + kcalOf('teh-tarik', 'Normal')).toBe(560);
    // S36 ideas.
    expect(kcalOf('ayam-bakar') + kcalOf('rice-economy', 'Half') + kcalOf('ulam-sambal')).toBe(540);
    expect(kcalOf('omelette', '3 eggs') + kcalOf('sayur-goreng') + kcalOf('rice-economy', 'Half')).toBe(510);
    expect(kcalOf('mee-goreng-mamak') - kcalOf('mee-sup-ayam')).toBe(400);
  });

  it('keeps the design sample meals at ±15% so their ranges match (880 → 750–1,010, 670 → 570–770)', () => {
    const sampleItems = [
      'rice-nasi-kandar',
      'ayam-goreng-mamak',
      'kubis',
      'kuah-campur',
      'teh-o-ais',
      'rice-economy',
      'ayam-masak-merah',
      'kangkung-belacan',
      'kubis-goreng',
      'kuah-on-rice',
    ];
    for (const id of sampleItems) expect(item(id).uncertainty, id).toBe(0.15);
  });
});

describe('alias chips', () => {
  it('name an alias of the item and one of its chips', () => {
    for (const [id, aliases] of Object.entries(ALIAS_CHIPS)) {
      const it = item(id);
      const names = new Set([it.name, ...it.aliases].map(normaliseName));
      for (const [alias, label] of Object.entries(aliases)) {
        expect(names.has(alias), `${id}: "${alias}"`).toBe(true);
        expect(it.variants.map((v) => v.label), `${id}: "${alias}"`).toContain(label);
        expect(aliasChip(id, alias)).toBe(label);
      }
    }
  });
});

describe('lookup helpers', () => {
  it('finds items by id', () => {
    expect(byId('teh-tarik')?.name).toBe('Teh tarik');
    expect(byId('nope')).toBeUndefined();
  });

  it('normalises case, accents, punctuation and spacing', () => {
    expect(normaliseName('  Teh-O   Ais ')).toBe('teh o ais');
    expect(normaliseName('Roti canai + dhal')).toBe('roti canai dhal');
    expect(normaliseName('Café latte')).toBe('cafe latte');
    expect(normaliseName("Ladies' fingers")).toBe('ladies fingers');
    expect(normaliseName('F&N')).toBe('f and n');
  });

  it('indexes names and aliases, including common spellings', () => {
    expect(NAME_INDEX.get('teh o ice')).toContain('teh-o-ais');
    expect(NAME_INDEX.get('teh o')).toContain('teh-o');
    expect(NAME_INDEX.get('kopi o')).toContain('kopi-o');
    expect(NAME_INDEX.get('maggi')).toContain('maggi-goreng');
    expect(NAME_INDEX.get('ayam goreng')).toEqual(['ayam-goreng-tray', 'ayam-goreng-mamak']);
  });

  it('matches exact names and aliases through findByName', () => {
    expect(findByName('Teh-O ice').map((it) => it.id)).toEqual(['teh-o-ais']);
    expect(findByName('roti canai + dhal').map((it) => it.id)).toEqual(['roti-canai-dhal']);
    expect(findByName('something else')).toEqual([]);
  });

  it('ranks search results: exact, then prefix, then word prefix', () => {
    expect(searchCatalogue('teh o')[0]?.id).toBe('teh-o');
    expect(searchCatalogue('roti')[0]?.id).toBe('roti-canai');
    expect(searchCatalogue('canai')[0]?.id).toBe('roti-canai');
    expect(searchCatalogue('kangkung')[0]?.id).toBe('kangkung-belacan');
    expect(searchCatalogue('laksa', 3).map((it) => it.id)).toEqual(['curry-laksa', 'asam-laksa']);
    expect(searchCatalogue('mee', 5)).toHaveLength(5);
    expect(searchCatalogue('   ')).toEqual([]);
    expect(searchCatalogue('teh', 0)).toEqual([]);
  });

  it('returns the default variant', () => {
    expect(defaultVariantOf(item('rice-economy')).label).toBe('1 scoop');
    expect(defaultVariantOf(item('teh-o-ais')).label).toBe('Normal');
  });
});
