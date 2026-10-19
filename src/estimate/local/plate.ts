/**
 * "Nasi campur" alone is the whole typical plate (rice, a meat, two veg, kuah). Listed with the
 * dishes on it ("nasi campur ayam goreng, sayur, kuah banjir"), those dishes are counted on
 * their own, so the plate is just its rice.
 */
import { byId } from '@/data/catalogue';
import type { FoodCategory } from '@/domain/types';
import type { Mention } from './attach';
import { refCatalogueItem } from './scan';

const TYPICAL_PLATE_ID = 'nasi-campur';
const RICE_SCOOP_ID = 'rice-economy';
const PLATE_COMPONENTS: ReadonlySet<FoodCategory> = new Set(['protein', 'vegetables', 'tofuEgg', 'gravy']);

function isComponent(mention: Mention): boolean {
  if (mention.ref.kind === 'guess') return true;
  const category = refCatalogueItem(mention.ref)?.category;
  return category !== undefined && PLATE_COMPONENTS.has(category);
}

export function splitTypicalPlate(mentions: readonly Mention[]): Mention[] {
  const rice = byId(RICE_SCOOP_ID);
  if (!rice || !mentions.some(isComponent)) return [...mentions];
  return mentions.map((m) =>
    m.ref.kind === 'catalogue' && m.ref.item.id === TYPICAL_PLATE_ID
      ? // Size words carry over to the rice ("nasi campur sikit" → half a scoop); the plate's own chip labels don't.
        { ...m, choices: m.choices.filter((c) => c.kind === 'modifier'), ref: { kind: 'catalogue', item: rice, candidates: [rice.id] } }
      : m,
  );
}
