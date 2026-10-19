// @vitest-environment node
import { createDb, TABLE_NAMES, type KiraMakanDb } from '@/db/db';
import { BACKUP_FORMAT, BackupImportError, exportAll, exportCsv, importAll, type BackupFile } from '@/db/export';
import { DEMO_EXPECTED, DEMO_IDS, loadDemo } from '@/db/seed/demo';

let source: KiraMakanDb;
let target: KiraMakanDb;

beforeEach(async () => {
  source = createDb(`export-src-${crypto.randomUUID()}`);
  target = createDb(`export-dst-${crypto.randomUUID()}`);
  await loadDemo(source);
});

afterEach(async () => {
  await source.delete();
  await target.delete();
});

async function dumpTables(db: KiraMakanDb, skip: string[] = []): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) {
    if (skip.includes(name)) continue;
    const rows = await db.table(name).toArray();
    out[name] = rows.sort((a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}

async function todayLunch(db: KiraMakanDb) {
  const meal = await db.meals.get(DEMO_IDS.meals.todayLunch);
  if (!meal) throw new Error('demo lunch missing');
  return meal;
}

const readCsv = async (blob: Blob): Promise<string[]> => (await blob.text()).replace(/^﻿/, '').trimEnd().split('\r\n');

describe('JSON backup', () => {
  it('round-trips every table into an empty database', async () => {
    const file = await exportAll(source, { exportedAt: DEMO_EXPECTED.now });
    const backup = JSON.parse(await file.text()) as BackupFile;
    expect(file.type).toBe('application/json');
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, version: 1, exportedAt: DEMO_EXPECTED.now, photos: 'omitted' });
    expect(Object.keys(backup.tables).sort()).toEqual([...TABLE_NAMES].sort());

    const summary = await importAll(target, file);
    expect(summary.counts.meals).toBe(await source.meals.count());
    expect(summary.counts.weights).toBe(14);
    expect(await dumpTables(target)).toEqual(await dumpTables(source));
  });

  it('includes photos as data URLs when asked, and restores the blobs', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    await source.photos.put({
      id: 'photo-1',
      blob: new Blob([bytes], { type: 'image/jpeg' }),
      thumb: new Blob(['thumb'], { type: 'image/webp' }),
      createdAt: '2026-10-16T06:16:00.000Z',
    });

    const file = await exportAll(source, { includePhotos: true });
    const backup = JSON.parse(await file.text()) as BackupFile;
    expect(backup.photos).toBe('included');
    expect(backup.tables.photos[0]?.blob.startsWith('data:image/jpeg;base64,')).toBe(true);

    await importAll(target, file);
    const restored = await target.photos.get('photo-1');
    expect(restored?.blob.type).toBe('image/jpeg');
    expect(new Uint8Array((await restored?.blob.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes);
    expect(await restored?.thumb.text()).toBe('thumb');
  });

  it('keeps the photos on this device when the backup left them out', async () => {
    const photo = { id: 'local', blob: new Blob(['a']), thumb: new Blob(['b']), createdAt: '2026-10-16T06:16:00.000Z' };
    await target.photos.put(photo);
    await target.meals.put({ ...(await todayLunch(source)), id: 'stale-meal' });

    const summary = await importAll(target, await exportAll(source));
    expect(summary.photos).toBe('omitted');
    expect(await target.photos.count()).toBe(1);
    expect(await target.meals.get('stale-meal')).toBeUndefined();
  });

  it('rejects files that are not backups and changes nothing', async () => {
    const before = await target.meals.count();
    const attempt = (body: string) => importAll(target, new Blob([body], { type: 'application/json' }));

    await expect(attempt('not json')).rejects.toMatchObject({ reason: 'notJson' });
    await expect(attempt(JSON.stringify({ hello: 1 }))).rejects.toMatchObject({ reason: 'notABackup' });
    await expect(attempt(JSON.stringify({ format: BACKUP_FORMAT, version: 99, tables: {} }))).rejects.toMatchObject({ reason: 'newerVersion' });
    await expect(attempt(JSON.stringify({ format: BACKUP_FORMAT, version: 1, tables: { meals: [{ name: 'no id' }] } }))).rejects.toBeInstanceOf(BackupImportError);
    expect(await target.meals.count()).toBe(before);
  });
});

describe('CSV export', () => {
  it('writes meals, items, weights and workouts', async () => {
    const files = await exportCsv(source);
    expect(files.map((f) => f.filename)).toEqual([
      'kira-makan-meals.csv',
      'kira-makan-meal-items.csv',
      'kira-makan-weights.csv',
      'kira-makan-workouts.csv',
    ]);
    const [meals, items, weights, workouts] = await Promise.all(files.map((f) => readCsv(f.blob)));

    expect(meals?.[0]).toBe('id,logical_day,eaten_at_utc,eaten_at_local,slot,name,place,method,finished,kcal,protein_g,carbs_g,fat_g,price_rm,is_guess,text');
    expect(meals).toHaveLength((await source.meals.count()) + 1);
    const breakfast = meals?.find((line) => line.startsWith(`${DEMO_IDS.meals.todayBreakfast},`));
    expect(breakfast).toBe(
      'meal-2026-10-16-breakfast,2026-10-16,2026-10-16T02:40:00.000Z,2026-10-16 10:40,breakfast,Roti canai + teh tarik,Nasi kandar near home,text,all,560,14,70,22,4.8,no,"roti canai, teh tarik"',
    );
    // A 12:30am supper keeps its logical day.
    expect(meals?.find((line) => line.startsWith('meal-2026-10-09-supper,'))).toContain(',2026-10-09,2026-10-09T16:30:00.000Z,2026-10-10 00:30,');

    expect(items?.[0]).toBe('meal_id,logical_day,item_id,name,catalogue_id,portion,quantity,kcal,protein_g,carbs_g,fat_g,uncertainty,source,edited,original_kcal');
    expect(items).toContain('meal-2026-10-16-lunch,2026-10-16,meal-2026-10-16-lunch-5,Kuah on rice,kuah-on-rice,Some,1,60,1,4,4.6,0.15,catalogue,no,');
    expect(items?.find((line) => line.startsWith('meal-2026-10-13-dinner,') && line.includes('Nasi kandar rice'))).toMatch(/,yes,430$/);

    expect(weights?.[0]).toBe('logical_day,measured_at_utc,measured_at_local,kg');
    expect(weights?.[1]).toBe('2026-10-03,2026-10-03T00:05:00.000Z,2026-10-03 08:05,78.6');
    expect(weights).toHaveLength(15);

    expect(workouts).toEqual(['logical_day,type,minutes,intensity,net_kcal', '2026-10-06,futsal,60,moderate,470']);
  });

  it('quotes awkward text and defuses spreadsheet formulas', async () => {
    await source.meals.put({ ...(await todayLunch(source)), id: 'tricky', name: '=SUM(A1) "big", plate', text: 'line one\nline two', finished: 'half' });
    const [meals] = await exportCsv(source);
    const text = (await meals?.blob.text()) ?? '';
    expect(text).toContain(`"'=SUM(A1) ""big"", plate"`);
    expect(text).toContain('"line one\nline two"');
    // Half finished: 670 × 0.5.
    expect(text).toMatch(/,half,335,/);
  });

  it('counts item rows as eaten, so a half-finished meal’s items add up to its row', async () => {
    await source.meals.put({ ...(await todayLunch(source)), id: 'half-plate', finished: 'half' });
    const [, items] = await exportCsv(source);
    const rows = ((await items?.blob.text()) ?? '').split(/\r?\n/).filter((line) => line.startsWith('half-plate,'));
    const kcal = rows.map((line) => Number(line.split(',')[7]));
    expect(kcal).toEqual([100, 125, 45, 35, 30]);
  });
});
