import { screen, within } from '@testing-library/react';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { mealMacros } from '@/domain/meal';
import { findDialog, findHero, findWeekBars, nav, setupFlows, SLOW, startApp } from './harness';

setupFlows();

const dish = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}, about`) }, SLOW);

describe('F03 · economy rice at the stall', () => {
  it('builds a plate from the Log sheet, reviews and saves it', async () => {
    const { user, router } = startApp('/');
    expect(await findHero(/^570 kcal left today\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log food' }));
    const sheet = await findDialog('Log food');
    await user.click(await within(sheet).findByRole('button', { name: 'Plate' }, SLOW));

    // S24 with the economy-rice stall picked for you and your last plate there.
    expect(await screen.findByRole('heading', { name: 'Build your plate' }, SLOW)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/log/plate');
    expect(nav()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Log food' })).toBeNull();
    expect(await screen.findByRole('button', { name: /^Place:\s*Kedai near home/ }, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('670 kcal', {}, SLOW)).toBeInTheDocument();

    // Tap a dish twice: two pieces of ayam goreng.
    await user.click(await dish('Ayam goreng'));
    await user.click(await dish('Ayam goreng'));
    expect(await dish('Ayam goreng')).toHaveAccessibleName(/2 on your plate/);
    expect(screen.getByText('1,230 kcal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('heading', { name: 'Check your plate' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('1,230 kcal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for Ayam goreng' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Price/ })).toHaveValue('9.50');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved · ~1,230 kcal', {}, SLOW)).toBeInTheDocument();

    // Today: 1,230 + 1,230 eaten, 660 over (the +650 saved doesn't quite cover it).
    expect(await findHero(/^660 kcal over today\. The rest of the week adjusts to cover it\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(await findWeekBars(/today 2,460 of 1,800/)).toBeInTheDocument();

    const plates = (await db.meals.where('logicalDay').equals('2026-10-16').toArray()).filter(
      (m) => m.method === 'plate' && m.id !== DEMO_IDS.meals.todayLunch,
    );
    expect(plates).toHaveLength(1);
    const plate = plates[0];
    expect(plate?.name).toBe('Economy rice');
    expect(plate?.placeId).toBe(DEMO_IDS.places.kedai);
    expect(plate?.priceRm).toBe(9.5);
    expect(plate?.items.find((i) => i.name === 'Ayam goreng')?.quantity).toBe(2);
    expect(plate && Math.round(mealMacros(plate).kcal)).toBe(1230);
    expect(screen.getAllByText('Economy rice')).toHaveLength(2);
  });
});
