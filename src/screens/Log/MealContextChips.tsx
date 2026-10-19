import { useState, type ReactNode } from 'react';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ContextChipRow, MealSlotChip, PlaceChip, TimeChip } from '@/components/ContextChips/ContextChips';
import { PlacePicker, type PlaceOption } from '@/components/PlacePicker/PlacePicker';
import { SlotPicker } from '@/components/SlotPicker/SlotPicker';
import { TimePicker, type TimeOption } from '@/components/TimePicker/TimePicker';
import { Button } from '@/components/ui/Button';
import { db } from '@/db/db';
import { createPlace, guessPlaceType, type LatLng } from '@/db/logging';
import type { Id, Instant, LogicalDay, Place, PlaceType } from '@/domain/types';
import {
  QUICK_TIMES,
  absoluteTimeLabel,
  afterMidnightHint,
  customTimeAt,
  mealDayOf,
  quickTimeAt,
  slotFor,
  timeChipLabel,
  wallClockValue,
  type MealContext,
  type TimeId,
  type TimeSettings,
} from './mealTime';
import styles from './MealContextChips.module.css';

export interface MealContextChipsProps {
  value: MealContext;
  onChange: (next: MealContext) => void;
  /** Places to choose from, most recently used first. */
  places: readonly Place[];
  /** Places within ~150 m right now; the chip says "Nearby" when one of them is chosen. */
  nearbyIds?: readonly Id[];
  /** The kind a Place created here gets (the plate builder only makes economy-rice Places). */
  newPlaceType?: PlaceType;
  /** Where we are, saved once on a Place created here. */
  coords?: LatLng;
  /** The check-in's "last night" time, offered as its own choice. */
  presetAt?: Instant;
  /** The logical day custom times belong to (editing a meal keeps it on its own day). Default: the preset's day, else today. */
  baseDay?: LogicalDay;
  now: Date;
  settings: TimeSettings;
  /** Review shows "Now · 7:10pm". */
  withClock?: boolean;
  /** Called when the user picks or creates a Place themselves. */
  onPlacePicked?: () => void;
  /** Extra content at the end of the row (a photo thumbnail). */
  extra?: ReactNode;
}

type Picker = 'place' | 'time' | 'slot' | null;

/** Place · time · slot chips with their pickers, shared by Log (S09), Review (S11) and Plate (S24). */
export function MealContextChips({
  value,
  onChange,
  places,
  nearbyIds = [],
  newPlaceType,
  coords,
  presetAt,
  baseDay: baseDayProp,
  now,
  settings,
  withClock,
  onPlacePicked,
  extra,
}: MealContextChipsProps) {
  const [open, setOpen] = useState<Picker>(null);
  const [createdIds, setCreatedIds] = useState<readonly Id[]>([]);
  const close = () => setOpen(null);

  const place = value.placeId ? places.find((p) => p.id === value.placeId) : undefined;
  const placeName = place?.name ?? (value.placeId ? undefined : value.placeName);
  const options: PlaceOption[] = places.map((p) => ({ id: p.id, name: p.name, type: p.type, nearby: nearbyIds.includes(p.id) }));

  const withTime = (timeId: TimeId, eatenAt: Instant | undefined): MealContext => {
    const next: MealContext = { ...value, timeId, slot: value.slotTouched ? value.slot : slotFor(eatenAt, now, settings) };
    if (eatenAt) next.eatenAt = eatenAt;
    else delete next.eatenAt;
    return next;
  };

  const timeOptions: TimeOption[] = [
    ...(presetAt ? [{ id: 'preset', label: absoluteTimeLabel(presetAt, now, settings) }] : []),
    ...QUICK_TIMES.map((t) => ({ id: t.id, label: t.label })),
  ];
  // The day a custom time is read on: fixed for this meal (an edited meal's own day, the check-in's
  // day), else today. Never the previous pick: a wheel spinning past a time still ahead of now
  // moves the meal to last night, and turning it back must bring it to today again.
  const baseDay = baseDayProp ?? (presetAt ? mealDayOf(presetAt, now, settings) : mealDayOf(undefined, now, settings));

  const createHere = async (name: string) => {
    let created: Place;
    try {
      created = await createPlace(db, name, newPlaceType ?? guessPlaceType(name), coords);
    } catch {
      // Not saved (storage full or blocked): keep the typed name; saving the meal creates the Place.
      onPlacePicked?.();
      const next: MealContext = { ...value, placeName: name };
      delete next.placeId;
      onChange(next);
      close();
      return;
    }
    setCreatedIds((ids) => [...ids, created.id]);
    onPlacePicked?.();
    const next: MealContext = { ...value, placeId: created.id };
    delete next.placeName;
    onChange(next);
    close();
  };

  return (
    <>
      <ContextChipRow>
        <PlaceChip
          name={placeName}
          nearby={value.placeId !== undefined && nearbyIds.includes(value.placeId)}
          isNew={value.placeId !== undefined && createdIds.includes(value.placeId)}
          onPress={() => setOpen('place')}
        />
        <TimeChip label={timeChipLabel(value, now, settings, withClock)} onPress={() => setOpen('time')} />
        <MealSlotChip slot={value.slot} onPress={() => setOpen('slot')} />
        {extra}
      </ContextChipRow>

      <BottomSheet open={open === 'place'} onClose={close} title="Where did you eat?">
        <SheetTitle>Where did you eat?</SheetTitle>
        <div className={styles.sheetBody}>
          <PlacePicker
            places={options}
            selectedId={value.placeId}
            initialQuery={value.placeId ? '' : (value.placeName ?? '')}
            onSelect={(id) => {
              onPlacePicked?.();
              const next: MealContext = { ...value, placeId: id };
              delete next.placeName;
              onChange(next);
              close();
            }}
            onCreate={(name) => void createHere(name)}
            onClear={() => {
              onPlacePicked?.();
              const next: MealContext = { ...value };
              delete next.placeId;
              delete next.placeName;
              onChange(next);
              close();
            }}
          />
        </div>
      </BottomSheet>

      <BottomSheet open={open === 'time'} onClose={close} title="When did you eat?">
        <SheetTitle>When did you eat?</SheetTitle>
        <div className={styles.sheetBody}>
          <TimePicker
            options={timeOptions}
            selectedId={value.timeId === 'custom' ? undefined : value.timeId}
            customValue={value.timeId === 'custom' && value.eatenAt ? wallClockValue(value.eatenAt, settings) : undefined}
            afterMidnightHint={afterMidnightHint(value.eatenAt ?? now.toISOString(), settings)}
            onSelect={(id) => {
              if (id === 'preset') onChange(withTime('preset', presetAt));
              else if (id === 'now' || id === 'm30' || id === 'h1') onChange(withTime(id, quickTimeAt(id, now)));
              close();
            }}
            onCustom={(v) => {
              const at = customTimeAt(v, baseDay, now, settings);
              if (at) onChange(withTime('custom', at));
            }}
          />
          <div className={styles.done}>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={open === 'slot'} onClose={close} title="Which meal?">
        <SheetTitle>Which meal?</SheetTitle>
        <div className={styles.sheetBody}>
          <SlotPicker
            value={value.slot}
            onChange={(slot) => {
              onChange({ ...value, slot, slotTouched: true });
              close();
            }}
          />
        </div>
      </BottomSheet>
    </>
  );
}
