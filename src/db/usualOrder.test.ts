// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { listPlaceOrders } from '@/db/logging';
import { compareUsualOrder, listUsuals, listUsualsAtPlace, putUsual } from '@/db/repo';
import { DEMO_IDS } from '@/db/seed/demo';
import { listOrderedUsualsIn, moveUsualIn } from '@/db/usuals';
import { setDemoClock } from '@/domain/clock';
import type { Usual } from '@/domain/types';

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`usual-order-${crypto.randomUUID()}`);
  await createActions(db).loadDemoData();
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

const ids = async (list: Promise<Usual[]>) => (await list).map((u) => u.id);

describe('Usual order (S23 move up / down)', () => {
  it('lists Usuals in the manual order wherever they are offered, not only on S23', async () => {
    const { usuals } = DEMO_IDS;
    // Demo: most used first.
    expect(await ids(listUsuals(db))).toEqual([usuals.rotiCanai, usuals.breadKayaKopi, usuals.nasiLemak, usuals.tehOAisKurang]);

    // Move the least used to the top, as S23 does.
    for (let i = 0; i < 3; i++) expect(await moveUsualIn(db, usuals.tehOAisKurang, 'up')).toBe(true);
    const manual = [usuals.tehOAisKurang, usuals.rotiCanai, usuals.breadKayaKopi, usuals.nasiLemak];
    expect(await ids(listOrderedUsualsIn(db))).toEqual(manual);
    // useUsuals (Log sheet "Your usuals", UsualsSheet) reads listUsuals: same order.
    expect(await ids(listUsuals(db))).toEqual(manual);
    expect((await listUsuals(db)).slice(0, 3).map((u) => u.id)).toEqual(manual.slice(0, 3));
  });

  it('keeps the manual order in a Place\'s orders', async () => {
    const placeId = 'order-test-place';
    const base = { items: [], createdAt: '2026-10-01T00:00:00.000Z', placeId };
    await putUsual(db, { ...base, id: 'a', name: 'Nasi kandar ayam', useCount: 9 });
    await putUsual(db, { ...base, id: 'b', name: 'Teh tarik', useCount: 2 });
    expect(await ids(listUsualsAtPlace(db, placeId))).toEqual(['a', 'b']);

    // Move "Teh tarik" all the way to the top of S23.
    while (await moveUsualIn(db, 'b', 'up'));
    const all = await ids(listOrderedUsualsIn(db));
    expect(all[0]).toBe('b');
    expect(all.indexOf('b')).toBeLessThan(all.indexOf('a'));
    expect(await ids(listUsualsAtPlace(db, placeId))).toEqual(['b', 'a']);
    expect((await listPlaceOrders(db, placeId)).map((o) => o.name)).toEqual(['Teh tarik', 'Nasi kandar ayam']);
  });

  it('puts ordered Usuals before unordered ones, then most used, then by name', () => {
    const u = (id: string, useCount: number, sortIndex?: number): Usual => ({
      id,
      name: id,
      items: [],
      useCount,
      createdAt: '2026-10-01T00:00:00.000Z',
      ...(sortIndex !== undefined ? { sortIndex } : {}),
    });
    const sorted = [u('x', 9), u('y', 1, 1), u('z', 1, 0), u('w', 9), u('v', 3)].sort(compareUsualOrder);
    expect(sorted.map((s) => s.id)).toEqual(['z', 'y', 'w', 'x', 'v']);
  });
});
