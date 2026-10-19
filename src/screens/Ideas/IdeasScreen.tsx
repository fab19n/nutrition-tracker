import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { SuggestionCard, SurpriseCard } from '@/components/SuggestionCard/SuggestionCard';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { normaliseName } from '@/data/catalogue';
import { recordSuggestionEvent, setSuggestionEventOutcome, useMealIdeas, type MealIdeasView } from '@/db/insightsData';
import { fmtApprox, fmtGrams, fmtInt, fmtTime } from '@/domain/format';
import { surprisePick, type MealSuggestion } from '@/domain/suggestions';
import type { Id } from '@/domain/types';
import { useUiStore, type ReviewMeta } from '@/state/ui';
import styles from './IdeasScreen.module.css';

function newItemId(): string {
  return globalThis.crypto.randomUUID();
}

/** "570 kcal and ~68g protein left · window closes 10:40pm", per state. */
function ContextLine({ ideas }: { ideas: MealIdeasView }) {
  const parts: ReactNode[] = [];
  const left = ideas.leftTodayKcal;
  const protein = ideas.proteinLeftG !== null && ideas.proteinLeftG > 0 ? ` and ~${fmtGrams(ideas.proteinLeftG)} protein` : '';
  if (ideas.mode === 'over') {
    const when = ideas.slot === 'dinner' || ideas.slot === 'supper' ? 'tonight' : `for ${SLOT_LABEL[ideas.slot].toLowerCase()}`;
    parts.push(<b key="main" className={styles.strong}>{`Lightest options ${when}`}</b>);
  } else if (ideas.mode === 'noBudget' || left === null) {
    parts.push(
      <span key="main">
        <b className={styles.strong}>Budget off today</b>
        {protein ? `,${protein} left` : ''}
      </span>,
    );
  } else {
    parts.push(
      <span key="main">
        <b className={styles.strong}>{fmtInt(left)} kcal</b>
        {`${protein} left`}
      </span>,
    );
    if (ideas.mode === 'little') parts.push(<span key="light">light options that fit</span>);
  }
  if (ideas.windowClosesAt) {
    parts.push(
      <span key="window">
        {ideas.windowClosed ? 'window closed at ' : 'window closes '}
        {fmtTime(ideas.windowClosesAt, ideas.tz)}
      </span>,
    );
  }
  return (
    <p className={styles.context}>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? ' · ' : null}
          {part}
        </span>
      ))}
    </p>
  );
}

/**
 * Records which picks were shown, taken or left (plan §12 "Learning"): each card once per
 * visit; whatever wasn't taken is marked ignored when you leave.
 */
function useSuggestionEvents(cards: readonly MealSuggestion[]) {
  const shown = useRef(new Map<string, Promise<Id>>());
  const taken = useRef(new Set<string>());
  const keys = cards.map((c) => `${c.role}:${c.key}`).join('|');

  useEffect(() => {
    for (const card of cards) {
      if (shown.current.has(card.key)) continue;
      shown.current.set(card.key, recordSuggestionEvent(card.role, card.name, 'shown'));
    }
    // Keyed on the set of cards on screen, not on each render's array.
  }, [keys]);

  useEffect(() => {
    const seen = shown.current;
    const took = taken.current;
    return () => {
      for (const [key, id] of seen) {
        if (took.has(key)) continue;
        void id.then((eventId) => setSuggestionEventOutcome(eventId, 'ignored')).catch(() => {});
      }
    };
  }, []);

  const record = (card: MealSuggestion): void => {
    if (!shown.current.has(card.key)) shown.current.set(card.key, recordSuggestionEvent(card.role, card.name, 'shown'));
  };
  const take = (card: MealSuggestion): void => {
    taken.current.add(card.key);
    const id = shown.current.get(card.key) ?? recordSuggestionEvent(card.role, card.name, 'shown');
    void id.then((eventId) => setSuggestionEventOutcome(eventId, 'taken')).catch(() => {});
  };
  return { record, take };
}

/** @design S36 Meal ideas — what's left, three picks with different jobs, Surprise me. */
export default function IdeasScreen() {
  const ideas = useMealIdeas();
  const navigate = useNavigate();
  const location = useLocation();
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const [surprise, setSurprise] = useState<MealSuggestion | null>(null);
  const events = useSuggestionEvents(ideas?.cards ?? []);

  const back = () => {
    if (location.key === 'default') navigate(PATHS.today);
    else goBack(navigate);
  };
  const header = <SubScreenHeader title="Meal ideas" onBack={back} />;

  if (!ideas) {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.cards}>
          <SkeletonList count={3} label="Finding ideas" />
        </div>
      </div>
    );
  }

  const logged = new Set(ideas.loggedNames);
  const log = (card: MealSuggestion) => {
    events.take(card);
    const meta: ReviewMeta = { method: 'idea', name: card.name, slot: ideas.slot };
    if (card.placeId) meta.placeId = card.placeId;
    setReviewDraft({
      flow: 'idea',
      title: 'Check your meal',
      items: card.items.map((item) => ({ ...item, id: newItemId(), unitMacros: { ...item.unitMacros } })),
      meta,
      backTo: PATHS.ideas,
    });
    // Review replaces Ideas, so after a save the phone's back button from Today doesn't reopen it.
    navigate(PATHS.review, { replace: true });
  };
  const surpriseMe = () => {
    const exclude = new Set([...ideas.cards.map((c) => c.key), ...(surprise ? [surprise.key] : [])]);
    const pick = surprisePick(ideas.pool, exclude) ?? surprisePick(ideas.pool, new Set(ideas.cards.map((c) => c.key)));
    if (!pick) return;
    events.record(pick);
    setSurprise(pick);
  };

  const cards = surprise ? [...ideas.cards, surprise] : ideas.cards;

  return (
    <div className={styles.screen}>
      {header}
      <ContextLine ideas={ideas} />
      {cards.length === 0 ? (
        <div className={styles.cards}>
          <EmptyState headline="No ideas yet" body="Log a few meals and ideas will show here." />
        </div>
      ) : (
        <div className={styles.cards} aria-live="polite">
          {cards.map((card) => (
            <SuggestionCard
              key={`${card.role}:${card.key}`}
              role={card.role}
              name={card.name}
              reason={card.reason}
              kcalLabel={`${fmtApprox(card.kcal)} kcal`}
              proteinLabel={`${fmtGrams(card.proteinG)} protein`}
              placeName={card.placeName}
              fit={card.fit}
              logged={logged.has(normaliseName(card.name))}
              onLog={() => log(card)}
            />
          ))}
          <SurpriseCard onPress={surpriseMe} label="Surprise me" disabled={ideas.pool.length === 0} />
        </div>
      )}
      {!ideas.hasHistory ? <p className={styles.note}>Ideas get better as you log.</p> : null}
    </div>
  );
}
