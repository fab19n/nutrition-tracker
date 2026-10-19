import { buildDemoWorld, DEMO_EXPECTED } from '@/db/seed/demo';
import { GOAL_PRESETS } from '@/db/seed/defaults';
import { roundTo10 } from './format';
import { itemMacros, sumMacros } from './meal';
import { ideasMode, suggestMeals, surprisePick, type SuggestionInput } from './suggestions';
import type { SuggestionEvent } from './types';

const world = buildDemoWorld();

/** Friday 16 Oct, 7:10pm: dinner, 570 kcal and 68g protein left, window closes 10:40pm. */
function demoInput(patch: Partial<SuggestionInput> = {}): SuggestionInput {
  return {
    today: DEMO_EXPECTED.today.day,
    now: DEMO_EXPECTED.now,
    slot: 'dinner',
    leftTodayKcal: DEMO_EXPECTED.leftTodayKcal,
    proteinLeftG: 68,
    windowClosesAt: DEMO_EXPECTED.today.windowClosesAt,
    history: world.meals,
    usuals: world.usuals,
    places: world.places,
    weights: GOAL_PRESETS.cut.suggestionWeights,
    ...patch,
  };
}

describe('suggestMeals on the demo Friday', () => {
  const result = suggestMeals(demoInput());

  it('gives three picks with different jobs that fit the 570 kcal left', () => {
    expect(result.mode).toBe('normal');
    expect(result.hasHistory).toBe(true);
    expect(result.cards.map((c) => c.role)).toEqual(['usual', 'lighterSwap', 'different']);
    for (const card of result.cards) {
      expect(card.kcal).toBeLessThanOrEqual(570);
      expect(card.fit).toBe('fits');
      expect(card.items.length).toBeGreaterThan(0);
      expect(card.kcal).toBe(roundTo10(sumMacros(card.items.map(itemMacros)).kcal));
      expect(card.proteinG).toBeGreaterThan(0);
    }
    expect(new Set(result.cards.map((c) => c.name)).size).toBe(3);
  });

  it('explains each pick', () => {
    const [usual, swap, different] = result.cards;
    expect(usual?.reason).toMatch(/^You had this \d+ times this month$/);
    expect(swap?.reason).toMatch(/about \d+ kcal lighter$/);
    expect(different?.reason).toMatch(/^(Not had in \d+ days|Something new to try)/);
  });

  it('builds the lighter swap from a favourite: lighter portions or a catalogue swap', () => {
    const swap = result.cards[1]!;
    expect(swap.name).toBe('Ayam tandoori instead of ayam goreng, small rice, kuah sikit');
    expect(swap.placeName).toBe('Nasi kandar near home');
    expect(swap.items.map((i) => i.catalogueId)).toEqual(['rice-nasi-kandar', 'ayam-tandoori', 'kuah-campur']);
  });

  it('never offers a drink on its own as a dinner idea', () => {
    const drinkOnly = [...result.cards, ...result.pool].filter((c) => c.items.every((i) => i.catalogueId === 'teh-o-ais'));
    expect(drinkOnly).toHaveLength(0);
  });

  it('lets the goal weights decide (protein first for a lean bulk)', () => {
    const bulk = suggestMeals(demoInput({ weights: GOAL_PRESETS.leanBulk.suggestionWeights, leftTodayKcal: 1200, proteinLeftG: 90 }));
    expect(bulk.cards).toHaveLength(3);
    const cut = suggestMeals(demoInput({ leftTodayKcal: 1200, proteinLeftG: 90 }));
    expect(bulk.cards[0]?.score).not.toBe(cut.cards[0]?.score);
  });

  it('scores a pick lower after it was ignored', () => {
    const usual = result.cards[0]!;
    const ignored: SuggestionEvent[] = [1, 2, 3].map((n) => ({
      id: `e${n}`,
      at: `2026-10-1${n}T12:00:00.000Z`,
      role: 'usual',
      name: usual.name,
      outcome: 'ignored',
    }));
    const after = suggestMeals(demoInput({ events: ignored }));
    const again = [...after.cards, ...after.pool].find((c) => c.key === usual.key);
    expect(again?.score ?? 0).toBeLessThan(usual.score);
  });
});

describe('suggestMeals states', () => {
  it('shows only light options with little budget left', () => {
    const little = suggestMeals(demoInput({ leftTodayKcal: 200 }));
    expect(little.mode).toBe('little');
    expect(little.cards).toHaveLength(3);
    expect(little.cards.every((c) => c.kcal <= 200 && c.fit === 'fits')).toBe(true);
  });

  it('shows the lightest options when over budget, as tight fits', () => {
    const over = suggestMeals(demoInput({ leftTodayKcal: -310 }));
    expect(over.mode).toBe('over');
    expect(over.cards).toHaveLength(3);
    expect(over.cards.every((c) => c.fit === 'tightFit')).toBe(true);
    expect(Math.max(...over.cards.map((c) => c.kcal))).toBeLessThan(700);
  });

  it('starts from the starter catalogue before there is history', () => {
    const fresh = suggestMeals(demoInput({ history: [], usuals: [], places: [] }));
    expect(fresh.hasHistory).toBe(false);
    expect(fresh.cards.map((c) => c.role)).toEqual(['usual', 'lighterSwap', 'different']);
    expect(fresh.cards[0]).toMatchObject({ name: 'Ayam bakar, half rice, ulam', kcal: 540, reason: 'A common pick for dinner' });
    expect(fresh.cards.every((c) => c.kcal <= 570)).toBe(true);
  });

  it('uses Usuals from setup on day one', () => {
    const breakfast = suggestMeals(demoInput({ history: [], slot: 'breakfast', leftTodayKcal: 1800, proteinLeftG: 110 }));
    expect(breakfast.cards[0]?.reason).toBe('One of your usuals');
    expect(['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Nasi lemak bungkus']).toContain(breakfast.cards[0]?.name);
  });

  it('treats a paused budget as no budget', () => {
    expect(ideasMode(null)).toBe('noBudget');
    expect(ideasMode(0)).toBe('over');
    expect(ideasMode(299)).toBe('little');
    expect(ideasMode(570)).toBe('normal');
    expect(suggestMeals(demoInput({ leftTodayKcal: null })).cards.every((c) => c.fit === 'fits')).toBe(true);
  });
});

describe('surprisePick', () => {
  const result = suggestMeals(demoInput());
  const shown = new Set(result.cards.map((c) => c.key));

  it('picks something not on screen that fits', () => {
    const pick = surprisePick(result.pool, shown, () => 0);
    expect(pick).toBeDefined();
    expect(shown.has(pick!.key)).toBe(false);
    expect(pick!.role).toBe('surprise');
    expect(pick!.fit).toBe('fits');
  });

  it('follows the random source', () => {
    const a = surprisePick(result.pool, shown, () => 0);
    const b = surprisePick(result.pool, shown, () => 0.99);
    expect(a?.key).not.toBe(b?.key);
    expect(surprisePick([], shown)).toBeUndefined();
  });
});
