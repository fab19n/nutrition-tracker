import { MealRow } from '@/components/MealRow/MealRow';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { usePhotoThumbUrl } from '@/db/today';
import { fmtApprox, fmtTime, roundTo10 } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import type { TimingTagKind } from '@/domain/timing';
import type { MealLog } from '@/domain/types';

export interface TodayMealRowProps {
  meal: MealLog;
  placeName?: string;
  tag?: TimingTagKind;
  tz: string;
  /** Still queued here while sync is stuck (usePendingMealIds): shows "Waiting to sync". */
  pending?: boolean;
  onOpen: (meal: MealLog) => void;
  onDuplicate: (meal: MealLog) => void;
  onDelete: (meal: MealLog) => void;
}

/** One of today's meals as a C29 MealRow: "Breakfast · 10:40am · Nasi kandar near home", "~560". */
export function TodayMealRow({ meal, placeName, tag, tz, pending, onOpen, onDuplicate, onDelete }: TodayMealRowProps) {
  const thumbUrl = usePhotoThumbUrl(meal.photoId);
  const kcal = roundTo10(mealMacros(meal).kcal);
  return (
    <MealRow
      slotLabel={SLOT_LABEL[meal.slot]}
      timeLabel={fmtTime(meal.eatenAt, tz)}
      placeName={placeName}
      name={meal.name}
      kcalLabel={fmtApprox(kcal)}
      tag={tag}
      thumbUrl={thumbUrl}
      finished={meal.finished}
      isGuess={meal.isGuess}
      pending={pending}
      onPress={() => onOpen(meal)}
      onDuplicate={() => onDuplicate(meal)}
      onDelete={() => onDelete(meal)}
    />
  );
}
