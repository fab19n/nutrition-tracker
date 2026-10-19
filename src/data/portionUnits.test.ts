import { PORTION_UNITS, findPortionUnits, portionUnit } from './portionUnits';

describe('portion dictionary', () => {
  it('has unique ids and caption-style labels', () => {
    const ids = PORTION_UNITS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const u of PORTION_UNITS) {
      expect(u.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(u.label, u.id).toMatch(/^(a|an) [a-z]/);
      expect(u.note.length, u.id).toBeGreaterThan(0);
    }
  });

  it('has lowercase, unique aliases', () => {
    for (const u of PORTION_UNITS) {
      expect(new Set(u.aliases).size, u.id).toBe(u.aliases.length);
      for (const a of u.aliases) expect(a, u.id).toBe(a.trim().toLowerCase());
    }
  });

  it('gives grams or ml for every measure, and ml for drinks', () => {
    for (const u of PORTION_UNITS) {
      if (u.kind === 'count') continue;
      expect((u.grams ?? 0) > 0 || (u.ml ?? 0) > 0, u.id).toBe(true);
      if (u.kind === 'drink') expect(u.ml ?? 0, u.id).toBeGreaterThan(0);
    }
  });

  it('covers the units the plan and design name', () => {
    for (const id of [
      'scoop-rice',
      'piece',
      'plate',
      'mamak-big',
      'cup',
      'mug',
      'senduk',
      'bowl',
      'tbsp',
      'tsp',
      'can-santan',
      'whole-chicken',
    ]) {
      expect(portionUnit(id), id).toBeDefined();
    }
    expect(portionUnit('tbsp')?.ml).toBe(15);
    expect(portionUnit('tsp')?.ml).toBe(5);
  });

  it('reads recipe words', () => {
    expect(findPortionUnits('Sudu').map((u) => u.id)).toEqual(['tbsp']);
    expect(findPortionUnits('tin').map((u) => u.id)).toEqual(['can-santan']);
    expect(findPortionUnits('ekor').map((u) => u.id)).toEqual(['whole-chicken']);
    expect(findPortionUnits('ketul').map((u) => u.id)).toEqual(['piece-chicken']);
    expect(findPortionUnits('besar').map((u) => u.id)).toEqual(['mamak-big', 'glass-besar']);
    expect(findPortionUnits('')).toEqual([]);
  });
});
