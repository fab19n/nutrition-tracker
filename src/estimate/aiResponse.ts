/**
 * Validates what the estimate endpoint returns. The response has the EstimateResult shape;
 * anything malformed is dropped item by item, and a body that isn't a result at all is
 * reported as 'badResponse' so the service can fall back.
 */
import { byId } from '@/data/catalogue';
import type { Macros, MealItem, SourceTag, Variant } from '@/domain/types';
import { EstimateUnavailableError } from './errors';
import { MAX_QUESTIONS, type EstimateQuestion, type EstimateResult } from './types';

/** Used when the server leaves the range out: wider than the catalogue's typical ±15%. */
export const AI_DEFAULT_UNCERTAINTY = 0.25;

/** A server-claimed catalogue value may differ from ours by rounding only. */
const CATALOGUE_KCAL_TOLERANCE = 1;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * What the item may be labelled as. The server's estimate is an AI guess unless it is our own
 * catalogue entry with one of its chips' values: it can never claim "Your correction" (only the
 * user's saved corrections are) or a database source like MyFCD that nothing here can check.
 */
function trustedSource(claimed: unknown, catalogueId: string | undefined, unitMacros: Macros): SourceTag {
  if (claimed !== 'catalogue' || catalogueId === undefined) return 'aiGuess';
  const entry = byId(catalogueId);
  const matches = entry?.variants.some((v) => Math.abs(v.macros.kcal - unitMacros.kcal) <= CATALOGUE_KCAL_TOLERANCE);
  return matches ? 'catalogue' : 'aiGuess';
}

function parseMacros(value: unknown): Macros | undefined {
  if (!isRecord(value)) return undefined;
  const kcal = nonNegative(value.kcal);
  if (kcal === undefined) return undefined;
  return {
    kcal,
    proteinG: nonNegative(value.proteinG) ?? 0,
    carbsG: nonNegative(value.carbsG) ?? 0,
    fatG: nonNegative(value.fatG) ?? 0,
  };
}

function parseVariant(value: unknown): Variant | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  const label = text(value.label);
  const macros = parseMacros(value.macros);
  if (!id || !label || !macros) return undefined;
  const grams = nonNegative(value.grams);
  return grams === undefined ? { id, label, macros } : { id, label, grams, macros };
}

function parseItem(value: unknown, newId: () => string): MealItem | undefined {
  if (!isRecord(value)) return undefined;
  const name = text(value.name);
  const unitMacros = parseMacros(value.unitMacros);
  if (!name || !unitMacros) return undefined;

  const quantity = nonNegative(value.quantity);
  const uncertainty = nonNegative(value.uncertainty);
  const catalogueId = text(value.catalogueId);
  const item: MealItem = {
    id: text(value.id) ?? newId(),
    name,
    unitMacros,
    quantity: quantity !== undefined && quantity > 0 ? quantity : 1,
    uncertainty: uncertainty !== undefined && uncertainty <= 1 ? uncertainty : AI_DEFAULT_UNCERTAINTY,
    source: trustedSource(value.source, catalogueId, unitMacros),
  };
  if (catalogueId) item.catalogueId = catalogueId;

  const variants = Array.isArray(value.variants) ? value.variants.flatMap((v) => parseVariant(v) ?? []) : [];
  const selected = value.selectedVariant;
  if (variants.length > 0) {
    item.variants = variants;
    if (typeof selected === 'number' && Number.isInteger(selected) && variants[selected]) item.selectedVariant = selected;
  }
  const question = text(value.question);
  if (question) item.question = question;
  return item;
}

function parseQuestions(value: unknown, items: readonly MealItem[]): EstimateQuestion[] {
  const ids = new Set(items.map((i) => i.id));
  const listed = Array.isArray(value)
    ? value.flatMap((q): EstimateQuestion[] => {
        if (!isRecord(q)) return [];
        const itemId = text(q.itemId);
        const question = text(q.question);
        return itemId && question && ids.has(itemId) ? [{ itemId, question }] : [];
      })
    : [];
  const fromItems = items.flatMap((i) => (i.question ? [{ itemId: i.id, question: i.question }] : []));
  const oncePerItem = new Map<string, EstimateQuestion>();
  for (const q of listed.length > 0 ? listed : fromItems) if (!oncePerItem.has(q.itemId)) oncePerItem.set(q.itemId, q);
  return [...oncePerItem.values()].slice(0, MAX_QUESTIONS);
}

/** Reads a response body into an AI result (method 'ai'), with at most two questions. */
export function parseEstimateResponse(body: unknown, newId: () => string): EstimateResult {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new EstimateUnavailableError('badResponse', 'The estimate response has no items.');
  }
  const parsed = body.items.flatMap((raw) => parseItem(raw, newId) ?? []);
  if (body.items.length > 0 && parsed.length === 0) {
    throw new EstimateUnavailableError('badResponse', 'None of the estimated items could be read.');
  }

  const seenIds = new Set<string>();
  const unique = parsed.map((item) => {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      return item;
    }
    const id = newId();
    seenIds.add(id);
    return { ...item, id };
  });

  const questions = parseQuestions(body.questions, unique);
  const asked = new Map(questions.map((q) => [q.itemId, q.question]));
  const items = unique.map((item) => {
    const next: MealItem = { ...item };
    delete next.question;
    const question = asked.get(item.id);
    if (question) next.question = question;
    return next;
  });
  const unmatched = Array.isArray(body.unmatched) ? body.unmatched.flatMap((u) => text(u) ?? []) : [];
  return { items, questions, unmatched, method: 'ai' };
}
