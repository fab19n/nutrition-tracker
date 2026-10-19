import type { KiraMakanDb } from '@/db/db';
import type { Id, Instant, SuggestionEvent } from '@/domain/types';

export async function addSuggestionEvent(db: KiraMakanDb, event: SuggestionEvent): Promise<void> {
  await db.suggestionEvents.add(event);
}

export function getSuggestionEvent(db: KiraMakanDb, id: Id): Promise<SuggestionEvent | undefined> {
  return db.suggestionEvents.get(id);
}

/** Oldest first. */
export function listSuggestionEvents(db: KiraMakanDb): Promise<SuggestionEvent[]> {
  return db.suggestionEvents.orderBy('at').toArray();
}

/** Events at or after `since`, oldest first. */
export function listSuggestionEventsSince(db: KiraMakanDb, since: Instant): Promise<SuggestionEvent[]> {
  return db.suggestionEvents.where('at').aboveOrEqual(since).toArray();
}

export async function setSuggestionOutcome(
  db: KiraMakanDb,
  id: Id,
  outcome: SuggestionEvent['outcome'],
): Promise<boolean> {
  return (await db.suggestionEvents.update(id, { outcome })) > 0;
}
