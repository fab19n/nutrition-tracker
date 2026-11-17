// @vitest-environment node
// Server code (Node dev server / Deno Edge Function): test with the runtime's own fetch classes.
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  estimateMeal,
  readEstimateRequest,
  toItems,
  type CatalogueEntry,
} from '../supabase/functions/estimate/core';

const m = (kcal: number) => ({ kcal, proteinG: 0, carbsG: 0, fatG: 0 });

const CATALOGUE: CatalogueEntry[] = [
  {
    id: 'kuah-campur',
    name: 'Kuah campur',
    aliases: ['mixed curry'],
    category: 'gravy',
    unit: 'a ladle',
    variants: [
      { id: 'sikit', label: 'Sikit', macros: m(60) },
      { id: 'normal', label: 'Normal', macros: m(120) },
      { id: 'banjir', label: 'Banjir', macros: m(220) },
    ],
    defaultVariant: 1,
    uncertainty: 0.25,
  },
  {
    id: 'teh-o-ais',
    name: 'Teh o ais',
    aliases: [],
    category: 'drinks',
    unit: 'a cup',
    variants: [
      { id: 'kosong', label: 'Kosong', macros: m(5) },
      { id: 'kurang', label: 'Kurang', macros: m(60) },
      { id: 'normal', label: 'Normal', macros: m(110) },
    ],
    defaultVariant: 2,
    uncertainty: 0.15,
  },
];

type Parsed = Parameters<typeof toItems>[0]['items'][number];

/** One item as the model returns it: what it saw, a name, the grams, then the catalogue match (or null). */
function parsed(item: Partial<Parsed> & Pick<Parsed, 'name'>): Parsed {
  return {
    seen: item.name,
    grams: 100,
    catalogueId: null,
    variantLabel: null,
    quantity: 1,
    estimate: null,
    label: null,
    labelAmount: null,
    confidence: 'high',
    question: null,
    ...item,
  };
}

describe('toItems', () => {
  it('takes catalogue macros for matched items and picks the variant by label', () => {
    const { items, unmatched } = toItems(
      {
        mealName: 'Nasi kandar',
        items: [
          parsed({ catalogueId: 'kuah-campur', name: 'Kuah', variantLabel: 'banjir' }),
          parsed({ catalogueId: 'teh-o-ais', name: 'Teh o ais', quantity: 2, confidence: 'medium' }),
        ],
      },
      CATALOGUE,
    );
    expect(unmatched).toEqual([]);
    expect(items[0]).toMatchObject({ catalogueId: 'kuah-campur', selectedVariant: 2, unitMacros: m(220), source: 'catalogue' });
    expect(items[1]).toMatchObject({ catalogueId: 'teh-o-ais', selectedVariant: 2, quantity: 2, source: 'catalogue' });
    expect(items[1]?.uncertainty).toBeCloseTo(0.2);
  });

  it('names a catalogue item by what the model saw but prices it from the catalogue', () => {
    const { items } = toItems(
      { mealName: 'Tea', items: [parsed({ catalogueId: 'teh-o-ais', name: 'Teh o limau panas', grams: 250, variantLabel: 'Kosong' })] },
      CATALOGUE,
    );
    expect(items[0]).toMatchObject({ name: 'Teh o limau panas', catalogueId: 'teh-o-ais', unitMacros: m(5), source: 'catalogue', portionGrams: 250 });
  });

  it('falls back to the catalogue name when the model gives none', () => {
    const { items } = toItems({ mealName: 'Tea', items: [parsed({ catalogueId: 'teh-o-ais', name: '  ' })] }, CATALOGUE);
    expect(items[0]?.name).toBe('Teh o ais');
  });

  it('turns unknown or invented ids into AI guesses with size chips', () => {
    const { items, unmatched, questions } = toItems(
      {
        mealName: 'Durian crepe',
        items: [
          parsed({
            catalogueId: 'made-up-id',
            name: 'Durian crepe',
            grams: 180,
            estimate: { kcal: 420, proteinG: 6, carbsG: 50, fatG: 22 },
            confidence: 'low',
          }),
        ],
      },
      CATALOGUE,
    );
    expect(unmatched).toEqual(['Durian crepe']);
    expect(items[0]).toMatchObject({ source: 'aiGuess', selectedVariant: 1, uncertainty: 0.4 });
    expect(items[0]?.variants?.map((v) => v.macros.kcal)).toEqual([294, 420, 588]);
    expect(items[0]?.unitMacros).toEqual({ kcal: 420, proteinG: 6, carbsG: 50, fatG: 22 });
    // No question of its own: the size chips and the amber ring already cover "how big".
    expect(items[0]?.question).toBeUndefined();
    expect(questions).toHaveLength(0);
  });

  it('keeps what the model took the portion to weigh, for a dish the catalogue does not have', () => {
    const { items, unmatched } = toItems(
      {
        mealName: 'Plate',
        items: [parsed({ name: 'Mutton varuval', grams: 140, estimate: { kcal: 330, proteinG: 26, carbsG: 6, fatG: 22 }, confidence: 'medium' })],
      },
      CATALOGUE,
    );
    expect(unmatched).toEqual(['Mutton varuval']);
    expect(items[0]).toMatchObject({ name: 'Mutton varuval', source: 'aiGuess', portionGrams: 140, uncertainty: 0.3 });
  });

  it('keeps no portion when the weight is missing or nonsense', () => {
    const { items } = toItems(
      { mealName: 'x', items: [parsed({ catalogueId: 'teh-o-ais', name: 'Teh', grams: 0 }), parsed({ catalogueId: 'teh-o-ais', name: 'Teh', grams: -5 })] },
      CATALOGUE,
    );
    expect(items.map((i) => i.portionGrams)).toEqual([undefined, undefined]);
  });

  it('keeps at most two questions', () => {
    const q = (id: string) => parsed({ catalogueId: id, name: id, confidence: 'medium', question: 'How much?' });
    const { questions, items } = toItems({ mealName: 'x', items: [q('kuah-campur'), q('teh-o-ais'), q('kuah-campur')] }, CATALOGUE);
    expect(questions).toHaveLength(2);
    expect(items.filter((i) => i.question)).toHaveLength(2);
  });

  it('keeps a fraction of a unit read from a photo', () => {
    const { items } = toItems({ mealName: 'x', items: [parsed({ catalogueId: 'teh-o-ais', name: 'Teh', quantity: 0.5, confidence: 'medium' })] }, CATALOGUE);
    expect(items[0]?.quantity).toBe(0.5);
  });

  it('ignores nonsense quantities', () => {
    const { items } = toItems({ mealName: 'x', items: [parsed({ catalogueId: 'teh-o-ais', name: 'Teh', quantity: -3 })] }, CATALOGUE);
    expect(items[0]?.quantity).toBe(1);
  });
});

describe('buildSystemPrompt', () => {
  it('lists the catalogue compactly, grouped by category', () => {
    const prompt = buildSystemPrompt(CATALOGUE);
    expect(prompt).toBe(buildSystemPrompt(CATALOGUE));
    expect(prompt).toContain('[gravy]\nkuah-campur ~ mixed curry: Sikit=60 | Normal=120* | Banjir=220');
    expect(prompt).toContain('[drinks]\nteh-o-ais: Kosong=5 | Kurang=60 | Normal=110*');
  });

  it('shows a name only when it differs from the id, and skips aliases that add nothing', () => {
    const entry: CatalogueEntry = {
      id: 'ayam-goreng-mamak',
      name: 'Ayam goreng',
      aliases: ['ayam goreng', 'ayamgoreng', 'goreng ayam', 'fried chicken', 'ayam goreng kandar', 'ayam goreng berempah', 'kfc style'],
      category: 'protein',
      unit: 'a piece',
      variants: [{ id: 'one', label: '1 piece', macros: m(300) }],
      defaultVariant: 0,
      uncertainty: 0.2,
    };
    // 'ayam goreng', 'ayamgoreng' and 'goreng ayam' only repeat the id's words; at most 3 are kept.
    // A single choice shows its label without kcal or a default mark.
    expect(buildSystemPrompt([entry])).toContain(
      '[protein]\nayam-goreng-mamak (Ayam goreng) ~ fried chicken, ayam goreng kandar, ayam goreng berempah: 1 piece',
    );
  });

  it('has photos set portions, with fractions, grams for every item, and questions only about what a photo cannot show', () => {
    const prompt = buildSystemPrompt(CATALOGUE);
    expect(prompt).toContain('choose the variant that matches what you see');
    expect(prompt).toContain('a half-full glass = 0.5');
    expect(prompt).toContain('using things of known size for scale');
    expect(prompt).toContain('For every item give grams');
    expect(prompt).toContain('work out the weight in grams first');
    expect(prompt).toContain('Never ask about what the photo already shows.');
    expect(prompt).not.toContain('conservatively');
  });

  it('has the model say what is there before it looks at the catalogue, and use it only for dishes it really holds', () => {
    const prompt = buildSystemPrompt(CATALOGUE);
    expect(prompt).toContain('Look first, then label.');
    expect(prompt).toContain('not your vocabulary and not a list of answers');
    expect(prompt).toContain('only when the item IS that dish');
    expect(prompt).toContain('A wrong match is worse than none.');
    expect(prompt).toContain('List each food once');
    // Plain names: a stir-fried vegetable is never renamed in the plate's regional style.
    expect(prompt).toContain('"Stir-fried cabbage"');
    expect(prompt).toContain('never "cabbage poriyal"');
    expect(prompt).toContain('The cuisine of the rest of the plate never changes how a vegetable is named.');
    // The home plates and drinks that used to land on the nearest catalogue dish.
    expect(prompt).toContain('varuval');
    expect(prompt).toContain('dhal (often with bayam or other greens)');
    expect(prompt).toContain('a clear amber or yellow drink with a slice of lemon or ginger is tea, not coffee');
  });

  it('leaves recipe-only pot ingredients out of the meal prompt', () => {
    const santan: CatalogueEntry = {
      id: 'santan',
      name: 'Santan',
      aliases: ['coconut milk'],
      category: 'other',
      unit: 'a can',
      variants: [{ id: 'can', label: '1 can', macros: m(800) }],
      defaultVariant: 0,
      uncertainty: 0.15,
    };
    expect(buildSystemPrompt([...CATALOGUE, santan])).not.toContain('santan');
  });
});

describe('readEstimateRequest', () => {
  it('reads the app payload: place without a name, variant indexes and candidates', async () => {
    const req = new Request('http://x/api/estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'nasi kandar, kuah campur banjir',
        slot: 'dinner',
        place: { type: 'mamak', oilLevel: 'high', defaultVariants: { 'kuah-campur': 2, bad: 'x' } },
        candidates: [{ catalogueId: 'kuah-campur', selectedVariant: 2, quantity: 1, source: 'catalogue' }, { nope: true }],
      }),
    });
    const input = await readEstimateRequest(req);
    expect(input.place).toEqual({ type: 'mamak', oilLevel: 'high', defaultVariants: { 'kuah-campur': 2 } });
    expect(input.candidates).toEqual([{ catalogueId: 'kuah-campur', selectedVariant: 2, quantity: 1, source: 'catalogue' }]);
    expect(input.text).toBe('nasi kandar, kuah campur banjir');
  });

  it('reads a multipart photo request', async () => {
    const form = new FormData();
    form.append('request', JSON.stringify({ caption: 'kuah banjir' }));
    form.append('photo', new File([new Uint8Array([1, 2, 3])], 'meal.jpg', { type: 'image/jpeg' }));
    const input = await readEstimateRequest(new Request('http://x', { method: 'POST', body: form }));
    expect(input.caption).toBe('kuah banjir');
    expect(input.image).toEqual({ mediaType: 'image/jpeg', base64: 'AQID' });
  });

  it('reads a label photo next to the meal photo, or on its own', async () => {
    const form = new FormData();
    form.append('request', JSON.stringify({ caption: '1 tbsp' }));
    form.append('label', new File([new Uint8Array([4, 5, 6])], 'label.jpg', { type: 'image/jpeg' }));
    const input = await readEstimateRequest(new Request('http://x', { method: 'POST', body: form }));
    expect(input.image).toBeUndefined();
    expect(input.labelImage).toEqual({ mediaType: 'image/jpeg', base64: 'BAUG' });
  });

  it('rejects unsupported image types', async () => {
    const form = new FormData();
    form.append('request', '{}');
    form.append('photo', new File(['x'], 'a.txt', { type: 'text/plain' }));
    await expect(readEstimateRequest(new Request('http://x', { method: 'POST', body: form }))).rejects.toThrow('Unsupported image type');
  });
});

const LABEL_MACROS = (kcal: number, proteinG: number, carbsG: number, fatG: number) => ({ kcal, proteinG, carbsG, fatG });

/** A parsed item read off a nutrition label. */
function fromLabel(label: Record<string, unknown>, labelAmount: { servings: number | null; amount: number | null }, confidence: 'high' | 'medium' | 'low' = 'high') {
  return parsed({
    name: 'Bun',
    label: { productName: 'Gardenia Butterscotch bun', unit: 'g' as const, servingSize: null, per100: null, perServing: null, ...label },
    labelAmount,
    confidence,
  });
}

describe('toItems from a nutrition label', () => {
  it('counts servings against the per-serving column', () => {
    const { items, unmatched } = toItems(
      {
        mealName: 'Bun',
        items: [fromLabel({ servingSize: 70, per100: LABEL_MACROS(314, 7, 50, 9), perServing: LABEL_MACROS(220, 5, 35, 6) }, { servings: 2, amount: null })],
      },
      CATALOGUE,
    );
    expect(unmatched).toEqual([]);
    expect(items[0]).toMatchObject({
      name: 'Gardenia Butterscotch bun',
      source: 'label',
      selectedVariant: 0,
      quantity: 2,
      uncertainty: 0.05,
      unitMacros: LABEL_MACROS(220, 5, 35, 6),
    });
    expect(items[0]?.variants?.map((v) => v.label)).toEqual(['1 serving · 70 g', '100 g']);
  });

  it('scales the per-100 g column to the amount eaten: a tablespoon from a tub', () => {
    const { items } = toItems(
      { mealName: 'Yogurt', items: [fromLabel({ productName: 'Greek yogurt', per100: LABEL_MACROS(97, 9, 4, 5) }, { servings: null, amount: 20 }, 'medium')] },
      CATALOGUE,
    );
    expect(items[0]).toMatchObject({ name: 'Greek yogurt', source: 'label', quantity: 1, uncertainty: 0.15, unitMacros: { kcal: 19, proteinG: 2, carbsG: 1, fatG: 1 } });
    expect(items[0]?.variants?.map((v) => [v.label, v.grams, v.macros.kcal])).toEqual([
      ['20 g', 20, 19],
      ['100 g', 100, 97],
    ]);
  });

  it('works out the missing column from the serving size', () => {
    const { items } = toItems(
      { mealName: 'Chips', items: [fromLabel({ unit: 'g', servingSize: 30, perServing: LABEL_MACROS(150, 2, 18, 8) }, { servings: null, amount: 45 })] },
      CATALOGUE,
    );
    expect(items[0]?.variants?.map((v) => [v.label, v.macros.kcal])).toEqual([
      ['45 g', 225],
      ['1 serving · 30 g', 150],
      ['100 g', 500],
    ]);
  });

  it('takes one serving when the amount is unknown, and says ml for drinks', () => {
    const { items } = toItems(
      { mealName: 'Milk', items: [fromLabel({ productName: 'Dutch Lady milk', unit: 'ml', servingSize: 200, perServing: LABEL_MACROS(130, 6, 10, 7) }, { servings: null, amount: null })] },
      CATALOGUE,
    );
    expect(items[0]).toMatchObject({ quantity: 1, unitMacros: LABEL_MACROS(130, 6, 10, 7) });
    expect(items[0]?.variants?.map((v) => v.label)).toEqual(['1 serving · 200 ml', '100 ml']);
  });

  it('falls back to an AI guess when the label has no usable numbers', () => {
    const unreadable = { ...fromLabel({}, { servings: 1, amount: null }), grams: 70, estimate: { kcal: 230, proteinG: 5, carbsG: 36, fatG: 7 } };
    const { items } = toItems({ mealName: 'Bun', items: [unreadable] }, CATALOGUE);
    expect(items[0]).toMatchObject({ source: 'aiGuess', unitMacros: { kcal: 230, proteinG: 5, carbsG: 36, fatG: 7 } });
  });
});

/** A client whose parse() records what it was sent and answers with an empty meal. */
function recordingClient() {
  const calls: { output_config: { effort: string }; messages: { content: { type: string; text?: string; source?: { data: string } }[] }[] }[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (args: (typeof calls)[number]) => {
          calls.push(args);
          return { stop_reason: 'end_turn', parsed_output: { mealName: 'x', items: [] }, model: 'm', usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe('estimateMeal with a label photo', () => {
  it('sends the food photo, then the label, and says which is which', async () => {
    const { client, calls } = recordingClient();
    await estimateMeal(
      { caption: '1 bun', image: { mediaType: 'image/jpeg', base64: 'FOOD' }, labelImage: { mediaType: 'image/jpeg', base64: 'LABEL' } },
      { client, catalogue: CATALOGUE },
    );
    const content = calls[0]?.messages[0]?.content ?? [];
    expect(content.map((c) => c.source?.data ?? c.type)).toEqual(['FOOD', 'LABEL', 'text']);
    expect(content[2]?.text).toContain('The first photo shows the food; the second is its nutrition label.');
  });
});

describe('estimateMeal effort', () => {
  it('thinks at medium effort when it has to read a plate, and at low effort for words alone', async () => {
    const { client, calls } = recordingClient();
    await estimateMeal({ image: { mediaType: 'image/jpeg', base64: 'PLATE' } }, { client, catalogue: CATALOGUE });
    await estimateMeal({ text: 'teh o ais' }, { client, catalogue: CATALOGUE });
    expect(calls.map((c) => c.output_config.effort)).toEqual(['medium', 'low']);
  });

  it('lets the caller choose', async () => {
    const { client, calls } = recordingClient();
    await estimateMeal({ image: { mediaType: 'image/jpeg', base64: 'PLATE' } }, { client, catalogue: CATALOGUE, effort: 'high' });
    expect(calls[0]?.output_config.effort).toBe('high');
  });
});
