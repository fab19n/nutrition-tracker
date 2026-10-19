import { screen, waitFor, within } from '@testing-library/react';
import { deleteMeal } from '@/db/actions';
import { db } from '@/db/db';
import { putDayRecord } from '@/db/repo';
import { fmtSigned } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

const YESTERDAY = '2026-10-15';
/** Mon–Wed of the demo week, all complete: 180 + 90 + 260 under the 1,800 target. */
const SAVED_MON_TO_WED = 530;
const TARGET = 1800;

setupFlows();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function eatenOn(day: string): Promise<number> {
  const meals = await db.meals.where('logicalDay').equals(day).toArray();
  return meals.reduce((sum, m) => sum + mealMacros(m).kcal, 0);
}

describe('F07 · morning check-in', () => {
  beforeEach(async () => {
    // The design's scenario B: yesterday without its dinner, not confirmed yet.
    await deleteMeal(`meal-${YESTERDAY}-dinner`);
    await putDayRecord(db, { logicalDay: YESTERDAY, status: 'unconfirmed' });
  });

  it('fills in a typical dinner from the banner and the week counts the guess', async () => {
    const { user, router } = startApp('/');
    const before = Math.round(await eatenOn(YESTERDAY));

    // Yesterday's savings wait for the check-in; the banner and the Today tab say so.
    const hero = await findHero(/^570 kcal left today\./);
    expect(hero).toHaveAccessibleName(new RegExp(`Saved this week ${escape(fmtSigned(SAVED_MON_TO_WED))}\\.`));
    expect(within(hero).getByText(`${fmtSigned(TARGET - before)} waiting for check-in`)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Today, Check-in waiting' }, SLOW)).toBeInTheDocument();
    const banner = await screen.findByRole('button', { name: /^Yesterday looks incomplete\./ }, SLOW);

    await user.click(banner);
    const sheet = await findDialog('Morning check-in');
    expect(router.state.location.search).toBe('?sheet=checkin');
    expect(await within(sheet).findByRole('heading', { name: /^Yesterday · 2 meals · [\d,]+ kcal$/ }, SLOW)).toBeInTheDocument();

    await user.click(within(sheet).getByRole('radio', { name: /Fill in a typical one/ }));
    expect(within(sheet).getByText(/^Adds ~[\d,]+ kcal to this week's budget, marked as a guess\./)).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));

    // The sheet closes, the banner goes, and the guess is in this week's saved figure.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Morning check-in' })).toBeNull());
    expect(await screen.findByText('Yesterday · typical dinner added as a guess')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Yesterday looks incomplete\./ })).toBeNull());
    expect(router.state.location.search).toBe('');
    expect(nav()).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Today, Check-in waiting' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');

    await waitFor(async () => expect((await db.days.get(YESTERDAY))?.status).toBe('guess'));
    const after = Math.round(await eatenOn(YESTERDAY));
    expect(after).toBeGreaterThan(before);
    const saved = SAVED_MON_TO_WED + (TARGET - after);
    const updated = await findHero(new RegExp(`Saved this week ${escape(fmtSigned(saved))}\\.`));
    expect(within(updated).getByText(fmtSigned(saved))).toBeInTheDocument();
    expect(within(updated).queryByText(/waiting for check-in/)).toBeNull();
  });
});
