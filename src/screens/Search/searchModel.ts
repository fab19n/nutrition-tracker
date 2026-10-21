/**
 * S49 Search view helpers: what the address says (?q=, ?slot=, ?place=), the labels and the copy,
 * and the in-memory note that lets Back return to the same results. Pure apart from that note.
 */
import { NavigationType } from 'react-router';
import { PATHS } from '@/app/paths';
import { MEAL_SLOTS } from '@/components/SlotPicker/slots';
import { daysBetween } from '@/domain/day';
import { fmtDayShort, fmtInt } from '@/domain/format';
import { SEARCH_QUERY_MAX } from '@/domain/search';
import { clipText } from '@/domain/text';
import type { Id, LogicalDay, MealSlot } from '@/domain/types';
import { dayTitle } from '@/screens/Diary/diaryModel';

/** Meals drawn at a time; "Show 30 more" adds this many. */
export const SEARCH_PAGE_SIZE = 30;
/** Pause after the last keystroke before the results (and the address) follow the text. */
export const SEARCH_DEBOUNCE_MS = 200;
/** Characters of the query quoted in the no-results headline. */
const QUOTED_MAX = 40;
/** A Place id is a UUID or a short seed id; anything longer is not one. */
const PLACE_PARAM_MAX = 100;

/** What the screen shows: the committed text and the two optional filters. */
export interface SearchView {
  q: string;
  slot?: MealSlot;
  placeId?: Id;
}

/** Trimmed, runs of whitespace collapsed, clipped to SEARCH_QUERY_MAX; '' when it has no letter or digit. */
export function cleanQuery(raw: string): string {
  const collapsed = clipText(raw.replace(/\s+/g, ' ').trim(), SEARCH_QUERY_MAX);
  return /[\p{L}\p{N}]/u.test(collapsed) ? collapsed : '';
}

/** ?q= (collapsed spaces, clipped to SEARCH_QUERY_MAX), ?slot= (only a real MealSlot), ?place= (1–100 chars). Anything else is ignored. */
export function parseSearchParams(params: URLSearchParams): SearchView {
  const view: SearchView = { q: cleanQuery(params.get('q') ?? '') };
  const slot = params.get('slot');
  const found = MEAL_SLOTS.find((s) => s === slot);
  if (found) view.slot = found;
  const place = params.get('place');
  if (place && place.length <= PLACE_PARAM_MAX) view.placeId = place;
  return view;
}

/** The same params with q/slot/place set or deleted (empty q, no slot, no Place = removed); every other param (e.g. sheet) kept. */
export function withSearchView(params: URLSearchParams, view: SearchView): URLSearchParams {
  const next = new URLSearchParams(params);
  if (view.q) next.set('q', view.q);
  else next.delete('q');
  if (view.slot) next.set('slot', view.slot);
  else next.delete('slot');
  if (view.placeId) next.set('place', view.placeId);
  else next.delete('place');
  return next;
}

/** '/diary/search?q=teh+tarik&slot=dinner' (order q, slot, place); no params → PATHS.search. */
export function searchPath(view: Partial<SearchView> = {}): string {
  const query = withSearchView(new URLSearchParams(), { q: view.q ?? '', slot: view.slot, placeId: view.placeId }).toString();
  return query ? `${PATHS.search}?${query}` : PATHS.search;
}

// ---------------------------------------------------------------------------
// Labels and copy
// ---------------------------------------------------------------------------

/** "Fri 16 Oct · Today", "Thu 15 Oct · Yesterday", "Wed 14 Oct", and the year when it isn't this year: "Mon 3 Nov 2025". */
export function dayHeading(day: LogicalDay, today: LogicalDay): string {
  const offset = daysBetween(today, day);
  if (offset === 0 || offset === -1) return dayTitle(day, today);
  const short = fmtDayShort(day);
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${day.slice(0, 4)}`;
}

/** '1 meal', '12 meals', '1,204 meals'. */
export function countLabel(total: number): string {
  return `${fmtInt(total)} ${total === 1 ? 'meal' : 'meals'}`;
}

/** The button under the list: "Show 30 more", and "Show 22 more" for the last page. */
export function showMoreLabel(remaining: number): string {
  return `Show ${Math.min(SEARCH_PAGE_SIZE, remaining)} more`;
}

/** 'Showing 30 of 212'. */
export function shownCaption(shown: number, total: number): string {
  return `Showing ${fmtInt(shown)} of ${fmtInt(total)}`;
}

export interface NoResultsCopy {
  headline: string;
  body: string;
  /** Clears the slot and Place filters; the text stays. */
  actionLabel?: string;
}

/** An invitation to loosen the search, never a verdict. */
export function noResultsCopy(view: SearchView): NoResultsCopy {
  const filtered = view.slot !== undefined || view.placeId !== undefined;
  if (view.q === '') {
    return { headline: 'No meals with these filters', body: 'Take a filter off to see more.', actionLabel: 'Clear filters' };
  }
  const headline = `No meals match “${clipText(view.q, QUOTED_MAX, '…')}”`;
  if (filtered) return { headline, body: 'Try fewer words, or take off the filters.', actionLabel: 'Clear filters' };
  return { headline, body: 'Try fewer words, or a dish, drink or Place name.' };
}

// ---------------------------------------------------------------------------
// Back-navigation memory (a module variable: not stored anywhere)
// ---------------------------------------------------------------------------

export interface RememberedView {
  /** location.search of the results that were open. */
  search: string;
  /** How many meals were drawn. */
  shown: number;
  scrollY: number;
}

let remembered: RememberedView | undefined;

/** Called just before leaving the results for a meal or a day. */
export function rememberSearchView(view: RememberedView): void {
  remembered = view;
}

/**
 * What to restore: only when the screen is reached by going back (POP) to the same address.
 * A pure read, because React StrictMode runs initialisers twice.
 */
export function peekSearchView(search: string, navigationType: NavigationType): RememberedView | undefined {
  return navigationType === NavigationType.Pop && remembered?.search === search ? remembered : undefined;
}

export function forgetSearchView(): void {
  remembered = undefined;
}
