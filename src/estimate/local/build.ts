/**
 * Turns a mention into a review-screen item. Chip choice, in order (ARCHITECTURE.md §7):
 * words in the text > PersonalItem for this Place > PersonalItem for the dish >
 * Place.defaultVariants > catalogue default. Learned choices are tagged 'yourCorrection'.
 */
import { aliasChip } from '@/data/aliasChips';
import { defaultVariantOf } from '@/data/catalogue';
import { itemFromCatalogue } from '@/domain/meal';
import { clipText } from '@/domain/text';
import type { CatalogueItem, Macros, MealItem, PersonalItem, Place, Variant } from '@/domain/types';
import { QUESTION_MIN_KCAL } from '../types';
import type { Mention } from './attach';
import {
  GUESS_LABELS,
  GUESS_NORMAL_INDEX,
  GUESS_QUESTION,
  GUESS_UNCERTAINTY,
  guessMacros,
  guessVariants,
} from './guess';
import { normaliseText, sentenceCase } from './normalise';
import { personalVariants, type ItemRef } from './scan';
import { comparePersonal } from './terms';
import { countedChoice, labelsOf, resolveKind, variantSpread } from './variants';

/** A guessed dish's name is the phrase as typed, cut to this length. */
const MAX_GUESS_NAME_LENGTH = 60;

export interface BuildContext {
  place?: Place;
  /** PersonalItems that apply here (already filtered for the Place). */
  personal: readonly PersonalItem[];
  newId: () => string;
}

export interface QuestionCandidate {
  question: string;
  /** Lower asks first: guessed dishes (0) before catalogue items (1). */
  priority: number;
  /** kcal the answer can move the total by. */
  weight: number;
}

export interface BuiltItem {
  item: MealItem;
  question?: QuestionCandidate;
  /** The phrase as typed, when nothing in the library or catalogue matched it. */
  unmatched?: string;
}

interface Selection {
  index?: number;
  quantity: number;
  /** True when the text itself picked a chip, so learned defaults and questions step aside. */
  explicit: boolean;
  /** Set when a size word switched to the besar entry. */
  switchedTo?: CatalogueItem;
}

/** The chip an alias names ("garlic naan" → Garlic), as an index into `labels`. */
function aliasIndex(mention: Mention, item: CatalogueItem | undefined, labels: readonly string[]): number | undefined {
  const term = mention.ref.kind === 'catalogue' ? mention.ref.term : undefined;
  const label = item && term ? aliasChip(item.id, term) : undefined;
  if (label === undefined) return undefined;
  const index = labels.indexOf(normaliseText(label));
  return index >= 0 ? index : undefined;
}

function select(mention: Mention, labels: readonly string[], defaultIndex: number, item?: CatalogueItem): Selection {
  let current = item;
  let currentLabels = labels;
  let switchedTo: CatalogueItem | undefined;
  let explicit = false;

  // Size and ice first, so "teh o ais kosong besar" applies Kosong to the besar glass.
  for (const choice of mention.choices) {
    if (choice.kind !== 'modifier' || !current) continue;
    if (choice.phrase.kind !== 'large' && choice.phrase.kind !== 'iced') continue;
    const result = resolveKind(choice.phrase.kind, currentLabels, current);
    if (result?.type !== 'sibling') continue;
    current = result.item;
    currentLabels = labelsOf(current.variants);
    switchedTo = current;
    explicit = true;
  }

  let index: number | undefined = switchedTo ? undefined : aliasIndex(mention, item, labels);
  if (index !== undefined) explicit = true;
  let factor = 1;
  for (const choice of mention.choices) {
    if (choice.kind === 'label') {
      const found = currentLabels.indexOf(choice.label);
      if (found >= 0) {
        index = found;
        explicit = true;
      }
      continue;
    }
    const result = resolveKind(choice.phrase.kind, currentLabels, current);
    if (!result || result.type === 'sibling') continue;
    if (result.type === 'variant') index = result.index;
    else if (result.type === 'factor') factor *= result.factor;
    else index ??= current?.defaultVariant ?? defaultIndex;
    explicit = true;
  }

  let quantity = 1;
  if (mention.quantity !== undefined) {
    const counted = countedChoice(currentLabels, mention.quantity, index);
    if (counted) {
      index = counted.index;
      quantity = counted.quantity;
      explicit = true;
    } else {
      quantity = mention.quantity;
    }
  }
  const selection: Selection = { quantity: quantity * factor, explicit };
  if (index !== undefined) selection.index = index;
  if (switchedTo) selection.switchedTo = switchedTo;
  return selection;
}

function copyVariants(variants: readonly Variant[]): Variant[] {
  return variants.map((v) => ({ ...v, macros: { ...v.macros } }));
}

/** An item from the user's own correction; `index` overrides its saved chip. */
function fromPersonal(personal: PersonalItem, item: CatalogueItem | undefined, quantity: number, id: string, index?: number): MealItem {
  const variants = personalVariants(personal, item);
  const chosen = index ?? personal.selectedVariant;
  const variant = chosen === undefined ? undefined : variants?.[chosen];
  const built: MealItem = {
    id,
    name: personal.name || item?.name || '',
    unitMacros: { ...(index !== undefined && variant ? variant.macros : personal.unitMacros) },
    quantity,
    uncertainty: personal.uncertainty,
    source: 'yourCorrection',
  };
  if (personal.catalogueId !== undefined) built.catalogueId = personal.catalogueId;
  if (variants && variant && chosen !== undefined) {
    built.variants = copyVariants(variants);
    built.selectedVariant = chosen;
  }
  return built;
}

function learnedFor(item: CatalogueItem, ctx: BuildContext): { personal: PersonalItem } | { index: number } | undefined {
  const personal = ctx.personal.filter((p) => p.catalogueId === item.id).sort(comparePersonal)[0];
  if (personal) return { personal };
  const index = ctx.place?.defaultVariants[item.id];
  return index !== undefined && item.variants[index] ? { index } : undefined;
}

function catalogueQuestion(item: CatalogueItem, built: MealItem): QuestionCandidate | undefined {
  if (!item.question) return undefined;
  const weight = variantSpread(item.variants) * built.quantity;
  return weight >= QUESTION_MIN_KCAL ? { question: item.question, priority: 1, weight } : undefined;
}

function buildCatalogue(mention: Mention, item: CatalogueItem, ctx: BuildContext): BuiltItem {
  const selection = select(mention, labelsOf(item.variants), item.defaultVariant, item);
  const chosen = selection.switchedTo ?? item;
  const id = ctx.newId();
  if (!selection.explicit) {
    const learned = learnedFor(chosen, ctx);
    if (learned && 'personal' in learned) return { item: fromPersonal(learned.personal, chosen, selection.quantity, id) };
    if (learned) {
      return { item: itemFromCatalogue(chosen, { variant: learned.index, quantity: selection.quantity, source: 'yourCorrection', id }) };
    }
  }
  const variant = selection.index ?? chosen.defaultVariant;
  const built = itemFromCatalogue(chosen, { variant, quantity: selection.quantity, id });
  const question = selection.explicit ? undefined : catalogueQuestion(chosen, built);
  return question ? { item: built, question } : { item: built };
}

function buildPersonal(mention: Mention, personal: PersonalItem, item: CatalogueItem | undefined, ctx: BuildContext): BuiltItem {
  const selection = select(mention, labelsOf(personalVariants(personal, item)), personal.selectedVariant ?? 0, item);
  const id = ctx.newId();
  if (selection.switchedTo) {
    const switched = itemFromCatalogue(selection.switchedTo, {
      variant: selection.index ?? selection.switchedTo.defaultVariant,
      quantity: selection.quantity,
      id,
    });
    return { item: switched };
  }
  return { item: fromPersonal(personal, item, selection.quantity, id, selection.explicit ? selection.index : undefined) };
}

function attachedMacros(ref: ItemRef): Macros | undefined {
  if (ref.kind === 'catalogue') return defaultVariantOf(ref.item).macros;
  if (ref.kind === 'personal') return ref.personal.unitMacros;
  return undefined;
}

/** "Nasi kerabu" stays as typed; a whole paragraph is cut short with an ellipsis. */
function guessName(phrase: string): string {
  return clipText(sentenceCase(phrase), MAX_GUESS_NAME_LENGTH, '…');
}

function buildGuess(mention: Mention, ref: Extract<ItemRef, { kind: 'guess' }>, ctx: BuildContext): BuiltItem {
  const variants = guessVariants(guessMacros(ref.words, ref.attached ? attachedMacros(ref.attached) : undefined));
  const selection = select(mention, GUESS_LABELS, GUESS_NORMAL_INDEX);
  const index = selection.index ?? GUESS_NORMAL_INDEX;
  const variant = variants[index] ?? variants[GUESS_NORMAL_INDEX];
  const phrase = ref.words.join(' ');
  const item: MealItem = {
    id: ctx.newId(),
    name: guessName(phrase),
    variants,
    selectedVariant: variants[index] ? index : GUESS_NORMAL_INDEX,
    unitMacros: { ...(variant?.macros ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }) },
    quantity: selection.quantity,
    uncertainty: GUESS_UNCERTAINTY,
    source: 'aiGuess',
  };
  const built: BuiltItem = { item, unmatched: phrase };
  // Plan §15.2: only ask when the answer can move the total by 100 kcal or more.
  const weight = variantSpread(variants) * item.quantity;
  if (!selection.explicit && weight >= QUESTION_MIN_KCAL) built.question = { question: GUESS_QUESTION, priority: 0, weight };
  return built;
}

export function buildItem(mention: Mention, ctx: BuildContext): BuiltItem {
  const { ref } = mention;
  if (ref.kind === 'catalogue') return buildCatalogue(mention, ref.item, ctx);
  if (ref.kind === 'personal') return buildPersonal(mention, ref.personal, ref.item, ctx);
  return buildGuess(mention, ref, ctx);
}
