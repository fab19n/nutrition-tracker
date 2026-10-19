// @vitest-environment node
// Server code (Node dev server / Deno Edge Function): test with the runtime's own fetch classes.
import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
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

describe('toItems', () => {
  it('takes catalogue macros for matched items and picks the variant by label', () => {
    const { items, unmatched } = toItems(
      {
        mealName: 'Nasi kandar',
        items: [
          { catalogueId: 'kuah-campur', name: 'Kuah', variantLabel: 'banjir', quantity: 1, estimate: null, confidence: 'high', question: null },
          { catalogueId: 'teh-o-ais', name: 'Teh o ais', variantLabel: null, quantity: 2, estimate: null, confidence: 'medium', question: null },
        ],
      },
      CATALOGUE,
    );
    expect(unmatched).toEqual([]);
    expect(items[0]).toMatchObject({ catalogueId: 'kuah-campur', selectedVariant: 2, unitMacros: m(220), source: 'catalogue' });
    expect(items[1]).toMatchObject({ catalogueId: 'teh-o-ais', selectedVariant: 2, quantity: 2, source: 'catalogue' });
    expect(items[1]?.uncertainty).toBeCloseTo(0.2);
  });

  it('turns unknown or invented ids into AI guesses with size chips', () => {
    const { items, unmatched, questions } = toItems(
      {
        mealName: 'Durian crepe',
        items: [
          {
            catalogueId: 'made-up-id',
            name: 'Durian crepe',
            variantLabel: null,
            quantity: 1,
            estimate: { kcal: 420, proteinG: 6, carbsG: 50, fatG: 22 },
            confidence: 'low',
            question: null,
          },
        ],
      },
      CATALOGUE,
    );
    expect(unmatched).toEqual(['Durian crepe']);
    expect(items[0]).toMatchObject({ source: 'aiGuess', selectedVariant: 1, uncertainty: 0.4 });
    expect(items[0]?.variants?.map((v) => v.macros.kcal)).toEqual([294, 420, 588]);
    expect(questions).toHaveLength(1);
  });

  it('keeps at most two questions', () => {
    const q = (id: string) => ({ catalogueId: id, name: id, variantLabel: null, quantity: 1, estimate: null, confidence: 'medium' as const, question: 'How much?' });
    const { questions, items } = toItems({ mealName: 'x', items: [q('kuah-campur'), q('teh-o-ais'), q('kuah-campur')] }, CATALOGUE);
    expect(questions).toHaveLength(2);
    expect(items.filter((i) => i.question)).toHaveLength(2);
  });

  it('ignores nonsense quantities', () => {
    const { items } = toItems(
      { mealName: 'x', items: [{ catalogueId: 'teh-o-ais', name: 'Teh', variantLabel: null, quantity: -3, estimate: null, confidence: 'high', question: null }] },
      CATALOGUE,
    );
    expect(items[0]?.quantity).toBe(1);
  });
});

describe('buildSystemPrompt', () => {
  it('is deterministic so the prompt cache can hit', () => {
    expect(buildSystemPrompt(CATALOGUE)).toBe(buildSystemPrompt(CATALOGUE));
    expect(buildSystemPrompt(CATALOGUE)).toContain('teh-o-ais | Teh o ais | - | a cup | Kosong=5, Kurang=60, Normal=110*');
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

  it('rejects unsupported image types', async () => {
    const form = new FormData();
    form.append('request', '{}');
    form.append('photo', new File(['x'], 'a.txt', { type: 'text/plain' }));
    await expect(readEstimateRequest(new Request('http://x', { method: 'POST', body: form }))).rejects.toThrow('Unsupported image type');
  });
});
