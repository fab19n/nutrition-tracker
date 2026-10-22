// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, TABLE_NAMES, type KiraMakanDb } from '@/db/db';
import { loadEstimateContext } from '@/db/logging';
import { DEMO_IDS, loadDemo } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { instantAt } from '@/domain/day';
import type { MealItem, MealLog } from '@/domain/types';
import { estimateLocally } from '@/estimate/localEstimator';
import {
  DISH_CHECK_FEEDBACK_ID,
  DishCheckChangedError,
  createDishCheckActions,
  getDishCheckStatusIn,
  getDishCheckViewIn,
} from './dishCheck';
import { getInsightsView } from './insightsData';

const TODAY = '2026-10-16';
const at = { today: TODAY };
const RICE_KEY = 'rice-economy';
const MAMAK_RICE = 'rice-nasi-kandar';
const TEH_O_AIS = 'teh-o-ais';
const SUP_SAYUR = 'name:sup sayur';

let db: KiraMakanDb;
let actions: ReturnType<typeof createDishCheckActions>;
const opened: KiraMakanDb[] = [];

async function open(options?: Parameters<typeof createDb>[1]): Promise<void> {
  db = createDb(`dishes-${crypto.randomUUID()}`, options);
  opened.push(db);
  actions = createDishCheckActions(db);
}

afterEach(async () => {
  setDemoClock(false);
  await Promise.all(opened.splice(0).map((d) => d.delete()));
});

/** Every table's rows, for "nothing else changed" checks. */
async function dump(database: KiraMakanDb = db): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of [...TABLE_NAMES, 'syncOutbox'] as const) out[name] = await database.table(name).toArray();
  return out;
}

async function row() {
  return db.insightFeedback.get(DISH_CHECK_FEEDBACK_ID);
}

async function view() {
  const v = await getDishCheckViewIn(db, at);
  if (!v) throw new Error('no view');
  return v;
}

function rowOf(v: Awaited<ReturnType<typeof view>>, key: string) {
  const found = v.rows.find((r) => r.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found;
}

function typedItem(name: string, kcal: number, id: string): MealItem {
  return { id, name, unitMacros: { kcal, proteinG: 5, carbsG: 20, fatG: 5 }, quantity: 1, uncertainty: 0.15, source: 'yourCorrection' };
}

/** One meal a day with the given dish names, on days Oct 3 … Oct 16 (14 days). */
function diary(perDay: (index: number) => string[]): MealLog[] {
  return Array.from({ length: 14 }, (_, index) => {
    const day = `2026-10-${String(3 + index).padStart(2, '0')}`;
    return {
      id: `meal-${index}`,
      eatenAt: instantAt(day, 13, 30),
      logicalDay: day,
      slot: 'lunch',
      name: 'Lunch',
      items: perDay(index).map((name, n) => typedItem(name, 300, `item-${index}-${n}`)),
      method: 'text',
      finished: 'all',
      createdAt: instantAt(day, 13, 32),
      updatedAt: instantAt(day, 13, 32),
      syncState: 'local',
    } satisfies MealLog;
  });
}

describe('on the demo world (Fri 16 Oct, day 19)', () => {
  beforeEach(async () => {
    await open();
    await createActions(db).loadDemoData();
  });

  describe('reading', () => {
    it('is ready, with the 19 logged days and the dishes logged twice or more', async () => {
      const status = await getDishCheckStatusIn(db, at);
      expect(status).toEqual({ phase: 'ready', loggedDays: 19, dishCount: 27, total: 27, answered: 0, hidden: false });
      const v = await view();
      expect(v.rows).toHaveLength(27);
      expect(v.today).toBe(TODAY);
      expect(v.summary).toBeUndefined();
      expect(v.rows[0]).toMatchObject({ key: RICE_KEY, name: 'Rice (economy rice)', source: 'catalogue', kcal: 200, portion: '1 scoop' });
      expect(v.rows.every((r) => r.times >= 2)).toBe(true);
      expect(v.rows.length).toBeLessThanOrEqual(30);
      const times = v.rows.map((r) => r.times);
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('shows the nasi kandar rice as a Place default at Mamak big, with the Place', async () => {
      const rice = rowOf(await view(), MAMAK_RICE);
      expect(rice).toMatchObject({ source: 'placeDefault', portion: 'Mamak big', kcal: 430, placeName: 'Nasi kandar near home', times: 8 });
    });

    it('shows Teh o ais as your correction, and a typed sup as an AI guess', async () => {
      const v = await view();
      expect(rowOf(v, TEH_O_AIS)).toMatchObject({ source: 'yourCorrection', portion: 'Kurang', kcal: 60 });
      expect(rowOf(v, TEH_O_AIS).placeName).toBeUndefined();
      expect(rowOf(v, SUP_SAYUR)).toMatchObject({ source: 'aiGuess', name: 'Sup sayur' });
    });

    it('keeps two catalogue dishes with the same name apart', async () => {
      const v = await view();
      const names = v.rows.filter((r) => r.name === 'Ayam goreng').map((r) => r.key);
      expect(names.sort()).toEqual(['ayam-goreng-mamak', 'ayam-goreng-tray']);
    });

    it('writes nothing', async () => {
      const capturing = createDb(`dishes-capture-${crypto.randomUUID()}`, { capture: () => true });
      opened.push(capturing);
      await loadDemo(capturing);
      const before = await dump(capturing);
      await getDishCheckStatusIn(capturing, at);
      await getDishCheckViewIn(capturing, at);
      await getDishCheckViewIn(capturing, { today: '2026-12-01' });
      await getInsightsView(capturing, { today: TODAY, now: new Date('2026-10-16T11:10:00.000Z') });
      expect(await dump(capturing)).toEqual(before);
    });

    it('is undefined without a profile', async () => {
      await db.profile.clear();
      expect(await getDishCheckStatusIn(db, at)).toBeUndefined();
      expect(await getDishCheckViewIn(db, at)).toBeUndefined();
    });
  });

  describe('before there is enough to check', () => {
    it('is locked under 14 days with a real meal', async () => {
      await db.meals.where('logicalDay').below('2026-10-10').delete();
      const status = await getDishCheckStatusIn(db, at);
      expect(status).toMatchObject({ phase: 'locked', loggedDays: 7 });
      expect((await view()).rows).toEqual([]);
      await expect(actions.answerDish(RICE_KEY, 'right', at)).rejects.toBeInstanceOf(DishCheckChangedError);
      expect(await row()).toBeUndefined();
    });

    it('does not count a guess entry as a logged day', async () => {
      await db.meals.where('logicalDay').below('2026-10-10').delete();
      // 7 real days plus 8 guess-only days is still 7.
      await db.meals.bulkPut(diary(() => ['Guess']).slice(0, 6).map((m, i) => ({ ...m, id: `guess-${i}`, isGuess: true, logicalDay: `2026-10-0${i + 1}`, eatenAt: instantAt(`2026-10-0${i + 1}`, 13, 0) })));
      expect((await getDishCheckStatusIn(db, at))?.loggedDays).toBe(7);
    });

    it('is thin with 14 days but fewer than 5 dishes logged twice', async () => {
      await db.meals.clear();
      // Days 0-7 repeat Dish 0-3 twice each; every day has a dish of its own.
      await db.meals.bulkPut(diary((i) => [`Unique ${i}`, ...(i < 8 ? [`Repeat ${i % 4}`] : [])]));
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ phase: 'thin', loggedDays: 14, dishCount: 4, total: 4 });
      expect((await view()).rows).toEqual([]);
      await expect(actions.answerDish('name:repeat 0', 'right', at)).rejects.toBeInstanceOf(DishCheckChangedError);
    });

    it('is ready once a fifth dish has been logged twice', async () => {
      await db.meals.clear();
      await db.meals.bulkPut(diary((i) => [`Unique ${i}`, ...(i < 10 ? [`Repeat ${i % 5}`] : [])]));
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ phase: 'ready', loggedDays: 14, dishCount: 5 });
    });
  });

  describe('Usually less on a Place default (nasi kandar rice)', () => {
    it('moves the Place’s learned portion and its correction to Normal, and leaves past meals alone', async () => {
      const meals = await db.meals.toArray();
      const result = await actions.answerDish(MAMAK_RICE, 'less', at);
      expect(result).toMatchObject({ kind: 'variant', fromKcal: 430, toKcal: 330 });

      const personal = await db.personalItems.get('personal-nasi-kandar-rice');
      expect(personal).toMatchObject({ scope: 'place', placeId: DEMO_IDS.places.nasiKandar, selectedVariant: 1, corrections: 3 });
      expect(personal?.unitMacros.kcal).toBe(330);
      expect((await db.places.get(DEMO_IDS.places.nasiKandar))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 1, 'kuah-campur': 2 });
      expect(await db.meals.toArray()).toEqual(meals);

      const v = await view();
      expect(rowOf(v, MAMAK_RICE)).toMatchObject({ source: 'placeDefault', kcal: 330, portion: 'Normal', answer: 'less', fromKcal: 430, saved: true });
      expect(v).toMatchObject({ phase: 'inProgress', answered: 1, total: 27 });
    });

    it('is what the local estimator starts a nasi kandar rice at from now on', async () => {
      const ask = async () => {
        const ctx = await loadEstimateContext(db, DEMO_IDS.places.nasiKandar);
        const item = estimateLocally({ text: 'nasi kandar rice' }, ctx).items[0];
        return item?.variants?.[item.selectedVariant ?? -1]?.label;
      };
      expect(await ask()).toBe('Mamak big');
      await actions.answerDish(MAMAK_RICE, 'less', at);
      expect(await ask()).toBe('Normal');
    });

    it('scales the top chip when there is nothing above it (Mamak big 430 → 540)', async () => {
      const result = await actions.answerDish(MAMAK_RICE, 'more', at);
      expect(result).toMatchObject({ kind: 'scale', fromKcal: 430, toKcal: 540 });
      const personal = await db.personalItems.get('personal-nasi-kandar-rice');
      expect(personal).toMatchObject({ selectedVariant: 2 });
      expect(personal?.unitMacros.kcal).toBe(540);
      expect(personal?.variants?.[2]?.macros.kcal).toBe(540);
      expect(personal?.variants?.[1]?.macros.kcal).toBe(330);
      expect((await db.places.get(DEMO_IDS.places.nasiKandar))?.defaultVariants[MAMAK_RICE]).toBe(2);
      expect(rowOf(await view(), MAMAK_RICE)).toMatchObject({ kcal: 540, portion: 'Mamak big', fromKcal: 430 });
    });
  });

  describe('a dish of your own (Teh o ais)', () => {
    it('Usually more moves to the next chip up and writes no Place default', async () => {
      const places = await db.places.toArray();
      const result = await actions.answerDish(TEH_O_AIS, 'more', at);
      expect(result).toMatchObject({ kind: 'variant', fromKcal: 60, toKcal: 110 });
      expect(await db.personalItems.get('personal-teh-o-ais')).toMatchObject({ scope: 'dish', selectedVariant: 2, corrections: 4 });
      expect(await db.places.toArray()).toEqual(places);
      expect(rowOf(await view(), TEH_O_AIS)).toMatchObject({ source: 'yourCorrection', kcal: 110, portion: 'Normal' });
    });
  });

  describe('Looks right', () => {
    it('writes nothing for a catalogue dish, but remembers the answer', async () => {
      const before = await dump();
      const result = await actions.answerDish(RICE_KEY, 'right', at);
      expect(result).toMatchObject({ kind: 'none', fromKcal: 200, toKcal: 200 });
      const after = await dump();
      expect(after.personalItems).toEqual(before.personalItems);
      expect(after.places).toEqual(before.places);
      expect(rowOf(await view(), RICE_KEY)).toMatchObject({ answer: 'right', kcal: 200 });
      expect(rowOf(await view(), RICE_KEY).saved).toBeUndefined();
    });

    it('makes an AI guess your own value, with a range of ±20%', async () => {
      const result = await actions.answerDish(SUP_SAYUR, 'right', at);
      expect(result).toMatchObject({ kind: 'confirm', fromKcal: 90, toKcal: 90 });
      const saved = (await db.personalItems.toArray()).find((p) => p.name === 'Sup sayur');
      expect(saved).toMatchObject({ scope: 'dish', uncertainty: 0.2, corrections: 1 });
      expect(saved?.catalogueId).toBeUndefined();
      expect(saved?.unitMacros.kcal).toBe(90);
      expect(rowOf(await view(), SUP_SAYUR)).toMatchObject({ source: 'yourCorrection', kcal: 90, answer: 'right', saved: true });
    });
  });

  describe('the frozen list', () => {
    it('is stored with the first answer, in the order shown, and survives new logging', async () => {
      const shown = (await view()).rows;
      await actions.answerDish(RICE_KEY, 'right', at);
      const stored = await row();
      expect(stored).toMatchObject({ ruleId: 'topDishes', feedback: 'dishCheck' });
      expect(stored?.dishCheck?.startedOn).toBe(TODAY);
      expect(stored?.dishCheck?.dishes.map((d) => d.key)).toEqual(shown.map((r) => r.key));
      expect(stored?.dishCheck?.dishes.map((d) => d.times)).toEqual(shown.map((r) => r.times));
      expect(stored?.dishCheck?.dishes.find((d) => d.key === MAMAK_RICE)?.placeId).toBe(DEMO_IDS.places.nasiKandar);

      // A new favourite arrives, and a listed dish is logged again.
      const items = [typedItem('Zebra cake', 300, 'zebra-1'), { ...typedItem('Karipap', 130, 'karipap-new'), catalogueId: 'karipap' }];
      await db.meals.bulkPut(
        Array.from({ length: 6 }, (_, i): MealLog => ({
          id: `late-${i}`,
          eatenAt: instantAt(TODAY, 15 + (i % 2), i),
          logicalDay: TODAY,
          slot: 'snack',
          name: 'Snack',
          items,
          method: 'text',
          finished: 'all',
          createdAt: instantAt(TODAY, 16, 0),
          updatedAt: instantAt(TODAY, 16, 0),
          syncState: 'local',
        })),
      );
      const after = await view();
      expect(after.rows.map((r) => r.key)).toEqual(shown.map((r) => r.key));
      expect(after.rows.map((r) => r.times)).toEqual(shown.map((r) => r.times));
      expect(after.rows.some((r) => r.key === 'name:zebra cake')).toBe(false);
      // The live number still follows what you've taught the app.
      expect(after.total).toBe(27);
    });

    it('keeps a row’s Place when the share changes later', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      // Eight more nasi kandar rice logs at another Place: dish-wide by the numbers now.
      await db.meals.bulkPut(
        Array.from({ length: 10 }, (_, i): MealLog => ({
          id: `elsewhere-${i}`,
          eatenAt: instantAt(TODAY, 8, i),
          logicalDay: TODAY,
          slot: 'breakfast',
          name: 'Rice',
          placeId: DEMO_IDS.places.home,
          items: [{ ...typedItem('Rice (nasi kandar)', 330, `r-${i}`), catalogueId: MAMAK_RICE }],
          method: 'text',
          finished: 'all',
          createdAt: instantAt(TODAY, 8, 30),
          updatedAt: instantAt(TODAY, 8, 30),
          syncState: 'local',
        })),
      );
      expect(rowOf(await view(), MAMAK_RICE)).toMatchObject({ source: 'placeDefault', kcal: 430, placeName: 'Nasi kandar near home', times: 8 });
    });

    it('drops a dish whose meals were all deleted from the list and the counts', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      await actions.answerDish('nasi-lemak-bungkus', 'right', at);
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ total: 27, answered: 2 });
      await db.meals.filter((m) => m.items.some((i) => i.catalogueId === 'nasi-lemak-bungkus')).delete();
      const v = await view();
      expect(v).toMatchObject({ total: 26, answered: 1 });
      expect(v.rows.some((r) => r.key === 'nasi-lemak-bungkus')).toBe(false);
      await expect(actions.answerDish('nasi-lemak-bungkus', 'more', at)).rejects.toBeInstanceOf(DishCheckChangedError);
    });
  });

  describe('as days pass', () => {
    it('keeps every dish and answer of a check in progress once its meals are older than 8 weeks', async () => {
      await actions.answerDish(RICE_KEY, 'more', at);
      await actions.answerDish(TEH_O_AIS, 'less', at);
      for (const later of ['2026-11-25', '2026-12-01', '2026-12-15']) {
        expect(await getDishCheckStatusIn(db, { today: later })).toMatchObject({ phase: 'inProgress', total: 27, answered: 2 });
        const v = (await getDishCheckViewIn(db, { today: later }))!;
        expect(v.rows).toHaveLength(27);
        expect(rowOf(v, RICE_KEY)).toMatchObject({ answer: 'more', fromKcal: 200 });
      }
      // A dish that was not asked yet can still be answered.
      await expect(actions.answerDish(MAMAK_RICE, 'less', { today: '2026-12-15' })).resolves.toMatchObject({ kind: 'variant', fromKcal: 430 });
    });

    it('reads a done check 60+ days later with the same summary', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      await actions.answerDish(TEH_O_AIS, 'more', at);
      await actions.answerDish(MAMAK_RICE, 'less', at);
      await actions.finishDishCheck(at);
      const done = await view();

      const later = { today: '2026-12-20' };
      const v = (await getDishCheckViewIn(db, later))!;
      expect(v).toMatchObject({ phase: 'done', answered: 3, total: 27 });
      expect(v.rows.map((r) => r.key)).toEqual(done.rows.map((r) => r.key));
      expect(v.summary).toEqual(done.summary);
      expect(v.summary).toMatchObject({ right: 1, more: 1, less: 1, notChecked: 24, updated: 2 });
      expect(v.summary?.changes).toHaveLength(2);
    });

    it('still drops a dish whose meals were deleted, long after the check started', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      await actions.answerDish('nasi-lemak-bungkus', 'right', at);
      await db.meals.filter((m) => m.items.some((i) => i.catalogueId === 'nasi-lemak-bungkus')).delete();
      const v = (await getDishCheckViewIn(db, { today: '2026-12-20' }))!;
      expect(v).toMatchObject({ total: 26, answered: 1 });
      expect(v.rows.some((r) => r.key === 'nasi-lemak-bungkus')).toBe(false);
    });

    it('offers a new check from the rolling 8 weeks only, so a check not started goes back to locked', async () => {
      expect(await getDishCheckStatusIn(db, { today: '2026-12-20' })).toMatchObject({ phase: 'locked', loggedDays: 0 });
    });
  });

  describe('Undo', () => {
    it('puts the personal item and the Place’s portion back exactly, and deletes the row when it was the only answer', async () => {
      const before = await dump();
      const { undo } = await actions.answerDish(MAMAK_RICE, 'less', at);
      expect(await row()).toBeDefined();
      await undo();
      const after = await dump();
      expect(after.personalItems).toEqual(before.personalItems);
      expect(after.places).toEqual(before.places);
      expect(await row()).toBeUndefined();
      expect((await view()).phase).toBe('ready');
    });

    it('deletes a personal item the answer created', async () => {
      const { undo } = await actions.answerDish(SUP_SAYUR, 'right', at);
      expect((await db.personalItems.toArray()).some((p) => p.name === 'Sup sayur')).toBe(true);
      await undo();
      expect((await db.personalItems.toArray()).some((p) => p.name === 'Sup sayur')).toBe(false);
    });

    it('clears only that entry, so the others keep their answers', async () => {
      const first = await actions.answerDish(RICE_KEY, 'right', at);
      await actions.answerDish(TEH_O_AIS, 'more', at);
      await first.undo();
      const stored = await row();
      const answered = stored?.dishCheck?.dishes.filter((d) => d.answer !== undefined).map((d) => d.key);
      expect(answered).toEqual([TEH_O_AIS]);
      expect(stored?.dishCheck?.dishes.find((d) => d.key === RICE_KEY)).toEqual({ key: RICE_KEY, name: 'Rice (economy rice)', times: 25, placeId: DEMO_IDS.places.home });
      expect(rowOf(await view(), TEH_O_AIS)).toMatchObject({ answer: 'more', kcal: 110 });
      expect((await view()).phase).toBe('inProgress');
    });

    it('lets a cleared dish be answered again', async () => {
      const { undo } = await actions.answerDish(RICE_KEY, 'more', at);
      await undo();
      await expect(actions.answerDish(RICE_KEY, 'less', at)).resolves.toMatchObject({ kind: 'variant', toKcal: 100 });
    });

    it('goes back to the row before when the first answer is undone after a Not now', async () => {
      await actions.dismissDishCheck(at);
      const { undo } = await actions.answerDish(RICE_KEY, 'right', at);
      expect((await row())?.pausedUntil).toBeUndefined();
      await undo();
      expect(await row()).toMatchObject({ feedback: 'dishCheck', pausedUntil: '2026-11-13' });
      expect((await row())?.dishCheck).toBeUndefined();
    });
  });

  describe('Done', () => {
    it('sets doneAt, counts the answers and the changes, and the undo clears only doneAt', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      await actions.answerDish(TEH_O_AIS, 'more', at);
      await actions.answerDish(MAMAK_RICE, 'less', at);
      const done = await actions.finishDishCheck(at);
      expect(done).toMatchObject({ answered: 3, updated: 2 });
      const stored = await row();
      expect(stored?.dishCheck?.doneAt).toBeDefined();
      expect(stored?.dishCheck?.dishes.filter((d) => d.answer)).toHaveLength(3);

      const v = await view();
      expect(v.phase).toBe('done');
      expect(v.doneAt).toBe(stored?.dishCheck?.doneAt);
      expect(v.summary).toEqual({
        right: 1,
        more: 1,
        less: 1,
        notChecked: 24,
        updated: 2,
        changes: [
          { key: TEH_O_AIS, name: 'Teh o ais', fromKcal: 60, toKcal: 110 },
          { key: MAMAK_RICE, name: 'Rice (nasi kandar)', fromKcal: 430, toKcal: 330 },
        ].sort((a, b) => v.rows.findIndex((r) => r.key === a.key) - v.rows.findIndex((r) => r.key === b.key)),
      });

      await done.undo();
      const reopened = await row();
      expect(reopened?.dishCheck?.doneAt).toBeUndefined();
      expect(reopened?.dishCheck?.dishes.filter((d) => d.answer)).toHaveLength(3);
      expect((await view()).phase).toBe('inProgress');
    });

    it('can finish with nothing left to check, and refuses to finish twice or before starting', async () => {
      await expect(actions.finishDishCheck(at)).rejects.toBeInstanceOf(DishCheckChangedError);
      await actions.answerDish(RICE_KEY, 'right', at);
      await actions.finishDishCheck(at);
      await expect(actions.finishDishCheck(at)).rejects.toBeInstanceOf(DishCheckChangedError);
    });

    it('asks nothing more afterwards', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      await actions.finishDishCheck(at);
      await expect(actions.answerDish(TEH_O_AIS, 'more', at)).rejects.toBeInstanceOf(DishCheckChangedError);
      expect(await db.personalItems.get('personal-teh-o-ais')).toMatchObject({ selectedVariant: 1, corrections: 3 });
    });
  });

  describe('answers that no longer fit', () => {
    it('refuses the same dish twice', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      await expect(actions.answerDish(RICE_KEY, 'more', at)).rejects.toBeInstanceOf(DishCheckChangedError);
    });

    it('refuses a dish that is not on the list', async () => {
      await expect(actions.answerDish('no-such-dish', 'right', at)).rejects.toBeInstanceOf(DishCheckChangedError);
      await actions.answerDish(RICE_KEY, 'right', at);
      await expect(actions.answerDish('no-such-dish', 'right', at)).rejects.toBeInstanceOf(DishCheckChangedError);
      // A dish that was logged only once is not on the list either.
      await expect(actions.answerDish('name:sambal ikan bilis', 'right', at)).rejects.toBeInstanceOf(DishCheckChangedError);
    });

    it('two taps on one row answer once', async () => {
      const results = await Promise.allSettled([actions.answerDish(MAMAK_RICE, 'less', at), actions.answerDish(MAMAK_RICE, 'less', at)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect((await db.personalItems.get('personal-nasi-kandar-rice'))?.corrections).toBe(3);
    });

    it('answers on different rows at once both stay', async () => {
      await Promise.all([actions.answerDish(RICE_KEY, 'right', at), actions.answerDish(TEH_O_AIS, 'more', at)]);
      const answered = (await row())?.dishCheck?.dishes.filter((d) => d.answer !== undefined).map((d) => d.key).sort();
      expect(answered).toEqual([RICE_KEY, TEH_O_AIS].sort());
    });
  });

  describe('Not now', () => {
    it('hides the card for 28 days, and the undo brings it back', async () => {
      const undo = await actions.dismissDishCheck(at);
      expect(await row()).toMatchObject({ ruleId: 'topDishes', feedback: 'dishCheck', pausedUntil: '2026-11-13' });
      expect((await row())?.dishCheck).toBeUndefined();
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ phase: 'ready', hidden: true });
      expect(await getDishCheckStatusIn(db, { today: '2026-11-12' })).toMatchObject({ hidden: true });
      expect(await getDishCheckStatusIn(db, { today: '2026-11-13' })).toMatchObject({ hidden: false });
      await undo();
      expect(await row()).toBeUndefined();
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ hidden: false });
    });

    it('starting the check brings the card back', async () => {
      await actions.dismissDishCheck(at);
      await actions.answerDish(RICE_KEY, 'right', at);
      expect((await row())?.pausedUntil).toBeUndefined();
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ phase: 'inProgress', hidden: false });
    });

    it('hides a started check too, keeping the answers, and the undo restores it', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      const undo = await actions.dismissDishCheck(at);
      expect(await row()).toMatchObject({ pausedUntil: '2026-11-13' });
      expect((await row())?.dishCheck?.dishes.find((d) => d.key === RICE_KEY)?.answer).toBe('right');
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ phase: 'inProgress', hidden: true, answered: 1 });
      await undo();
      expect((await row())?.pausedUntil).toBeUndefined();
      expect((await row())?.dishCheck?.dishes.find((d) => d.key === RICE_KEY)?.answer).toBe('right');
    });

    it('does not hide a finished check', async () => {
      await actions.answerDish(RICE_KEY, 'right', at);
      await actions.finishDishCheck(at);
      await actions.dismissDishCheck(at);
      expect(await getDishCheckStatusIn(db, at)).toMatchObject({ phase: 'done', hidden: false });
    });
  });
});

describe('sync and demo', () => {
  beforeEach(() => open({ capture: () => true }));

  async function queued(): Promise<string[]> {
    return (await db.syncOutbox.toArray()).map((e) => `${e.table}/${e.key}`).sort();
  }

  it('queues the check row, the correction and the Place for upload', async () => {
    await loadDemo(db);
    expect(await queued()).toEqual([]);
    await actions.answerDish(MAMAK_RICE, 'less', at);
    expect(await queued()).toEqual([`insightFeedback/topDishes`, `personalItems/personal-nasi-kandar-rice`, `places/${DEMO_IDS.places.nasiKandar}`].sort());
  });

  it('queues only the check row for a catalogue dish that is right', async () => {
    await loadDemo(db);
    await actions.answerDish(RICE_KEY, 'right', at);
    expect(await queued()).toEqual(['insightFeedback/topDishes']);
  });

  it('queues a deletion when the only answer is undone', async () => {
    await loadDemo(db);
    const { undo } = await actions.answerDish(RICE_KEY, 'right', at);
    await db.syncOutbox.clear();
    await undo();
    expect(await row()).toBeUndefined();
    expect(await queued()).toEqual(['insightFeedback/topDishes']);
  });

  it('queues nothing while the demo clock runs', async () => {
    await createActions(db).loadDemoData();
    await actions.answerDish(MAMAK_RICE, 'less', at);
    await actions.finishDishCheck(at);
    await actions.dismissDishCheck(at);
    expect(await queued()).toEqual([]);
    expect(await row()).toBeDefined();
  });
});
