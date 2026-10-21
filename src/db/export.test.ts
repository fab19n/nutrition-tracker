// @vitest-environment node
import { createDb, SYNC_TABLES, TABLE_NAMES, type KiraMakanDb } from '@/db/db';
import {
  assertRestorable,
  BACKUP_FORMAT,
  BackupImportError,
  compareWithDevice,
  exportAll,
  exportCsv,
  importAll,
  MAX_BACKUP_BYTES,
  previewOf,
  readBackup,
  restoreBackup,
  type BackupFile,
  type BackupImportReason,
  type ParsedBackup,
} from '@/db/export';
import { DEMO_EXPECTED, DEMO_IDS, loadDemo } from '@/db/seed/demo';
import { backupFileOf, jsonFile, type EditableBackup } from '@/test/backupFiles';

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

  it('replaces rows by key: rows the file lacks go, rows it has are overwritten', async () => {
    await target.days.put({ logicalDay: '2020-01-06', status: 'complete' });
    await target.weekPlans.put({ weekStart: '2020-01-06' });
    await target.insightFeedback.put({ ruleId: 'old-rule', feedback: 'useful', at: '2026-10-11T14:00:00.000Z' });
    await target.meals.put({ ...(await todayLunch(source)), name: 'Changed here' });

    await importAll(target, await exportAll(source));
    expect(await dumpTables(target)).toEqual(await dumpTables(source));
  });

  it('never writes the sync tables into a backup, and an import leaves them alone', async () => {
    await source.syncOutbox.put({ table: 'meals', key: DEMO_IDS.meals.todayLunch, changedAt: 1, nonce: 'n1' });
    await source.syncRevs.put({ table: 'meals', key: DEMO_IDS.meals.todayLunch, rev: 7, hash: 'abc' });
    await source.syncMeta.put({ id: 'sync', lastSyncedAt: 1 });
    const file = await exportAll(source, { includePhotos: true });
    const backup = JSON.parse(await file.text()) as BackupFile;
    expect(Object.keys(backup.tables).sort()).toEqual([...TABLE_NAMES].sort());

    await target.syncMeta.put({ id: 'sync', lastSyncedAt: 2 });
    const summary = await importAll(target, file);
    expect(Object.keys(summary.counts).sort()).toEqual([...TABLE_NAMES].sort());
    expect(await target.syncMeta.toArray()).toEqual([{ id: 'sync', lastSyncedAt: 2 }]);
    expect(await target.syncRevs.count()).toBe(0);
    expect(await target.syncOutbox.count()).toBe(0);
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

// ---------------------------------------------------------------------------
// Reading a file (readBackup) and restoring it (restoreBackup)
// ---------------------------------------------------------------------------

const DEVICE = { deviceDefaults: { theme: 'system' as const } };

/** What readBackup says about a file, or the reason it was refused. */
async function readReason(file: Blob): Promise<BackupImportReason | 'ok'> {
  try {
    await readBackup(file);
    return 'ok';
  } catch (error) {
    if (error instanceof BackupImportError) return error.reason;
    throw error;
  }
}

/** A real exported file from `source`, edited. */
function editedFile(mutate: (backup: EditableBackup) => void, options: { photos?: boolean } = {}): Promise<File> {
  return backupFileOf(source, { real: true, ...options, mutate });
}

/** The checked file, for restoreBackup. */
async function parsed(mutate?: (backup: EditableBackup) => void, db: KiraMakanDb = source): Promise<ParsedBackup> {
  return readBackup(await backupFileOf(db, { real: true, ...(mutate ? { mutate } : {}) }));
}

function tamper(blob: Blob, patch: { size?: number; text?: () => Promise<string> }): Blob {
  if (patch.size !== undefined) Object.defineProperty(blob, 'size', { value: patch.size });
  if (patch.text) Object.defineProperty(blob, 'text', { value: patch.text });
  return blob;
}

/** A PersonalItem that is not in the demo's. */
const PERSONAL_ITEM = {
  id: 'pi-here',
  name: 'Nasi lemak at home',
  scope: 'dish' as const,
  unitMacros: { kcal: 520, proteinG: 12, carbsG: 70, fatG: 20 },
  uncertainty: 0.1,
  corrections: 1,
  createdAt: '2026-10-01T04:00:00.000Z',
  updatedAt: '2026-10-01T04:00:00.000Z',
};

describe('readBackup', () => {
  it('refuses a file over the size limit before reading it', async () => {
    const text = vi.fn(async () => '{}');
    const big = tamper(new Blob(['{}']), { size: MAX_BACKUP_BYTES + 1, text });
    await expect(readBackup(big)).rejects.toMatchObject({ reason: 'tooBig' });
    expect(text).not.toHaveBeenCalled();
    // The limit itself is fine.
    expect(await readReason(tamper(new Blob(['{}']), { size: MAX_BACKUP_BYTES }))).toBe('notABackup');
  });

  it('says unreadable when the file can not be read, not that it is not JSON', async () => {
    const cloudOnly = tamper(new Blob(['{}']), { text: () => Promise.reject(new DOMException('gone', 'NotReadableError')) });
    await expect(readBackup(cloudOnly)).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it.each<[string, string, BackupImportReason]>([
    ['not JSON', 'not json', 'notJson'],
    ['an empty file', '', 'notJson'],
    ['a JSON list', '[1,2]', 'notABackup'],
    ['another JSON file', JSON.stringify({ hello: 1 }), 'notABackup'],
    ['the wrong format', JSON.stringify({ format: 'other-app', version: 1, tables: {} }), 'notABackup'],
    ['no tables', JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), 'notABackup'],
    ['tables that are a list', JSON.stringify({ format: BACKUP_FORMAT, version: 1, tables: [] }), 'notABackup'],
    ['a version that is not a number', JSON.stringify({ format: BACKUP_FORMAT, version: '1', tables: {} }), 'notABackup'],
    ['no version', JSON.stringify({ format: BACKUP_FORMAT, tables: {} }), 'notABackup'],
    ['version 0', JSON.stringify({ format: BACKUP_FORMAT, version: 0, tables: {} }), 'notABackup'],
    ['a version with a fraction', JSON.stringify({ format: BACKUP_FORMAT, version: 1.5, tables: {} }), 'notABackup'],
    ['a newer version', JSON.stringify({ format: BACKUP_FORMAT, version: 2, tables: {} }), 'newerVersion'],
  ])('refuses %s', async (_name, body, reason) => {
    await target.meals.put({ ...(await todayLunch(source)), id: 'keep-me' });
    const before = await dumpTables(target);
    expect(await readReason(jsonFile(body))).toBe(reason);
    await expect(importAll(target, jsonFile(body))).rejects.toMatchObject({ reason });
    expect(await dumpTables(target)).toEqual(before);
  });

  it('accepts a real export and a file with no tables at all', async () => {
    const backup = await readBackup(await backupFileOf(source, { real: true }));
    expect(backup.exportedAt).toBe(DEMO_EXPECTED.now);
    expect(backup.photosIncluded).toBe(false);
    expect(backup.photos).toEqual([]);
    expect([...backup.rows.keys()].sort()).toEqual(TABLE_NAMES.filter((t) => t !== 'photos').sort());
    expect(backup.rows.get('meals')).toHaveLength(await source.meals.count());

    const empty = await readBackup(jsonFile(JSON.stringify({ format: BACKUP_FORMAT, version: 1, tables: {} })));
    expect(empty).toEqual({ exportedAt: '', photosIncluded: false, rows: new Map(), photos: [] });
  });

  describe('damaged rows', () => {
    const cases: { name: string; mutate: (backup: EditableBackup) => void; message: string }[] = [
      {
        name: 'a meal without items',
        mutate: (b) => void delete b.tables.meals?.[2]?.items,
        message: 'meals row 3 has a bad items',
      },
      {
        name: 'a meal whose items are not a list',
        mutate: (b) => void (b.tables.meals?.[0] && (b.tables.meals[0].items = 'two eggs')),
        message: 'meals row 1 has a bad items',
      },
      {
        name: 'a meal without an id',
        mutate: (b) => void delete b.tables.meals?.[1]?.id,
        message: 'meals row 2 has no id',
      },
      {
        name: 'a weigh-in with kg as text',
        mutate: (b) => void (b.tables.weights?.[4] && (b.tables.weights[4].kg = '78.6')),
        message: 'weights row 5 has a bad kg',
      },
      {
        name: 'a goal without timing',
        mutate: (b) => void delete b.tables.goals?.[0]?.timing,
        message: 'goals row 1 has a bad timing',
      },
      {
        name: 'a profile with another id',
        mutate: (b) => void (b.tables.profile?.[0] && (b.tables.profile[0].id = 'x')),
        message: 'profile row 1 has a bad id',
      },
      {
        name: 'a profile with a time zone that does not exist',
        mutate: (b) => void (b.tables.profile?.[0] && (b.tables.profile[0].timeZone = 'Mars/Olympus')),
        message: 'profile row 1 has a bad timeZone',
      },
      {
        name: 'a profile with an empty time zone',
        mutate: (b) => void (b.tables.profile?.[0] && (b.tables.profile[0].timeZone = '')),
        message: 'profile row 1 has a bad timeZone',
      },
      {
        name: 'a rollover hour of 30',
        mutate: (b) => void (b.tables.profile?.[0] && (b.tables.profile[0].rolloverHour = 30)),
        message: 'profile row 1 has a bad rolloverHour',
      },
      {
        name: 'a rollover hour with a fraction',
        mutate: (b) => void (b.tables.profile?.[0] && (b.tables.profile[0].rolloverHour = 4.5)),
        message: 'profile row 1 has a bad rolloverHour',
      },
      {
        name: 'a table that is not a list',
        mutate: (b) => void ((b.tables as Record<string, unknown>).meals = { 0: 'nope' }),
        message: '"meals" is not a list',
      },
      {
        name: 'a table that is null',
        mutate: (b) => void ((b.tables as Record<string, unknown>).places = null),
        message: '"places" is not a list',
      },
      {
        name: 'a row that is not an object',
        mutate: (b) => void (b.tables.usuals as unknown[]).push('oops'),
        message: `usuals row ${DEMO_EXPECTED.counts.usuals + 1} has no id`,
      },
    ];

    it.each(cases)('refuses $name and writes nothing', async ({ mutate, message }) => {
      await target.meals.put({ ...(await todayLunch(source)), id: 'keep-me' });
      const before = await dumpTables(target);
      const file = await editedFile(mutate);

      await expect(readBackup(file)).rejects.toMatchObject({ reason: 'badRow', message });
      await expect(importAll(target, file)).rejects.toMatchObject({ reason: 'badRow', message });
      expect(await dumpTables(target)).toEqual(before);
    });

    it('refuses a photo that is not a data URL, and names the field', async () => {
      await source.photos.put({ id: 'p1', blob: new Blob(['a'], { type: 'image/jpeg' }), thumb: new Blob(['b']), createdAt: DEMO_EXPECTED.now });
      const refuse = async (mutate: (photo: Record<string, unknown>) => void, message: string) => {
        const file = await editedFile((b) => void (b.tables.photos?.[0] && mutate(b.tables.photos[0])), { photos: true });
        await expect(readBackup(file)).rejects.toMatchObject({ reason: 'badRow', message });
      };

      await refuse((photo) => void (photo.blob = 'https://example.com/not-embedded.jpg'), 'photos row 1 has a bad blob');
      await refuse((photo) => void (photo.thumb = 'data:image/webp;base64,@@@'), 'photos row 1 has a bad thumb');
      await refuse((photo) => void delete photo.createdAt, 'photos row 1 has a bad createdAt');
      await refuse((photo) => void delete photo.id, 'photos row 1 has no id');
    });

    it('refuses photos that are not a list when the file says it has them', async () => {
      const file = await editedFile(
        (b) => void ((b.tables as Record<string, unknown>).photos = 'none'),
        { photos: true },
      );
      await expect(readBackup(file)).rejects.toMatchObject({ reason: 'badRow', message: '"photos" is not a list' });
    });
  });

  it('ignores photos the file lists but says it left out', async () => {
    const file = await editedFile((b) => {
      b.photos = 'omitted';
      b.tables.photos = [{ id: 'p1', createdAt: 'x', blob: 'not a data url', thumb: 'nope' }];
    });
    const backup = await readBackup(file);
    expect(backup.photosIncluded).toBe(false);
    expect(backup.photos).toEqual([]);
  });

  it('takes the export date only when it is text', async () => {
    expect((await readBackup(await editedFile((b) => void (b.exportedAt = 42 as unknown as string)))).exportedAt).toBe('');
  });
});

describe('a file that leaves a table out', () => {
  it('leaves that table alone on importAll and restoreBackup, and a listed empty table empties it', async () => {
    await target.personalItems.put(PERSONAL_ITEM);

    const without = (b: EditableBackup) => void delete b.tables.personalItems;
    await importAll(target, await editedFile(without));
    expect(await target.personalItems.toArray()).toEqual([PERSONAL_ITEM]);

    await restoreBackup(target, await parsed(without), DEVICE);
    expect(await target.personalItems.toArray()).toEqual([PERSONAL_ITEM]);

    const empty = (b: EditableBackup) => void (b.tables.personalItems = []);
    await restoreBackup(target, await parsed(empty), DEVICE);
    expect(await target.personalItems.count()).toBe(0);
  });
});

/** The reason a call is refused with; undefined when it isn't. */
function reasonOf(call: () => void): BackupImportReason | undefined {
  try {
    call();
  } catch (error) {
    if (error instanceof BackupImportError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('assertRestorable', () => {
  it('passes a real exported backup', async () => {
    const backup = await parsed();
    expect(() => assertRestorable(backup)).not.toThrow();
  });

  it.each<[string, (backup: EditableBackup) => void]>([
    ['no profile', (b) => void (b.tables.profile = [])],
    ['no profile table', (b) => void delete b.tables.profile],
    ['two profiles', (b) => void (b.tables.profile?.[0] && b.tables.profile.push({ ...b.tables.profile[0] }))],
    ['no goal', (b) => void (b.tables.goals = [])],
    ['no goal version', (b) => void (b.tables.goalVersions = [])],
    ['no goal period', (b) => void (b.tables.goalPeriods = [])],
    ['no goal period table', (b) => void delete b.tables.goalPeriods],
  ])('refuses %s as incomplete', async (_name, mutate) => {
    const backup = await parsed(mutate);
    expect(reasonOf(() => assertRestorable(backup))).toBe('incomplete');
  });

  it('refuses the sample week', async () => {
    const sample = await readBackup(await backupFileOf(source));
    expect(reasonOf(() => assertRestorable(sample))).toBe('sampleData');
  });
});

describe('previewOf', () => {
  it('counts every kind, with the span of the meals', async () => {
    const preview = previewOf(await parsed());
    expect(preview.counts.meals).toBe(await source.meals.count());
    expect(preview.counts.weights).toBe(DEMO_EXPECTED.counts.weights);
    expect(preview.counts.workouts).toBe(DEMO_EXPECTED.counts.workouts);
    expect(preview.counts.places).toBe(DEMO_EXPECTED.counts.places);
    expect(preview.counts.usuals).toBe(DEMO_EXPECTED.counts.usuals);
    expect(preview.counts.pots).toBe(DEMO_EXPECTED.counts.pots);
    expect(preview.counts.goals).toBe(DEMO_EXPECTED.counts.goals);
    expect(preview.counts.profile).toBe(1);
    expect(preview.counts.photos).toBe(0);
    expect(Object.keys(preview.counts).sort()).toEqual([...TABLE_NAMES].sort());

    const days = (await source.meals.toArray()).map((meal) => meal.logicalDay).sort();
    expect(preview.mealDays).toEqual({ from: days[0], to: days.at(-1) });
    expect(preview.mealDays?.to).toBe(DEMO_EXPECTED.today.day);
    expect(preview.exportedAt).toBe(DEMO_EXPECTED.now);
    expect(preview.photos).toBe('omitted');
    expect(preview.timeZone).toBe('Asia/Kuala_Lumpur');
  });

  it('counts the photos a file includes', async () => {
    for (const id of ['p1', 'p2']) {
      await source.photos.put({ id, blob: new Blob([id], { type: 'image/jpeg' }), thumb: new Blob([id]), createdAt: DEMO_EXPECTED.now });
    }
    const preview = previewOf(await readBackup(await backupFileOf(source, { real: true, photos: true })));
    expect(preview.photos).toBe('included');
    expect(preview.counts.photos).toBe(2);
  });

  it('counts a table the file leaves out as 0, and has no span without meals', async () => {
    const preview = previewOf(await parsed((b) => void ((b.tables.meals = []), delete b.tables.places)));
    expect(preview.counts.meals).toBe(0);
    expect(preview.counts.places).toBe(0);
    expect(preview.mealDays).toBeUndefined();
  });

  it('has no export date when the file has none or it is not a date', async () => {
    expect(previewOf(await parsed((b) => void (b.exportedAt = ''))).exportedAt).toBeNull();
    expect(previewOf(await parsed((b) => void (b.exportedAt = 'sometime last week'))).exportedAt).toBeNull();
    expect(previewOf(await parsed((b) => void delete (b as { exportedAt?: string }).exportedAt)).exportedAt).toBeNull();
  });

  it('skips meal days that are not dates, and falls back to the default time zone without a profile', () => {
    const backup: ParsedBackup = {
      exportedAt: '',
      photosIncluded: false,
      rows: new Map([
        ['meals', [{ id: 'a', logicalDay: '2026-10-02' }, { id: 'b', logicalDay: 'banana' }, { id: 'c', logicalDay: '2026-09-28' }]],
        ['profile', [{ id: 'me', timeZone: 'Europe/London' }]],
      ]),
      photos: [],
    };
    expect(previewOf(backup).mealDays).toEqual({ from: '2026-09-28', to: '2026-10-02' });
    expect(previewOf(backup).timeZone).toBe('Europe/London');
    backup.rows.delete('profile');
    expect(previewOf(backup).timeZone).toBe('Asia/Kuala_Lumpur');
    backup.rows.set('profile', [{ id: 'me', timeZone: 'Mars/Olympus' }]);
    expect(previewOf(backup).timeZone).toBe('Asia/Kuala_Lumpur');
  });
});

describe('compareWithDevice', () => {
  it('counts the meals and weigh-ins here that the file lacks, by id', async () => {
    const backup = await parsed();
    await restoreBackup(target, backup, DEVICE);
    expect(await compareWithDevice(target, backup)).toEqual({
      meals: await source.meals.count(),
      weights: DEMO_EXPECTED.counts.weights,
      onlyHere: { meals: 0, weights: 0 },
    });

    const lunch = await todayLunch(source);
    await target.meals.bulkPut([
      { ...lunch, id: 'extra-1' },
      { ...lunch, id: 'extra-2' },
    ]);
    await target.weights.put({ id: 'extra-w', measuredAt: DEMO_EXPECTED.now, logicalDay: '2026-10-16', kg: 77.1 });
    expect(await compareWithDevice(target, backup)).toEqual({
      meals: (await source.meals.count()) + 2,
      weights: DEMO_EXPECTED.counts.weights + 1,
      onlyHere: { meals: 2, weights: 1 },
    });
  });

  it('counts everything here as lost against an empty diary, and nothing for a table the file leaves out', async () => {
    await restoreBackup(target, await parsed(), DEVICE);
    const emptied = await parsed((b) => void ((b.tables.meals = []), (b.tables.weights = [])));
    expect(await compareWithDevice(target, emptied)).toMatchObject({ onlyHere: { meals: await target.meals.count(), weights: DEMO_EXPECTED.counts.weights } });

    const partial = await parsed((b) => void (delete b.tables.meals, delete b.tables.weights));
    expect(await compareWithDevice(target, partial)).toMatchObject({ onlyHere: { meals: 0, weights: 0 } });
  });

  it('is zero on an empty device', async () => {
    expect(await compareWithDevice(target, await parsed())).toEqual({ meals: 0, weights: 0, onlyHere: { meals: 0, weights: 0 } });
  });
});

describe('restoreBackup', () => {
  /** The profile without the fields that belong to a device. */
  const withoutDeviceFields = (profile: unknown) => {
    const { theme: _theme, useLocation: _useLocation, demoMode: _demoMode, ...rest } = profile as Record<string, unknown>;
    return rest;
  };

  it('round-trips into an empty database, but for the profile fields that belong to a device', async () => {
    const summary = await restoreBackup(target, await parsed(), { deviceDefaults: { theme: 'dark' } });

    expect(summary.counts.meals).toBe(await source.meals.count());
    expect(summary).toMatchObject({ exportedAt: DEMO_EXPECTED.now, photos: 'omitted' });
    expect(await dumpTables(target, ['profile'])).toEqual(await dumpTables(source, ['profile']));
    const restored = await target.profile.get('me');
    expect(withoutDeviceFields(restored)).toEqual(withoutDeviceFields(await source.profile.get('me')));
    // An empty device takes its default theme and asks for location again.
    expect(restored).toMatchObject({ theme: 'dark', useLocation: false, demoMode: false });
  });

  it('keeps the theme and location permission of the device it lands on', async () => {
    await restoreBackup(target, await parsed(), DEVICE);
    await target.profile.update('me', { theme: 'dark', useLocation: true });
    // The file says system and false.
    const file = await parsed((b) => {
      const profile = b.tables.profile?.[0];
      if (profile) Object.assign(profile, { theme: 'light', useLocation: false });
    });
    await restoreBackup(target, file, { deviceDefaults: { theme: 'light' } });
    expect(await target.profile.get('me')).toMatchObject({ theme: 'dark', useLocation: true, demoMode: false });

    await target.profile.update('me', { useLocation: false });
    await restoreBackup(target, await parsed(), DEVICE);
    expect((await target.profile.get('me'))?.useLocation).toBe(false);
  });

  it('never turns demo mode on, whatever the file says about it', async () => {
    const noFlag = await parsed((b) => void delete b.tables.profile?.[0]?.demoMode);
    await restoreBackup(target, noFlag, DEVICE);
    expect((await target.profile.get('me'))?.demoMode).toBe(false);

    // A device that is in demo mode leaves it.
    await loadDemo(target);
    expect((await target.profile.get('me'))?.demoMode).toBe(true);
    await restoreBackup(target, await parsed(), DEVICE);
    expect((await target.profile.get('me'))?.demoMode).toBe(false);
  });

  it('keeps the sample week out of the location setting and theme of the restored diary', async () => {
    // loadDemo sets useLocation: true; a restored real diary must ask for it again (the primer).
    await loadDemo(target);
    await target.profile.update('me', { theme: 'dark' });
    expect(await target.profile.get('me')).toMatchObject({ demoMode: true, useLocation: true });
    await restoreBackup(target, await parsed(), { deviceDefaults: { theme: 'light' } });
    expect(await target.profile.get('me')).toMatchObject({ demoMode: false, useLocation: false, theme: 'light' });
  });

  it('deletes the rows the file lacks and overwrites the ones that changed', async () => {
    await restoreBackup(target, await parsed(), DEVICE);
    await target.days.put({ logicalDay: '2020-01-06', status: 'complete' });
    await target.weekPlans.put({ weekStart: '2020-01-06' });
    await target.insightFeedback.put({ ruleId: 'old-rule', feedback: 'useful', at: DEMO_EXPECTED.now });
    await target.meals.put({ ...(await todayLunch(source)), id: 'stale-meal' });
    await target.meals.put({ ...(await todayLunch(source)), name: 'Changed here' });

    await restoreBackup(target, await parsed(), DEVICE);

    expect(await dumpTables(target, ['profile'])).toEqual(await dumpTables(source, ['profile']));
    expect(await target.meals.get('stale-meal')).toBeUndefined();
    expect((await target.meals.get(DEMO_IDS.meals.todayLunch))?.name).toBe((await todayLunch(source)).name);
  });

  it('refuses a file with no diary or the sample week, and writes nothing', async () => {
    await target.meals.put({ ...(await todayLunch(source)), id: 'keep-me' });
    const before = await dumpTables(target);

    const sample = await readBackup(await backupFileOf(source));
    await expect(restoreBackup(target, sample, DEVICE)).rejects.toMatchObject({ reason: 'sampleData' });
    const noProfile = await parsed((b) => void (b.tables.profile = []));
    await expect(restoreBackup(target, noProfile, DEVICE)).rejects.toMatchObject({ reason: 'incomplete' });
    expect(await dumpTables(target)).toEqual(before);
  });

  describe('on a database that records changes for sync', () => {
    let captured: KiraMakanDb;

    beforeEach(() => {
      captured = createDb(`export-captured-${crypto.randomUUID()}`, { capture: () => true });
    });

    afterEach(async () => {
      await captured.delete();
    });

    it('queues a marker for every row it writes and every row it deletes, and none for photos or sync tables', async () => {
      await captured.meals.put({ ...(await todayLunch(source)), id: 'stale-meal' });
      await captured.days.put({ logicalDay: '2020-01-06', status: 'complete' });
      await captured.photos.put({ id: 'old-photo', blob: new Blob(['x']), thumb: new Blob(['y']), createdAt: DEMO_EXPECTED.now });
      await captured.syncOutbox.clear();

      const backup = await parsed();
      await restoreBackup(captured, backup, DEVICE);

      const marked = (await captured.syncOutbox.toArray()).map((entry) => `${entry.table}:${entry.key}`).sort();
      const written = [...backup.rows].flatMap(([table, rows]) =>
        rows.map((row) => `${table}:${String(row[table === 'days' ? 'logicalDay' : table === 'weekPlans' ? 'weekStart' : table === 'insightFeedback' ? 'ruleId' : 'id'])}`),
      );
      expect(marked).toEqual([...written, 'meals:stale-meal', 'days:2020-01-06'].sort());
      expect(marked).toContain('meals:stale-meal');
      expect(marked.every((entry) => (SYNC_TABLES as string[]).includes(entry.split(':')[0] ?? ''))).toBe(true);
      expect(await captured.syncRevs.count()).toBe(0);
      expect(await captured.syncMeta.count()).toBe(0);
    });

    it('is not captured when the changes are meant to stay on the device', async () => {
      const quiet = createDb(`export-quiet-${crypto.randomUUID()}`);
      try {
        await restoreBackup(quiet, await parsed(), DEVICE);
        expect(await quiet.syncOutbox.count()).toBe(0);
      } finally {
        await quiet.delete();
      }
    });
  });

  describe('photos', () => {
    const photo = (id: string) => ({ id, blob: new Blob([id], { type: 'image/jpeg' }), thumb: new Blob([id]), createdAt: DEMO_EXPECTED.now });

    it('keeps the photos a meal points to when the file left photos out, and deletes the rest', async () => {
      await target.photos.bulkPut([photo('kept'), photo('orphan')]);
      const file = await parsed((b) => {
        const meal = b.tables.meals?.[0];
        if (meal) meal.photoId = 'kept';
      });

      const summary = await restoreBackup(target, file, DEVICE);

      expect(summary.photos).toBe('omitted');
      expect((await target.photos.toArray()).map((p) => p.id)).toEqual(['kept']);
    });

    it('deletes a photo whose meal the restore removed', async () => {
      await restoreBackup(target, await parsed(), DEVICE);
      await target.meals.put({ ...(await todayLunch(source)), id: 'photo-meal', photoId: 'gone-with-it' });
      await target.photos.put(photo('gone-with-it'));

      await restoreBackup(target, await parsed(), DEVICE);

      expect(await target.photos.count()).toBe(0);
    });

    it('replaces all the photos here with the ones the file includes', async () => {
      await source.photos.bulkPut([photo('p1'), photo('p2')]);
      await target.photos.bulkPut([photo('old')]);
      const file = await readBackup(await backupFileOf(source, { real: true, photos: true }));

      const summary = await restoreBackup(target, file, DEVICE);

      expect(summary).toMatchObject({ photos: 'included' });
      expect(summary.counts.photos).toBe(2);
      expect((await target.photos.toArray()).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
      expect(await (await target.photos.get('p1'))?.blob.text()).toBe('p1');
    });
  });

  it('rolls everything back when the write fails part way, the profile included', async () => {
    await restoreBackup(target, await parsed(), DEVICE);
    await target.profile.update('me', { theme: 'dark', age: 41 });
    await target.meals.put({ ...(await todayLunch(source)), id: 'stale-meal' });
    const before = await dumpTables(target);

    // A function can't be stored: the put of this meal throws a DataCloneError after the profile went in.
    const broken = await parsed();
    const meal = broken.rows.get('meals')?.[3];
    if (meal) meal.oops = () => 'not storable';

    await expect(restoreBackup(target, broken, DEVICE)).rejects.toThrow();

    expect(await dumpTables(target)).toEqual(before);
    expect(await target.meals.get('stale-meal')).toBeDefined();
    expect((await target.profile.get('me'))?.age).toBe(41);
  });
});

describe('importAll keeps its raw behaviour', () => {
  it('takes the profile as the file has it, device fields and demo flag included', async () => {
    await importAll(target, await backupFileOf(source));
    expect(await target.profile.get('me')).toEqual(await source.profile.get('me'));
    expect((await target.profile.get('me'))?.demoMode).toBe(true);
  });

  it('replaces the photos wholesale and does not prune the ones it keeps', async () => {
    await target.photos.put({ id: 'unreferenced', blob: new Blob(['a']), thumb: new Blob(['b']), createdAt: DEMO_EXPECTED.now });
    await importAll(target, await backupFileOf(source));
    expect(await target.photos.count()).toBe(1);
  });

  it('does not check the file for a diary', async () => {
    const summary = await importAll(target, await backupFileOf(source, { mutate: (b) => void (b.tables.profile = []) }));
    expect(summary.counts.profile).toBe(0);
  });
});
