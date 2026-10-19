import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Plus, Repeat } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { UsualCard, UsualSuggestionCard } from '@/components/UsualCard/UsualCard';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { usePersonalItems, usePlaces, useProfile } from '@/db/hooks';
import {
  createUsual,
  dismissUsualSuggestion,
  editUsual,
  moveUsual,
  removeUsual,
  restoreUsualSuggestion,
  saveSuggestedUsual,
  useOrderedUsuals,
  useUsualSuggestions,
  type MoveDirection,
  type UsualSuggestion,
} from '@/db/usuals';
import { now } from '@/domain/clock';
import type { Id, Usual } from '@/domain/types';
import type { LibraryContext } from '@/screens/Log/library';
import { initialContext, timeSettings } from '@/screens/Log/mealTime';
import { useUiStore } from '@/state/ui';
import { UsualEditorSheet, type UsualEditorValue } from './UsualEditorSheet';
import { moveAnnouncement, usualItemsLabel, usualKcalLabel, usualReviewDraft } from './usualsModel';
import styles from './UsualsScreen.module.css';

/** Suggested Usuals shown at once (most logged first). */
const SUGGESTIONS_SHOWN = 2;

type Editor = { mode: 'new' } | { mode: 'edit'; usual: Usual };

/** Where focus goes once the list shows a change (a move re-orders the cards, a delete removes one). */
interface FocusRequest {
  ready: (list: readonly Usual[]) => boolean;
  /** The card whose menu button gets focus; none means the "New Usual" button. */
  id?: Id;
}

/** @design S23 Usuals — your Usuals in your order (Log · Edit · Move · Delete), + New Usual, then suggested Usuals (§7.3 order). */
export default function UsualsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useUiStore((s) => s.showToast);
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const profile = useProfile();
  const usuals = useOrderedUsuals();
  const suggestions = useUsualSuggestions();
  const places = usePlaces();
  const personal = usePersonalItems();

  const [editor, setEditor] = useState<Editor | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  const suggestedId = useId();
  const yoursId = useId();

  // Back returns to where Usuals was opened from (More), or to More after a fresh load.
  const hasHistory = location.key !== 'default';
  const back = () => (hasHistory ? goBack(navigate) : navigate(PATHS.more, { replace: true }));

  const placeById = useMemo(() => new Map((places ?? []).map((p) => [p.id, p])), [places]);
  const placeIds = useMemo(() => (places ? new Set(places.map((p) => p.id)) : undefined), [places]);

  useEffect(() => {
    const request = focusRequest.current;
    if (!request || !usuals || !request.ready(usuals)) return;
    focusRequest.current = null;
    const card = request.id
      ? Array.from(listRef.current?.querySelectorAll<HTMLElement>('li[data-usual-id]') ?? []).find((li) => li.dataset.usualId === request.id)
      : undefined;
    const target = card?.querySelector<HTMLElement>('button[aria-haspopup="menu"]') ?? newRef.current;
    target?.focus();
  }, [usuals]);

  const log = (usual: Usual) => {
    const draft = usualReviewDraft(usual, initialContext(now(), timeSettings(profile)), placeIds);
    setReviewDraft(draft);
    // Review replaces this screen; its Back puts Usuals back in its place.
    navigate(PATHS.review, { replace: true });
  };

  const move = async (usual: Usual, direction: MoveDirection, list: readonly Usual[]) => {
    const from = list.findIndex((u) => u.id === usual.id);
    const to = direction === 'up' ? from - 1 : from + 1;
    focusRequest.current = { id: usual.id, ready: (next) => next.findIndex((u) => u.id === usual.id) === to };
    const moved = await moveUsual(usual.id, direction);
    if (!moved) {
      focusRequest.current = null;
      return;
    }
    setAnnouncement(moveAnnouncement(usual.name, direction, to + 1, list.length));
  };

  const remove = async (usual: Usual, list: readonly Usual[]) => {
    const at = list.findIndex((u) => u.id === usual.id);
    const neighbour = list[at + 1] ?? list[at - 1];
    focusRequest.current = { ready: (next) => !next.some((u) => u.id === usual.id), ...(neighbour ? { id: neighbour.id } : {}) };
    const undo = await removeUsual(usual.id);
    showToast('Usual deleted', () => void undo());
  };

  const saveSuggestion = async (suggestion: UsualSuggestion) => {
    if (savingKey) return;
    setSavingKey(suggestion.key);
    try {
      const { undo } = await saveSuggestedUsual(suggestion);
      showToast('Saved as a Usual', () => void undo());
    } catch {
      showToast("Couldn't save this Usual. Try again.");
    } finally {
      setSavingKey(null);
    }
  };

  const dismissSuggestion = (suggestion: UsualSuggestion) => {
    dismissUsualSuggestion(suggestion.key);
    showToast('Suggestion hidden', () => restoreUsualSuggestion(suggestion.key));
  };

  const saveEditor = async ({ name, items }: UsualEditorValue) => {
    try {
      if (editor?.mode === 'edit') {
        const undo = await editUsual(editor.usual.id, { name, items });
        setEditor(null);
        showToast('Usual saved', undo ? () => void undo() : undefined);
      } else {
        const { undo } = await createUsual({ name, items });
        setEditor(null);
        showToast('Usual saved', () => void undo());
      }
    } catch (error) {
      showToast("Couldn't save this Usual. Try again.");
      throw error;
    }
  };

  const editing = editor?.mode === 'edit' ? editor.usual : undefined;
  const editingPlace = editing?.placeId ? placeById.get(editing.placeId) : undefined;
  const libraryCtx = useMemo<LibraryContext>(
    () => ({ ...(editingPlace ? { place: editingPlace } : {}), personal: personal ?? [] }),
    [editingPlace, personal],
  );

  const shownSuggestions = (suggestions ?? []).slice(0, SUGGESTIONS_SHOWN);

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Usuals" onBack={back} backLabel={hasHistory ? 'Back' : 'Back to More'} />

      <section aria-labelledby={yoursId}>
        <SectionHeading>
          <span id={yoursId}>Your Usuals</span>
        </SectionHeading>
        {/* Wait for the Places too, so a card's Place doesn't pop in after it. */}
        {usuals === undefined || places === undefined ? (
          <div className={styles.inset}>
            <SkeletonList count={3} label="Loading your Usuals" />
          </div>
        ) : usuals.length === 0 ? (
          <div className={styles.inset}>
            <EmptyState
              icon={<Repeat size={24} strokeWidth={2} />}
              headline="No Usuals yet"
              body="Save a meal you have often and log it in one tap."
              actionLabel="New Usual"
              onAction={() => setEditor({ mode: 'new' })}
            />
          </div>
        ) : (
          <>
            <ul ref={listRef} className={styles.stack}>
              {usuals.map((usual, index) => {
                const placeName = usual.placeId ? placeById.get(usual.placeId)?.name : undefined;
                return (
                  <li key={usual.id} data-usual-id={usual.id}>
                    <UsualCard
                      name={usual.name}
                      itemsLabel={usualItemsLabel(usual.items, usual.name)}
                      kcalLabel={usualKcalLabel(usual.items)}
                      {...(placeName ? { placeName } : {})}
                      useCount={usual.useCount}
                      onLog={() => log(usual)}
                      onEdit={() => setEditor({ mode: 'edit', usual })}
                      {...(index > 0 ? { onMoveUp: () => void move(usual, 'up', usuals) } : {})}
                      {...(index < usuals.length - 1 ? { onMoveDown: () => void move(usual, 'down', usuals) } : {})}
                      onDelete={() => void remove(usual, usuals)}
                    />
                  </li>
                );
              })}
            </ul>
            <div className={styles.inset}>
              <button ref={newRef} type="button" className={styles.newButton} onClick={() => setEditor({ mode: 'new' })}>
                <Plus size={18} strokeWidth={2} aria-hidden="true" />
                New Usual
              </button>
            </div>
          </>
        )}
      </section>

      {shownSuggestions.length > 0 ? (
        <section aria-labelledby={suggestedId}>
          <SectionHeading>
            <span id={suggestedId}>Suggested</span>
          </SectionHeading>
          <ul className={styles.stack}>
            {shownSuggestions.map((s) => {
              const placeName = s.meal.placeId ? placeById.get(s.meal.placeId)?.name : undefined;
              return (
                <li key={s.key}>
                  <UsualSuggestionCard
                    name={s.name}
                    times={s.times}
                    kcalLabel={usualKcalLabel(s.meal.items)}
                    {...(placeName ? { placeName } : {})}
                    busy={savingKey !== null}
                    onSave={() => void saveSuggestion(s)}
                    onDismiss={() => dismissSuggestion(s)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <UsualEditorSheet
        open={editor !== null}
        {...(editing ? { usual: editing } : {})}
        ctx={libraryCtx}
        onClose={() => setEditor(null)}
        onSave={saveEditor}
      />
    </div>
  );
}
