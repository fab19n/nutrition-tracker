import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeftRight, Plus, X } from 'lucide-react';
import { PATHS } from '@/app/paths';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { Button } from '@/components/ui/Button';
import { db } from '@/db/db';
import { storePhoto } from '@/db/logging';
import { renewDriveTokenOnTap } from '@/drive';
import { useUiStore } from '@/state/ui';
import { photoDraft } from './drafts';
import { useBlobUrl } from './hooks';
import type { MealContext } from './mealTime';
import { compressLabel, compressPhoto } from './photo';
import styles from './LogSheet.module.css';

export interface PhotoSheetProps {
  open: boolean;
  /** The picked or taken photo. */
  file: File | null;
  meal: MealContext;
  onClose: () => void;
}

/**
 * S25 in a sheet: the photo, a caption box, Estimate. The photo is shrunk and kept before
 * estimating. A nutrition label can join it as a second photo, or be the only one (then the
 * caption says how much); the label is read for the estimate and never kept.
 */
export function PhotoSheet({ open, file, meal, onClose }: PhotoSheetProps) {
  return (
    <BottomSheet open={open && file !== null} onClose={onClose} title="Add a photo">
      <SheetTitle>Add a photo</SheetTitle>
      {file ? <PhotoBody key={`${file.name}:${file.size}:${file.lastModified}`} file={file} meal={meal} /> : null}
    </BottomSheet>
  );
}

function PhotoBody({ file, meal }: { file: File; meal: MealContext }) {
  const navigate = useNavigate();
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const showToast = useUiStore((s) => s.showToast);
  const [food, setFood] = useState<File | null>(file);
  const [label, setLabel] = useState<File | null>(null);
  const foodUrl = useBlobUrl(food ?? undefined);
  const labelUrl = useBlobUrl(label ?? undefined);
  const labelInput = useRef<HTMLInputElement>(null);
  const captionId = useId();
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const labelOnly = food === null && label !== null;

  const onLabel = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (picked) setLabel(picked);
  };

  const estimate = async () => {
    if (!food && !label) return;
    // Inside the tap, before anything else: a Google token for the photo's upload, when one is due
    // (Google's window may open and close by itself). The estimate never waits for it.
    if (food) renewDriveTokenOnTap();
    setBusy(true);
    try {
      let photoId: string | undefined;
      if (food) {
        const { blob, thumb } = await compressPhoto(food);
        photoId = await storePhoto(db, blob, thumb);
      }
      const labelPhoto = label ? await compressLabel(label) : undefined;
      setReviewDraft(photoDraft(photoId, caption, meal, labelPhoto));
      navigate(PATHS.estimating, { replace: true });
    } catch {
      setBusy(false);
      showToast("Couldn't keep that photo. Try again.");
    }
  };

  return (
    <div className={styles.sheetBody}>
      <div className={styles.photoFrame}>
        {labelOnly ? (
          labelUrl ? <img className={styles.photo} src={labelUrl} alt="Nutrition label" /> : <div className={styles.photoPlaceholder} aria-hidden="true" />
        ) : foodUrl ? (
          <img className={styles.photo} src={foodUrl} alt="Your meal" />
        ) : (
          <div className={styles.photoPlaceholder} aria-hidden="true" />
        )}
      </div>

      <div className={styles.photoTools}>
        {label && !labelOnly ? (
          <span className={styles.labelChip}>
            {labelUrl ? <img className={styles.labelThumb} src={labelUrl} alt="" /> : null}
            Nutrition label
            <button type="button" className={styles.toolIcon} aria-label="Remove the label photo" onClick={() => setLabel(null)} disabled={busy}>
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        ) : null}
        {!label ? (
          <button type="button" className={styles.tool} onClick={() => labelInput.current?.click()} disabled={busy}>
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Add nutrition label
          </button>
        ) : null}
        {food && !label ? (
          <button
            type="button"
            className={styles.tool}
            onClick={() => {
              setLabel(food);
              setFood(null);
            }}
            disabled={busy}
          >
            <ArrowLeftRight size={16} strokeWidth={2} aria-hidden="true" />
            This photo is a label
          </button>
        ) : null}
        {labelOnly ? (
          <button
            type="button"
            className={styles.tool}
            onClick={() => {
              setFood(label);
              setLabel(null);
            }}
            disabled={busy}
          >
            <ArrowLeftRight size={16} strokeWidth={2} aria-hidden="true" />
            It's the food, not a label
          </button>
        ) : null}
      </div>
      <input
        ref={labelInput}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.file}
        tabIndex={-1}
        aria-label="Photo of the nutrition label"
        onChange={onLabel}
      />

      <label htmlFor={captionId} className={styles.captionLabel}>
        {label ? 'How much did you have? e.g. 1 tbsp, 1 bun' : 'Add a few words, e.g. kuah banjir'}
      </label>
      <input
        id={captionId}
        className={styles.caption}
        value={caption}
        placeholder={label ? '1 heaped tbsp' : 'nasi kandar, kuah banjir'}
        autoComplete="off"
        enterKeyHint="go"
        onChange={(e) => setCaption(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) {
            e.preventDefault();
            void estimate();
          }
        }}
      />
      <div className={styles.photoAction}>
        <Button onClick={() => void estimate()} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Getting it ready…' : 'Estimate'}
        </Button>
      </div>
    </div>
  );
}
