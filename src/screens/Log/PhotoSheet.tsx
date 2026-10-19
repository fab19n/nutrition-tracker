import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { PATHS } from '@/app/paths';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { Button } from '@/components/ui/Button';
import { db } from '@/db/db';
import { storePhoto } from '@/db/logging';
import { useUiStore } from '@/state/ui';
import { photoDraft } from './drafts';
import { useBlobUrl } from './hooks';
import type { MealContext } from './mealTime';
import { compressPhoto } from './photo';
import styles from './LogSheet.module.css';

export interface PhotoSheetProps {
  open: boolean;
  /** The picked or taken photo. */
  file: File | null;
  meal: MealContext;
  onClose: () => void;
}

/** S25 in a sheet: the photo, a caption box, Estimate. The photo is shrunk and kept before estimating. */
export function PhotoSheet({ open, file, meal, onClose }: PhotoSheetProps) {
  return (
    <BottomSheet open={open && file !== null} onClose={onClose} title="Add a photo">
      <SheetTitle>Add a photo</SheetTitle>
      {file ? <PhotoBody file={file} meal={meal} /> : null}
    </BottomSheet>
  );
}

function PhotoBody({ file, meal }: { file: File; meal: MealContext }) {
  const navigate = useNavigate();
  const setReviewDraft = useUiStore((s) => s.setReviewDraft);
  const showToast = useUiStore((s) => s.showToast);
  const url = useBlobUrl(file);
  const captionId = useId();
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  const estimate = async () => {
    setBusy(true);
    try {
      const { blob, thumb } = await compressPhoto(file);
      const photoId = await storePhoto(db, blob, thumb);
      setReviewDraft(photoDraft(photoId, caption, meal));
      navigate(PATHS.estimating, { replace: true });
    } catch {
      setBusy(false);
      showToast("Couldn't keep that photo. Try again.");
    }
  };

  return (
    <div className={styles.sheetBody}>
      <div className={styles.photoFrame}>
        {url ? <img className={styles.photo} src={url} alt="Your meal" /> : <div className={styles.photoPlaceholder} aria-hidden="true" />}
      </div>
      <label htmlFor={captionId} className={styles.captionLabel}>
        Add a few words, e.g. kuah banjir
      </label>
      <input
        id={captionId}
        className={styles.caption}
        value={caption}
        placeholder="nasi kandar, kuah banjir"
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
