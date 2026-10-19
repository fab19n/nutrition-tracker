import type { CatalogueItem, Macros, Variant } from '@/domain/types';

/** Relative range used when a dish is fairly standard (±15%). */
export const TYPICAL_UNCERTAINTY = 0.15;

export function macros(kcal: number, proteinG: number, carbsG: number, fatG: number): Macros {
  return { kcal, proteinG, carbsG, fatG };
}

/** One portion choice: [label, kcal, grams?]. */
export type PortionChoice = readonly [label: string, kcal: number, grams?: number];

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A choice with its own macros, for choices that change the recipe (sugar level, cheese, milk). */
export function variant(label: string, m: Macros, grams?: number): Variant {
  return grams === undefined ? { id: slug(label), label, macros: m } : { id: slug(label), label, grams, macros: m };
}

/**
 * Choices that are the same recipe in a different amount (Small / Normal / Mamak big,
 * 1 piece / 2 pieces). Macros scale with kcal from the reference profile, so every choice
 * keeps the same protein / carbs / fat split.
 */
export function scaled(ref: Macros, choices: readonly PortionChoice[]): Variant[] {
  return choices.map(([label, kcal, grams]) => {
    const f = ref.kcal === 0 ? 0 : kcal / ref.kcal;
    return variant(
      label,
      { kcal, proteinG: round1(ref.proteinG * f), carbsG: round1(ref.carbsG * f), fatG: round1(ref.fatG * f) },
      grams,
    );
  });
}

/**
 * A catalogue entry as written in src/data/foods. Every starter entry is a typical-value
 * estimate (source 'catalogue'), not yet checked against MyFCD.
 * `question`, when set, must be answerable with the item's own variants (they become the
 * answer chips in C25 FollowUpQuestion).
 */
export interface DishSpec extends Omit<CatalogueItem, 'source' | 'uncertainty' | 'defaultVariant'> {
  defaultVariant?: number;
  uncertainty?: number;
}

export function dish(spec: DishSpec): CatalogueItem {
  return {
    ...spec,
    defaultVariant: spec.defaultVariant ?? 0,
    uncertainty: spec.uncertainty ?? TYPICAL_UNCERTAINTY,
    source: 'catalogue',
  };
}
