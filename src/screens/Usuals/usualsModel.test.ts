// @vitest-environment node
import { buildDemoWorld, DEMO_IDS } from '@/db/seed/demo';
import type { MealItem, Usual } from '@/domain/types';
import { moveAnnouncement, usualItemsLabel } from './usualsModel';

function item(name: string, quantity = 1): MealItem {
  return { id: `i-${name}`, name, unitMacros: { kcal: 100, proteinG: 0, carbsG: 0, fatG: 0 }, quantity, uncertainty: 0.15, source: 'catalogue' };
}

function demoUsual(id: string): Usual {
  const usual = buildDemoWorld().usuals.find((u) => u.id === id);
  if (!usual) throw new Error(`missing demo Usual ${id}`);
  return usual;
}

describe('usualItemsLabel', () => {
  it('lists the items, with amounts other than 1', () => {
    expect(usualItemsLabel([item('Ayam goreng', 2), item('Teh o ais kurang')])).toBe('Ayam goreng ×2 · Teh o ais kurang');
  });

  it("is empty when it would only repeat the Usual's name", () => {
    for (const id of [DEMO_IDS.usuals.breadKayaKopi, DEMO_IDS.usuals.nasiLemak, DEMO_IDS.usuals.tehOAisKurang]) {
      const usual = demoUsual(id);
      expect(usualItemsLabel(usual.items, usual.name)).toBe('');
    }
    // Case and punctuation don't make it different.
    expect(usualItemsLabel([item('Bread, kaya, kopi')], 'bread kaya kopi')).toBe('');
  });

  it('keeps the items when they say more than the name', () => {
    const roti = demoUsual(DEMO_IDS.usuals.rotiCanai);
    expect(usualItemsLabel(roti.items, roti.name)).toBe('Roti canai + dhal · Teh tarik');
    // A different item name, or a second helping, is worth showing.
    expect(usualItemsLabel([item('Roti canai + dhal')], 'Roti canai pagi')).toBe('Roti canai + dhal');
    expect(usualItemsLabel([item('Teh o ais kurang', 2)], 'Teh o ais kurang')).toBe('Teh o ais kurang ×2');
  });
});

describe('moveAnnouncement', () => {
  it('says where the Usual is now', () => {
    expect(moveAnnouncement('Roti canai + teh tarik', 'down', 2, 4)).toBe('Moved down. Roti canai + teh tarik is 2 of 4.');
  });
});
