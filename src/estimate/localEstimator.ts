/**
 * Offline estimator: reads a typed meal against the user's library and the starter catalogue
 * ("nasi kandar ayam goreng, kubis, kuah campur, teh o ais" → five items with chips), applies
 * portion and sugar words and learned defaults, and turns unknown food into an 'aiGuess' item
 * with a wide range. Words that aren't food come back in `unmatched` without an item.
 * Synchronous and total: odd input gives an empty result, never an error.
 */
import { byId } from '@/data/catalogue';
import { throwIfAborted } from './abort';
import { attach } from './local/attach';
import { buildItem } from './local/build';
import { splitPieces } from './local/normalise';
import { splitTypicalPlate } from './local/plate';
import { pickQuestions } from './local/questions';
import { countFamilies, pickCandidate } from './local/resolve';
import { resolveUnknown, scanSegment, type Part, type ScanEnv } from './local/scan';
import { PUNCTUATED_TERM_INDEX, applicablePersonal, joinNamedPieces, personalTermIndex, punctuatedPersonalIndex } from './local/terms';
import type { EstimateContext, EstimateRequest, EstimateResult, Estimator } from './types';

export interface LocalEstimatorOptions {
  /** Id factory for new items; defaults to crypto.randomUUID. */
  newId?: () => string;
}

/** Far more than any meal; longer text is cut so a pasted page can't stall the review screen. */
const MAX_TEXT_LENGTH = 5_000;
/** Items past this many are reported in `unmatched` instead. */
const MAX_ITEMS = 60;

function defaultNewId(): string {
  return globalThis.crypto.randomUUID();
}

function requestText(req: EstimateRequest): string {
  const text = [req.text, req.caption].filter((t): t is string => typeof t === 'string' && t.trim() !== '').join('\n');
  return text.slice(0, MAX_TEXT_LENGTH);
}

export function emptyResult(): EstimateResult {
  return { items: [], questions: [], unmatched: [], method: 'local' };
}

function unmatchedPhrases(parts: readonly Part[], tokens: readonly string[]): string[] {
  return parts.flatMap((part) => (part.type === 'unmatched' ? [tokens.slice(part.start, part.end).join(' ')] : []));
}

export function estimateLocally(req: EstimateRequest, ctx: EstimateContext, newId: () => string = defaultNewId): EstimateResult {
  const { place } = ctx;
  const personal = applicablePersonal(ctx.personal ?? [], place);
  const segments = joinNamedPieces(splitPieces(requestText(req)), [PUNCTUATED_TERM_INDEX, punctuatedPersonalIndex(personal)]);
  if (segments.length === 0) return emptyResult();

  const personalTerms = personalTermIndex(personal);
  let lastKey = 0;
  const nextKey = (): number => (lastKey += 1);

  // First pass: names that mean exactly one entry tell us what kind of meal this is
  // ("nasi kandar" → mamak), which settles ambiguous names in the second pass.
  const firstPass: ScanEnv = { personalTerms, pick: (ids) => ids.flatMap((id) => byId(id) ?? [])[0], nextKey };
  const familyCounts = countFamilies(
    segments.flatMap((tokens) =>
      resolveUnknown(scanSegment(tokens, firstPass), tokens, firstPass).flatMap((part) =>
        part.type === 'item' && part.ref.kind === 'catalogue' ? [part.ref.candidates] : [],
      ),
    ),
  );

  const env: ScanEnv = { personalTerms, pick: (ids) => pickCandidate(ids, { place, personal, familyCounts }), nextKey };
  const parsed = segments.map((tokens) => resolveUnknown(scanSegment(tokens, env), tokens, env));
  const mentions = splitTypicalPlate(attach(parsed, env));
  const built = mentions.slice(0, MAX_ITEMS).map((mention) => buildItem(mention, { place, personal, newId }));
  const overflow = mentions.slice(MAX_ITEMS).flatMap((m) => {
    const tokens = segments[m.segment] ?? [];
    return m.ref.kind === 'guess' ? [m.ref.words.join(' ')] : [tokens.join(' ')];
  });

  const questions = pickQuestions(built);
  const asked = new Map(questions.map((q) => [q.itemId, q.question]));
  const items = built.map(({ item }) => {
    const question = asked.get(item.id);
    return question ? { ...item, question } : item;
  });
  const unmatched = [
    ...new Set([
      ...built.flatMap((b) => (b.unmatched ? [b.unmatched] : [])),
      ...parsed.flatMap((parts, i) => unmatchedPhrases(parts, segments[i] ?? [])),
      ...overflow,
    ]),
  ];
  return { items, questions, unmatched, method: 'local' };
}

export function createLocalEstimator(opts: LocalEstimatorOptions = {}): Estimator {
  const newId = opts.newId ?? defaultNewId;
  return {
    async estimate(req, ctx, options) {
      throwIfAborted(options?.signal);
      return estimateLocally(req, ctx, newId);
    },
  };
}

export const localEstimator: Estimator = createLocalEstimator();
