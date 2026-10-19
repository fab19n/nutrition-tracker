import { byId } from '@/data/catalogue';
import { DEFAULT_TZ } from '@/domain/day';
import { roundTo10 } from '@/domain/format';
import { itemFromCatalogue, sumMacros } from '@/domain/meal';
import type { ActivityLevel, PlaceType, Sex } from '@/domain/types';
import { defaultDailyMinimum, type RegularPick } from '@/db/settings';
import type { SetupInput } from '@/db/actions';
import { fieldValue } from './fields';

/** Answers collected across S02–S07. Kept in memory only; nothing is saved until Done. */
export interface SetupDraft {
  age: string;
  sex: Sex | null;
  heightCm: string;
  weightKg: string;
  activity: ActivityLevel | null;
  paceKgPerWeek: number;
  /** null = follow the default for the chosen sex. */
  dailyMinimumKcal: number | null;
  /** Keys of the picked regulars (preset keys and `cat:<id>` for added ones). */
  regulars: string[];
  /** Regulars added with "Add your own", in the order they were added. */
  customRegulars: RegularOption[];
  places: PlaceDraft[];
  rolloverHour: number;
}

/** What every step (S02–S07) gets from the flow. */
export interface StepProps {
  /** 1-based. */
  step: number;
  total: number;
  draft: SetupDraft;
  update: (patch: Partial<SetupDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

export interface PlaceDraft {
  key: string;
  /** "Home", "Your mamak". */
  role: string;
  placeholder: string;
  name: string;
  type: PlaceType;
}

export interface RegularOption extends RegularPick {
  key: string;
}

export const PACE_OPTIONS = [0.25, 0.5, 0.75] as const;

/** Common Malaysian regulars (S05), each a Usual of catalogue lines. */
export const REGULAR_PRESETS: readonly RegularOption[] = [
  {
    key: 'roti-teh',
    name: 'Roti canai + teh tarik',
    foods: [{ catalogueId: 'roti-canai-dhal' }, { catalogueId: 'teh-tarik' }],
    slot: 'breakfast',
  },
  { key: 'nasi-lemak', name: 'Nasi lemak bungkus', foods: [{ catalogueId: 'nasi-lemak-bungkus' }], slot: 'breakfast' },
  { key: 'kaya-kopi', name: 'Bread, kaya, kopi', foods: [{ catalogueId: 'kaya-toast-kopi' }], slot: 'breakfast' },
  { key: 'mee-goreng', name: 'Mee goreng mamak', foods: [{ catalogueId: 'mee-goreng-mamak' }] },
  { key: 'teh-o-ais', name: 'Teh o ais', foods: [{ catalogueId: 'teh-o-ais' }] },
  {
    key: 'economy-rice',
    name: 'Economy rice, ayam + sayur',
    foods: [{ catalogueId: 'rice-economy' }, { catalogueId: 'ayam-goreng-tray' }, { catalogueId: 'sayur-campur' }],
    slot: 'lunch',
  },
  {
    key: 'nasi-kandar',
    name: 'Nasi kandar ayam goreng',
    foods: [{ catalogueId: 'rice-nasi-kandar' }, { catalogueId: 'ayam-goreng-mamak' }, { catalogueId: 'kuah-campur' }],
    slot: 'lunch',
  },
  { key: 'kopi-o', name: 'Kopi o', foods: [{ catalogueId: 'kopi-o' }] },
];

export const PLACE_TYPES: readonly { type: PlaceType; label: string }[] = [
  { type: 'mamak', label: 'Mamak' },
  { type: 'economyRice', label: 'Economy rice' },
  { type: 'kopitiam', label: 'Kopitiam' },
  { type: 'hawker', label: 'Hawker' },
  { type: 'home', label: 'Home' },
  { type: 'other', label: 'Other' },
];

let placeKeySeq = 0;

export function newPlaceDraft(partial: Partial<Omit<PlaceDraft, 'key'>> = {}): PlaceDraft {
  placeKeySeq += 1;
  return { key: `place-${placeKeySeq}`, role: 'Another place', placeholder: 'Name', name: '', type: 'other', ...partial };
}

export function initialDraft(): SetupDraft {
  return {
    age: '',
    sex: null,
    heightCm: '',
    weightKg: '',
    activity: null,
    paceKgPerWeek: 0.5,
    dailyMinimumKcal: null,
    regulars: [],
    customRegulars: [],
    places: [
      newPlaceDraft({ role: 'Home', placeholder: 'Home', name: 'Home', type: 'home' }),
      newPlaceDraft({ role: 'Your mamak', placeholder: 'e.g. Nasi kandar near home', type: 'mamak' }),
      newPlaceDraft({ role: 'Your economy-rice stall', placeholder: 'e.g. Kedai near home', type: 'economyRice' }),
    ],
    rolloverHour: 5,
  };
}

export function dailyMinimumOf(draft: Pick<SetupDraft, 'dailyMinimumKcal' | 'sex'>): number {
  return draft.dailyMinimumKcal ?? defaultDailyMinimum(draft.sex);
}

/** Body numbers once S02 is valid. */
export function bodyOf(draft: SetupDraft): { age: number; sex: Sex; heightCm: number; weightKg: number } | null {
  const age = fieldValue('age', draft.age);
  const heightCm = fieldValue('heightCm', draft.heightCm);
  const weightKg = fieldValue('weightKg', draft.weightKg);
  if (age === null || heightCm === null || weightKg === null || !draft.sex) return null;
  return { age, sex: draft.sex, heightCm, weightKg };
}

/** Every regular on offer: the presets, then the ones added by hand. */
export function regularOptions(draft: Pick<SetupDraft, 'customRegulars'>): RegularOption[] {
  return [...REGULAR_PRESETS, ...draft.customRegulars];
}

export function pickedRegulars(draft: SetupDraft): RegularPick[] {
  const picked = new Set(draft.regulars);
  return regularOptions(draft)
    .filter((o) => picked.has(o.key))
    .map(({ name, foods, slot }) => (slot ? { name, foods, slot } : { name, foods }));
}

/** Best guess for a regular at its default portions, rounded to 10 ("~560"). */
export function regularKcal(option: RegularPick): number {
  const macros = option.foods.flatMap((f) => {
    const entry = byId(f.catalogueId);
    return entry ? [itemFromCatalogue(entry, f.variant === undefined ? { id: 'x' } : { variant: f.variant, id: 'x' }).unitMacros] : [];
  });
  return roundTo10(sumMacros(macros).kcal);
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

/** The completeSetup input (regulars go separately, as combos). Null while an answer is missing. */
export function toSetupInput(draft: SetupDraft): Omit<SetupInput, 'regulars'> | null {
  const body = bodyOf(draft);
  if (!body || !draft.activity) return null;
  return {
    ...body,
    activity: draft.activity,
    paceKgPerWeek: draft.paceKgPerWeek,
    dailyMinimumKcal: dailyMinimumOf(draft),
    places: draft.places.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), type: p.type })),
    rolloverHour: draft.rolloverHour,
    timeZone: deviceTimeZone(),
  };
}
