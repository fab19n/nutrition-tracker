/**
 * Hands each chip label, modifier and quantity to the food it describes. A modifier goes to the
 * nearest food on its usual side within the same clause, then the other side, then the rest of
 * the entry; kuah words, and sugar words that start an entry, may reach across the whole meal
 * ("nasi kandar banjir, kuah campur"). When nothing can take it, a modifier that names its food
 * adds it ("extra kuah"). A number right before a food counts that food ("2 ketul ayam
 * goreng"); "tambah" / "extra" right before a food adds that food rather than sizing up the last.
 */
import type { FoodCategory } from '@/domain/types';
import { GUESS_LABELS } from './guess';
import type { ModifierPhrase, Side } from './lexicon';
import { tokenise } from './normalise';
import { isLargeCount } from './lexicon';
import { refCatalogueItem, refLabels, type ItemRef, type Part, type ScanEnv } from './scan';
import { CATALOGUE_TERM_INDEX, exactTerm } from './terms';
import { resolveKind, takesLargeCounts } from './variants';

export type Choice = { kind: 'label'; label: string } | { kind: 'modifier'; phrase: ModifierPhrase };

export interface Mention {
  key: number;
  segment: number;
  /** Position in the text, for output order. */
  order: number;
  ref: ItemRef;
  /** Chip labels and modifiers, in text order. */
  choices: Choice[];
  quantity?: number;
}

interface Located {
  mention: Mention;
  index: number;
  /** Clause within the entry: soft separators ("dan", "with") start a new one. */
  clause: number;
}

const SEGMENT_STRIDE = 10_000;

function orderOf(segment: number, tokenIndex: number): number {
  return segment * SEGMENT_STRIDE + tokenIndex;
}

export function labelsForRef(ref: ItemRef): readonly string[] {
  return ref.kind === 'guess' ? GUESS_LABELS : refLabels(ref);
}

function categoryOf(ref: ItemRef): FoodCategory | undefined {
  return refCatalogueItem(ref)?.category;
}

function canTake(mention: Mention, phrase: ModifierPhrase): boolean {
  if (phrase.target !== undefined && categoryOf(mention.ref) !== phrase.target) return false;
  return resolveKind(phrase.kind, labelsForRef(mention.ref), refCatalogueItem(mention.ref)) !== undefined;
}

const SUGAR_KINDS: ReadonlySet<ModifierPhrase['kind']> = new Set(['kurang', 'kosong']);

/**
 * Rice and kuah words are specific enough to find their food anywhere in the meal. Sugar words
 * only do when no food comes before them in their own entry: "mee goreng kosong" is a plain
 * mee goreng, and its "kosong" must not reach the teh tarik in the next entry.
 */
function reachesWholeMeal(phrase: ModifierPhrase, foodBefore: boolean): boolean {
  if (SUGAR_KINDS.has(phrase.kind)) return !foodBefore;
  return phrase.target === 'rice' || phrase.kind === 'banjir';
}

/** The item part that follows `index`, skipping filler and quantities ("tambah 2 telur"). */
function itemAfter(parts: readonly Part[], index: number): number | undefined {
  for (let i = index + 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (part?.type === 'item') return i;
    if (part?.type !== 'filler' && part?.type !== 'quantity') return undefined;
  }
  return undefined;
}

/** "tambah telur", "extra cockles": the words add a food; they don't size up the one before. */
function addsNextFood(parts: readonly Part[], index: number, phrase: ModifierPhrase): boolean {
  return phrase.kind === 'more' && phrase.side === 'next' && phrase.target === undefined && itemAfter(parts, index) !== undefined;
}

/** A lone "kosong" after a dish that isn't a drink means plain ("mee goreng kosong"). */
function isPlainWord(parts: readonly Part[], index: number, phrase: ModifierPhrase, items: readonly Located[]): boolean {
  if (phrase.kind !== 'kosong' || phrase.tokens.length !== 1) return false;
  const before = [...items].reverse().find((it) => it.index < index);
  return before !== undefined && categoryOf(before.mention.ref) !== 'drinks' && parts[index - 1]?.type !== 'separator';
}

/**
 * Which food a quantity counts: the food right after it ("2 ketul ayam goreng", "2 meat 1 veg"),
 * unless that food has its own trailing count ("teh tarik 2 roti canai 1" counts after each
 * food); otherwise the usual previous-first search. A large count ("30") only goes to a food
 * counted in small units (satay sticks, durian seeds), never to 30 roti canai.
 */
function quantityTarget(parts: readonly Part[], index: number, clause: number, value: number, items: readonly Located[]): Mention | undefined {
  const fits = (m: Mention): boolean =>
    m.quantity === undefined && (!isLargeCount(value) || takesLargeCounts(refCatalogueItem(m.ref)?.variants));
  const next = parts[index + 1];
  const trailingCountAfterNext = parts[index + 2]?.type === 'quantity' && parts[index + 3]?.type !== 'item';
  if (next?.type === 'item' && !trailingCountAfterNext) {
    const direct = items.find((it) => it.index === index + 1)?.mention;
    if (direct && fits(direct)) return direct;
  }
  return targetsFor(items, index, clause, 'previous').find(fits);
}

function targetsFor(items: readonly Located[], index: number, clause: number, side: Side): Mention[] {
  const same = items.filter((it) => it.clause === clause);
  const before = same.filter((it) => it.index < index).reverse();
  const after = same.filter((it) => it.index > index);
  const [near, far] = side === 'previous' ? [before, after] : [after, before];
  const others = items
    .filter((it) => it.clause !== clause)
    .sort((a, b) => Math.abs(a.index - index) - Math.abs(b.index - index));
  const ordered = [near[0], far[0], ...near.slice(1), ...far.slice(1), ...others];
  return ordered.flatMap((it) => (it ? [it.mention] : []));
}

function locate(parts: readonly Part[], segment: number): Located[] {
  const items: Located[] = [];
  let clause = 0;
  parts.forEach((part, index) => {
    if (part.type === 'separator') clause += 1;
    if (part.type !== 'item') return;
    const mention: Mention = { key: part.key, segment, order: orderOf(segment, part.start), ref: part.ref, choices: [] };
    items.push({ mention, index, clause });
  });
  return items;
}

interface Pending {
  phrase: ModifierPhrase;
  segment: number;
  tokenIndex: number;
  /** A food comes before it in its own entry. */
  foodBefore: boolean;
}

function impliedMention(pending: Pending, segmentItems: readonly Located[], env: ScanEnv): Mention | undefined {
  const { implies } = pending.phrase;
  if (!implies) return undefined;
  const needs = implies.whenSegmentHas;
  if (needs !== undefined && !segmentItems.some((it) => categoryOf(it.mention.ref) === needs)) return undefined;
  const term = exactTerm(CATALOGUE_TERM_INDEX, tokenise(implies.term));
  const item = term ? env.pick(term.refs) : undefined;
  if (!item) return undefined;
  const mention: Mention = {
    key: env.nextKey(),
    segment: pending.segment,
    order: orderOf(pending.segment, pending.tokenIndex),
    ref: { kind: 'catalogue', item, candidates: term?.refs ?? [item.id] },
    choices: [{ kind: 'modifier', phrase: pending.phrase }],
  };
  return canTake(mention, pending.phrase) ? mention : undefined;
}

export function attach(segments: readonly (readonly Part[])[], env: ScanEnv): Mention[] {
  const located = segments.map(locate);
  const mentions = located.flatMap((items) => items.map((it) => it.mention));
  const byKey = new Map(mentions.map((m) => [m.key, m]));
  const pending: Pending[] = [];

  segments.forEach((parts, segment) => {
    const items = located[segment] ?? [];
    let clause = 0;
    parts.forEach((part, index) => {
      if (part.type === 'separator') clause += 1;
      else if (part.type === 'label') byKey.get(part.itemKey)?.choices.push({ kind: 'label', label: part.label });
      else if (part.type === 'quantity') {
        const target = quantityTarget(parts, index, clause, part.value, items);
        if (target) target.quantity = part.value;
      } else if (part.type === 'modifier') {
        if (addsNextFood(parts, index, part.phrase) || isPlainWord(parts, index, part.phrase, items)) return;
        const target = targetsFor(items, index, clause, part.phrase.side).find((m) => canTake(m, part.phrase));
        if (target) target.choices.push({ kind: 'modifier', phrase: part.phrase });
        else pending.push({ phrase: part.phrase, segment, tokenIndex: part.start, foodBefore: items.some((it) => it.index < index) });
      }
    });
  });

  for (const p of pending) {
    const elsewhere = reachesWholeMeal(p.phrase, p.foodBefore)
      ? [...mentions]
          .sort((a, b) => Math.abs(a.segment - p.segment) - Math.abs(b.segment - p.segment) || a.order - b.order)
          .find((m) => canTake(m, p.phrase))
      : undefined;
    if (elsewhere) {
      elsewhere.choices.push({ kind: 'modifier', phrase: p.phrase });
      continue;
    }
    const implied = impliedMention(p, located[p.segment] ?? [], env);
    if (implied) mentions.push(implied);
  }

  return mentions.sort((a, b) => a.order - b.order);
}
