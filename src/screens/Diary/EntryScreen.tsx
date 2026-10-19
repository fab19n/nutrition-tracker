import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Copy, Pencil, Repeat, SearchX, Trash2 } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PhotoThumb } from '@/components/PhotoThumb/PhotoThumb';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { SourceTag } from '@/components/SourceTag/SourceTag';
import { TimingTag } from '@/components/TimingTag/TimingTag';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { deleteMeal, duplicateMeal } from '@/db/actions';
import { findMatchingUsual, saveMealAsUsual, useMealLookup, usePhotoUrl } from '@/db/diary';
import { useDaySummary, usePlace, useProfile, useToday, useUsuals } from '@/db/hooks';
import { DEFAULT_TZ } from '@/domain/day';
import { fmtApprox, fmtDayShort, fmtRange, fmtRm, fmtTime, roundTo10 } from '@/domain/format';
import { itemMacros, mealMacros, mealRange } from '@/domain/meal';
import type { Finished, LogMethod, MealLog } from '@/domain/types';
import { useUiStore, type ReviewMeta } from '@/state/ui';
import { useInFlight } from '@/screens/inFlight';
import { diaryDayPath, itemDetail, originalEstimateKcal } from './diaryModel';
import styles from './Entry.module.css';

const METHOD_LABEL: Record<LogMethod, string> = {
  text: 'Typed',
  photo: 'Photo',
  plate: 'Plate builder',
  usual: 'Usual',
  placeOrder: 'Usual order here',
  pot: 'Pot',
  idea: 'Meal idea',
  manual: 'Entered by you',
  guess: 'Check-in guess',
};

const FINISHED_LABEL: Record<Finished, string> = { all: 'All of it', most: 'Most of it', half: 'About half' };

function kcalLabel(kcal: number): string {
  return fmtApprox(roundTo10(kcal));
}

/** The review draft that reopens this meal in S11 edit mode; Back returns to the entry. */
function editDraftMeta(meal: MealLog): ReviewMeta {
  const meta: ReviewMeta = {
    method: meal.method,
    editingMealId: meal.id,
    eatenAt: meal.eatenAt,
    slot: meal.slot,
    name: meal.name,
    finished: meal.finished,
  };
  if (meal.placeId) meta.placeId = meal.placeId;
  if (meal.priceRm !== undefined) meta.priceRm = meal.priceRm;
  if (meal.photoId) meta.photoId = meal.photoId;
  if (meal.text) meta.text = meal.text;
  return meta;
}

interface EntryDetailProps {
  meal: MealLog;
  onDeleted: (meal: MealLog) => void;
}

function EntryDetail({ meal, onDeleted }: EntryDetailProps) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const profile = useProfile();
  const tz = profile?.timeZone ?? DEFAULT_TZ;
  const place = usePlace(meal.placeId);
  const usuals = useUsuals();
  const summary = useDaySummary(meal.logicalDay);
  const thumbUrl = usePhotoUrl(meal.photoId, 'thumb');
  const photoUrl = usePhotoUrl(meal.photoId, 'full');
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A double tap on Duplicate or Save as Usual writes once.
  const inFlight = useInFlight();

  const total = mealMacros(meal).kcal;
  const range = mealRange(meal);
  const original = originalEstimateKcal(meal);
  const tag = meal.isGuess ? undefined : summary?.tags[meal.id];
  const isUsual = usuals ? findMatchingUsual(usuals, meal) !== undefined : false;

  const edit = () => {
    setReviewDraft({
      flow: 'edit',
      title: 'Edit entry',
      items: meal.items.map((item) => ({ ...item })),
      meta: editDraftMeta(meal),
      backTo: PATHS.entry(meal.id),
    });
    navigate(PATHS.review);
  };

  const duplicate = () =>
    inFlight.run('duplicate', async () => {
      const copy = await duplicateMeal(meal.id);
      if (!copy) return;
      showToast(`Logged again today · ${kcalLabel(mealMacros(copy).kcal)} kcal`, () => {
        void deleteMeal(copy.id);
      });
    });

  const saveAsUsual = () =>
    inFlight.run('usual', async () => {
      const saved = await saveMealAsUsual(meal.id);
      if (!saved.created) {
        showToast('Already one of your Usuals');
        return;
      }
      showToast('Saved as a Usual', () => {
        void saved.undo();
      });
    });

  const remove = async () => {
    setConfirmDelete(false);
    const undo = await deleteMeal(meal.id);
    showToast('Entry deleted', () => {
      void undo();
    });
    onDeleted(meal);
  };

  return (
    <>
      {meal.photoId ? (
        <div className={styles.photo}>
          {photoOpen && photoUrl ? (
            <button type="button" className={styles.fullPhoto} onClick={() => setPhotoOpen(false)} aria-label="Close photo">
              <img src={photoUrl} alt={meal.name} />
            </button>
          ) : (
            <PhotoThumb url={thumbUrl} finished={meal.finished} size={120} alt={meal.name} onPress={() => setPhotoOpen(true)} />
          )}
        </div>
      ) : null}

      <Card radius="card" padding="14px 16px" className={[styles.card, meal.isGuess ? styles.guessCard : ''].filter(Boolean).join(' ')}>
        <div className={styles.meta}>
          {SLOT_LABEL[meal.slot]} · {fmtDayShort(meal.logicalDay)} · {fmtTime(meal.eatenAt, tz)}
        </div>
        <h2 className={['t-card-headline', styles.name].join(' ')}>{meal.name}</h2>
        {meal.isGuess || tag ? (
          <div className={styles.tags}>
            {meal.isGuess ? <Pill tone="neutral">Guess</Pill> : null}
            {tag ? <TimingTag kind={tag} /> : null}
          </div>
        ) : null}
        {meal.text ? <p className={styles.quote}>&ldquo;{meal.text}&rdquo;</p> : null}
        <dl className={styles.facts}>
          {place ? (
            <div className={styles.fact}>
              <dt>Place</dt>
              <dd>{place.name}</dd>
            </div>
          ) : null}
          {meal.priceRm !== undefined ? (
            <div className={styles.fact}>
              <dt>Price</dt>
              <dd>{fmtRm(meal.priceRm)}</dd>
            </div>
          ) : null}
          {meal.finished !== 'all' ? (
            <div className={styles.fact}>
              <dt>Finished</dt>
              <dd>{FINISHED_LABEL[meal.finished]}</dd>
            </div>
          ) : null}
          <div className={styles.fact}>
            <dt>Logged as</dt>
            <dd>{METHOD_LABEL[meal.method]}</dd>
          </div>
        </dl>
      </Card>

      <SectionHeading>Items</SectionHeading>
      <Card radius="card" padding="4px 14px" className={styles.itemsCard}>
        <ul className={styles.items}>
          {meal.items.map((item) => {
            const detail = itemDetail(item);
            return (
              <li key={item.id} className={styles.item}>
                <div className={styles.itemMain}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemName}>{item.name}</span>
                    <SourceTag source={item.source} />
                  </div>
                  {detail ? <div className={styles.itemDetail}>{detail}</div> : null}
                </div>
                <span className={styles.itemKcal}>
                  {/* A pending item's rough guess is in the total, so the row shows it too. */}
                  {kcalLabel(itemMacros(item).kcal)}
                  <span className="sr-only"> kcal</span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className={styles.total}>
          <div>
            <div className={styles.totalLabel}>Best guess</div>
            <div className={styles.totalValue}>{kcalLabel(total)} kcal</div>
          </div>
          <div className={styles.totalRange}>likely {fmtRange(range)} kcal</div>
        </div>
      </Card>
      {original !== null ? (
        <p className={styles.history}>
          Original estimate {kcalLabel(original)} · edited by you
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button icon={<Pencil size={18} strokeWidth={2} />} onClick={edit}>
          Edit entry
        </Button>
        <div className={styles.secondary}>
          <Button
            variant="secondary"
            size="md"
            icon={<Copy size={18} strokeWidth={2} />}
            onClick={() => void duplicate()}
            disabled={inFlight.busy('duplicate')}
          >
            Duplicate
          </Button>
          <Button
            variant="secondary"
            size="md"
            icon={<Repeat size={18} strokeWidth={2} />}
            onClick={() => void saveAsUsual()}
            disabled={isUsual || inFlight.busy('usual')}
          >
            {isUsual ? 'In your Usuals' : 'Save as Usual'}
          </Button>
        </div>
        <Button variant="ghost" size="md" className={styles.delete} icon={<Trash2 size={18} strokeWidth={2} />} onClick={() => setConfirmDelete(true)}>
          Delete entry
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this entry?"
        body={`${meal.name}, ${kcalLabel(total)} kcal. You can undo straight after.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

/** @design S14 Entry detail — photo, meta, read-only items with the range, history, and Edit / Duplicate / Save as Usual / Delete. */
export default function EntryScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const today = useToday();
  const lookup = useMealLookup(id);
  const meal = lookup?.meal ?? null;

  const back = () => {
    if (location.key !== 'default') goBack(navigate);
    else navigate(meal ? diaryDayPath(meal.logicalDay, today) : PATHS.diary);
  };

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Entry" onBack={back} />
      {lookup === undefined ? (
        <div className={styles.loading}>
          <SkeletonList count={3} label="Loading the entry" />
        </div>
      ) : meal ? (
        <EntryDetail meal={meal} onDeleted={(m) => navigate(diaryDayPath(m.logicalDay, today), { replace: true })} />
      ) : (
        <div className={styles.missing}>
          <EmptyState
            icon={<SearchX />}
            headline="This entry isn't here"
            body="It may have been deleted. Everything else is still in your diary."
            actionLabel="Open diary"
            onAction={() => navigate(PATHS.diary)}
          />
        </div>
      )}
    </div>
  );
}
