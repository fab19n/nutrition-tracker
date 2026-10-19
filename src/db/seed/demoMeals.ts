import type { LogicalDay, LogMethod, MealLog, MealSlot } from '@/domain/types';
import { demoItem, type DemoFoodKey, type ItemSpec } from './demoFoods';
import { DEMO_IDS, type DemoPlaceKey } from './demoIds';
import { addMinutes, mytAt } from './time';

/**
 * Every demo meal from setup (Mon 28 Sep) to today (Fri 16 Oct 2026, 7:10pm MYT).
 *
 * - Week before (28 Sep – 4 Oct): settling in, ~1,800 a day, the user teaches the nasi kandar
 *   stall "Mamak big" rice and kuah banjir on Sun 4 Oct.
 * - Last week (5–11 Oct): the weekly review's week. 4 nasi kandar nights at 950, 8 teh tarik
 *   (3 kurang) and 3 milo ais (~2,200 kcal of drinks), late suppers on Fri and Sat,
 *   a makan Saturday at 2,420 and a Sunday with dinner missing (not counted). Tuesday's
 *   futsal adds 470 to the week, so the week ends 13,420 of 13,070: the design's +350.
 * - This week (12–15 Oct): 1,620 / 1,710 / 1,540 / 1,680, with the kari ayam pot cooked Wed.
 * - Today: breakfast 10:40am (late for you) and lunch 2:15pm, 1,230 kcal.
 *
 * Times are Malaysian wall clock; '24:30' is 12:30am on the next calendar day, which the 5am
 * rollover still counts as the same logical day.
 */

interface MealSpec {
  time: string;
  slot: MealSlot;
  name: string;
  method: LogMethod;
  place?: DemoPlaceKey;
  priceRm?: number;
  /** What was typed; text-method meals without one get their item names. */
  text?: string;
  items: (DemoFoodKey | ItemSpec)[];
}

interface DaySpec {
  day: LogicalDay;
  meals: MealSpec[];
}

// Reused orders -------------------------------------------------------------

const tehTarik = (variant: 'Kurang' | 'Normal'): ItemSpec => ({ food: 'tehTarik', variant });
const miloAis: ItemSpec = { food: 'miloAis', variant: 'Normal' };
const tehOAisKurang: ItemSpec = { food: 'tehOAis', variant: 'Kurang' };
const rice = (variant: 'Half' | '1 scoop' | '1.5 scoops'): ItemSpec => ({ food: 'rice', variant });
const kuahSome: ItemSpec = { food: 'kuahOnRice', variant: 'Some' };

/** Before the stall learned anything: normal rice, normal kuah (~750). */
const nasiKandarNormal: (DemoFoodKey | ItemSpec)[] = [
  { food: 'nasiKandarRice', variant: 'Normal' },
  { food: 'ayamGorengMamak', variant: '1 piece' },
  { food: 'kuahCampur', variant: 'Normal' },
];

/** After the correction on 4 Oct: Mamak big and banjir come pre-selected (~950). */
const nasiKandarLearned: (DemoFoodKey | ItemSpec)[] = [
  { food: 'nasiKandarRice', variant: 'Mamak big', source: 'yourCorrection' },
  { food: 'ayamGorengMamak', variant: '1 piece' },
  { food: 'kuahCampur', variant: 'Banjir', source: 'yourCorrection' },
];

const nasiKandarDinner = (time: string): MealSpec => ({
  time,
  slot: 'dinner',
  name: 'Nasi kandar ayam goreng',
  method: 'placeOrder',
  place: 'nasiKandar',
  priceRm: 14.5,
  items: nasiKandarLearned,
});

const breadKayaKopi = (time: string): MealSpec => ({
  time,
  slot: 'breakfast',
  name: 'Bread, kaya, kopi',
  method: 'usual',
  place: 'home',
  items: ['breadKayaKopi'],
});

// Days -----------------------------------------------------------------------

const WEEK_BEFORE: DaySpec[] = [
  {
    day: '2026-09-28',
    meals: [
      { time: '09:30', slot: 'breakfast', name: 'Roti canai + teh tarik', method: 'text', text: 'roti canai, teh tarik', items: ['rotiCanai', tehTarik('Normal')] },
      { time: '13:30', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 9.5, items: [rice('1 scoop'), 'ayamMasakMerah', 'kangkungBelacan', 'kubisGoreng', kuahSome] },
      { time: '20:45', slot: 'dinner', name: 'Rice, ikan goreng kunyit, sayur', method: 'text', place: 'home', items: [rice('1 scoop'), 'ikanGorengKunyit', 'sayurGoreng'] },
    ],
  },
  {
    day: '2026-09-29',
    meals: [
      breadKayaKopi('09:20'),
      { time: '13:30', slot: 'lunch', name: 'Rice, ayam masak kicap, sup sayur', method: 'text', place: 'home', items: [rice('Half'), 'ayamMasakKicap', 'supSayur'] },
      { time: '20:40', slot: 'dinner', name: 'Nasi kandar ayam goreng', method: 'text', place: 'nasiKandar', priceRm: 12, text: 'nasi kandar ayam goreng kuah campur', items: nasiKandarNormal },
      { time: '22:15', slot: 'snack', name: 'Cream crackers', method: 'text', place: 'home', items: ['creamCrackers'] },
    ],
  },
  {
    day: '2026-09-30',
    meals: [
      { time: '09:35', slot: 'breakfast', name: 'Roti telur + teh o ais', method: 'text', place: 'nasiKandar', priceRm: 4.2, items: ['rotiTelur', tehOAisKurang] },
      { time: '13:25', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 8.5, items: [rice('1 scoop'), 'ikanGoreng', 'kangkungBelacan', 'taugeh', kuahSome] },
      { time: '16:30', slot: 'snack', name: 'Karipap', method: 'text', items: ['karipap'] },
      { time: '20:50', slot: 'dinner', name: 'Rice, ayam masak kicap, sayur', method: 'text', place: 'home', items: [rice('1 scoop'), 'ayamMasakKicap', 'sayurGoreng'] },
    ],
  },
  {
    day: '2026-10-01',
    meals: [
      { time: '09:30', slot: 'breakfast', name: 'Nasi lemak bungkus + teh o ais', method: 'text', items: ['nasiLemakBungkus', tehOAisKurang] },
      { time: '13:40', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 8, items: [rice('1 scoop'), 'telurDadar', 'terungSambal', 'kubisGoreng', kuahSome] },
      { time: '20:30', slot: 'dinner', name: 'Rice, ikan goreng kunyit, sup sayur', method: 'text', place: 'home', items: [rice('1 scoop'), 'ikanGorengKunyit', 'supSayur', 'telurGoreng'] },
    ],
  },
  {
    day: '2026-10-02',
    meals: [
      { time: '09:30', slot: 'breakfast', name: 'Roti canai + teh tarik', method: 'text', items: ['rotiCanai', tehTarik('Kurang')] },
      { time: '13:30', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 9.5, items: [rice('1 scoop'), 'ayamGorengTray', 'kubisGoreng', 'taugeh', kuahSome] },
      { time: '21:00', slot: 'dinner', name: 'Nasi kandar ayam goreng', method: 'text', place: 'nasiKandar', priceRm: 12, items: nasiKandarNormal },
    ],
  },
  {
    day: '2026-10-03',
    meals: [
      { time: '10:00', slot: 'breakfast', name: 'Roti telur + teh tarik', method: 'text', place: 'nasiKandar', priceRm: 4.5, items: ['rotiTelur', tehTarik('Normal')] },
      { time: '13:45', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 9, items: [rice('1 scoop'), 'ayamMasakMerah', 'taugeh', 'kubisGoreng', kuahSome] },
      { time: '20:30', slot: 'dinner', name: 'Bihun goreng', method: 'text', text: 'bihun goreng small', items: [{ food: 'bihunGoreng', variant: 'Small' }] },
    ],
  },
  {
    day: '2026-10-04',
    meals: [
      breadKayaKopi('09:45'),
      { time: '13:30', slot: 'lunch', name: 'Rice, ikan goreng kunyit, sayur', method: 'text', place: 'home', items: [rice('1 scoop'), 'ikanGorengKunyit', 'sayurGoreng'] },
      {
        time: '20:45',
        slot: 'dinner',
        name: 'Nasi kandar ayam goreng',
        method: 'text',
        place: 'nasiKandar',
        priceRm: 14.5,
        text: 'nasi kandar ayam goreng, kuah banjir',
        items: [
          { food: 'nasiKandarRice', variant: 'Mamak big', editedFrom: 'Normal', source: 'yourCorrection' },
          { food: 'ayamGorengMamak', variant: '1 piece' },
          { food: 'kuahCampur', variant: 'Banjir', editedFrom: 'Normal', source: 'yourCorrection' },
        ],
      },
    ],
  },
];

const LAST_WEEK: DaySpec[] = [
  {
    day: '2026-10-05',
    meals: [
      { time: '09:30', slot: 'breakfast', name: 'Teh tarik + roti bakar kaya', method: 'text', items: [tehTarik('Kurang'), 'rotiBakarKaya'] },
      { time: '13:30', slot: 'lunch', name: 'Rice, ayam masak kicap', method: 'text', place: 'home', items: [rice('Half'), 'ayamMasakKicap'] },
      { time: '16:30', slot: 'snack', name: 'Karipap', method: 'text', items: ['karipap'] },
      nasiKandarDinner('20:50'),
    ],
  },
  {
    day: '2026-10-06',
    meals: [
      // Futsal day: an egg with breakfast and more rice at lunch.
      { time: '08:40', slot: 'breakfast', name: 'Roti canai, telur goreng + teh tarik', method: 'text', items: ['rotiCanai', 'telurGoreng', tehTarik('Normal')] },
      { time: '13:30', slot: 'lunch', name: 'Rice, ayam masak kicap, sup sayur', method: 'text', place: 'home', items: [rice('1 scoop'), 'ayamMasakKicap', 'supSayur'] },
      // After futsal (7–8pm).
      nasiKandarDinner('21:50'),
    ],
  },
  {
    day: '2026-10-07',
    meals: [
      { time: '09:30', slot: 'breakfast', name: 'Teh tarik + cream crackers', method: 'text', place: 'home', items: [tehTarik('Kurang'), 'creamCrackers'] },
      { time: '13:30', slot: 'lunch', name: 'Rice, ikan goreng kunyit, kubis, taugeh', method: 'text', place: 'home', items: [rice('Half'), 'ikanGorengKunyit', 'kubisGoreng', 'taugeh'] },
      nasiKandarDinner('20:40'),
    ],
  },
  {
    day: '2026-10-08',
    meals: [
      { time: '09:25', slot: 'breakfast', name: 'Roti canai + teh tarik', method: 'text', items: ['rotiCanai', tehTarik('Normal')] },
      { time: '13:35', slot: 'lunch', name: 'Rice, ikan goreng kunyit', method: 'text', place: 'home', items: [rice('Half'), 'ikanGorengKunyit'] },
      nasiKandarDinner('20:45'),
    ],
  },
  {
    day: '2026-10-09',
    meals: [
      { time: '09:30', slot: 'breakfast', name: 'Teh tarik + karipap', method: 'text', items: [tehTarik('Kurang'), 'karipap'] },
      { time: '13:20', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 11, items: [rice('1.5 scoops'), 'ayamGorengTray', 'terungSambal', 'tauhuGoreng', 'taugeh', kuahSome] },
      { time: '20:30', slot: 'dinner', name: 'Sup sayur, telur goreng', method: 'text', place: 'home', items: ['supSayur', 'telurGoreng'] },
      { time: '24:30', slot: 'supper', name: 'Maggi kari', method: 'text', place: 'home', items: ['maggiKari'] },
    ],
  },
  {
    day: '2026-10-10',
    meals: [
      { time: '10:30', slot: 'breakfast', name: 'Mee rebus + milo ais', method: 'text', items: [{ food: 'meeRebus', variant: 'Normal' }, miloAis] },
      { time: '14:30', slot: 'lunch', name: 'Rice, telur goreng, sup sayur', method: 'text', place: 'home', items: [rice('Half'), 'telurGoreng', 'supSayur'] },
      { time: '19:45', slot: 'dinner', name: 'Char kuey teow + milo ais', method: 'text', place: 'medanSelera', priceRm: 13, items: [{ food: 'charKueyTeow', variant: 'Normal' }, miloAis] },
      { time: '23:40', slot: 'supper', name: 'Teh tarik + kuih lapis', method: 'text', items: [tehTarik('Normal'), 'kuihLapis'] },
    ],
  },
  {
    day: '2026-10-11',
    meals: [
      { time: '10:00', slot: 'breakfast', name: 'Teh tarik + kuih lapis', method: 'text', items: [tehTarik('Normal'), 'kuihLapis'] },
      { time: '14:00', slot: 'lunch', name: 'Rice, ikan goreng kunyit, milo ais', method: 'text', place: 'home', items: [rice('Half'), 'ikanGorengKunyit', miloAis] },
      { time: '17:00', slot: 'snack', name: 'Teh tarik', method: 'text', items: [tehTarik('Normal')] },
    ],
  },
];

const THIS_WEEK: DaySpec[] = [
  {
    day: '2026-10-12',
    meals: [
      breadKayaKopi('09:30'),
      { time: '13:30', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 10, items: [rice('1 scoop'), 'ayamGorengTray', 'kangkungBelacan', 'tauhuGoreng'] },
      { time: '20:40', slot: 'dinner', name: 'Rice, ayam masak kicap, sayur', method: 'text', place: 'home', items: [rice('1 scoop'), 'ayamMasakKicap', 'sayurGoreng'] },
    ],
  },
  {
    day: '2026-10-13',
    meals: [
      { time: '09:25', slot: 'breakfast', name: 'Nasi lemak bungkus + teh o ais', method: 'text', items: ['nasiLemakBungkus', tehOAisKurang] },
      { time: '13:35', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 7.5, items: [rice('Half'), 'ikanGoreng', 'tauhuGoreng'] },
      {
        time: '20:50',
        slot: 'dinner',
        name: 'Nasi kandar ayam goreng',
        method: 'placeOrder',
        place: 'nasiKandar',
        priceRm: 12,
        // Trying the lighter order: the learned defaults switched back to normal.
        items: [
          { food: 'nasiKandarRice', variant: 'Normal', editedFrom: 'Mamak big' },
          { food: 'ayamGorengMamak', variant: '1 piece' },
          { food: 'kuahCampur', variant: 'Normal', editedFrom: 'Banjir' },
        ],
      },
    ],
  },
  {
    day: '2026-10-14',
    meals: [
      breadKayaKopi('09:30'),
      { time: '13:30', slot: 'lunch', name: 'Rice, telur goreng, sayur', method: 'text', place: 'home', items: [rice('Half'), 'telurGoreng', 'sayurGoreng'] },
      { time: '16:30', slot: 'snack', name: 'Kuih lapis', method: 'text', items: ['kuihLapis'] },
      { time: '20:30', slot: 'dinner', name: 'Kari ayam + rice', method: 'pot', place: 'home', items: ['kariAyamServing', rice('1 scoop')] },
    ],
  },
  {
    day: '2026-10-15',
    meals: [
      breadKayaKopi('09:30'),
      { time: '13:30', slot: 'lunch', name: 'Kari ayam + rice', method: 'pot', place: 'home', items: ['kariAyamServing', rice('Half')] },
      { time: '20:45', slot: 'dinner', name: 'Ayam bakar, rice, ulam', method: 'text', place: 'medanSelera', priceRm: 11, items: ['ayamBakar', rice('1 scoop'), 'ulamSambal', tehOAisKurang] },
    ],
  },
];

const TODAY: DaySpec = {
  day: '2026-10-16',
  meals: [
    { time: '10:40', slot: 'breakfast', name: 'Roti canai + teh tarik', method: 'text', place: 'nasiKandar', priceRm: 4.8, text: 'roti canai, teh tarik', items: ['rotiCanai', tehTarik('Normal')] },
    { time: '14:15', slot: 'lunch', name: 'Economy rice', method: 'plate', place: 'kedai', priceRm: 9.5, items: [rice('1 scoop'), 'ayamMasakMerah', 'kangkungBelacan', 'kubisGoreng', kuahSome] },
  ],
};

export const DEMO_DAY_SPECS: readonly DaySpec[] = [...WEEK_BEFORE, ...LAST_WEEK, ...THIS_WEEK, TODAY];

/** Logged a couple of minutes after eating; a supper after midnight is logged straight away too. */
const LOGGED_AFTER_MINUTES = 2;

function buildMeal(day: LogicalDay, spec: MealSpec, id: string): MealLog {
  const eatenAt = mytAt(day, spec.time);
  const createdAt = addMinutes(eatenAt, LOGGED_AFTER_MINUTES);
  const items = spec.items.map((item, index) => demoItem(`${id}-${index + 1}`, item));
  const meal: MealLog = {
    id,
    eatenAt,
    logicalDay: day,
    slot: spec.slot,
    name: spec.name,
    items,
    method: spec.method,
    finished: 'all',
    createdAt,
    updatedAt: createdAt,
    syncState: 'local',
  };
  if (spec.place) meal.placeId = DEMO_IDS.places[spec.place];
  if (spec.priceRm !== undefined) meal.priceRm = spec.priceRm;
  const text = spec.text ?? (spec.method === 'text' ? items.map((i) => i.name.toLowerCase()).join(', ') : undefined);
  if (text) meal.text = text;
  return meal;
}

/** Ids are `meal-<day>-<slot>`, with `-2`, `-3` … when a slot repeats on a day. */
export function buildDemoMeals(): MealLog[] {
  return DEMO_DAY_SPECS.flatMap(({ day, meals }) => {
    const seen = new Map<MealSlot, number>();
    return meals.map((spec) => {
      const n = (seen.get(spec.slot) ?? 0) + 1;
      seen.set(spec.slot, n);
      return buildMeal(day, spec, `meal-${day}-${spec.slot}${n > 1 ? `-${n}` : ''}`);
    });
  });
}
