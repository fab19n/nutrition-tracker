/**
 * Pure helpers that turn the top dishes check (src/db/dishCheck) into what S34, its Insights
 * card and the Unlock-list row show. All of the copy lives here. Estimates carry "~" and round
 * to 10, like a meal's number does.
 */
import type { UnlockProgressProps } from '@/components/UnlockProgress/UnlockProgress';
import type { DishCheckStatus, DishCheckSummary, DishCheckView, DishRowView } from '@/db/dishCheck';
import { DISH_CHECK_MIN_DAYS, DISH_CHECK_MIN_DISHES } from '@/domain/dishCheck';
import { logicalDayOf } from '@/domain/day';
import { fmtApprox, fmtDayShort, fmtInt, roundTo10 } from '@/domain/format';

/** The label the Unlock list and the card know the check by. */
export const DISH_CHECK_LABEL = 'Top dishes check';
const TIMING_LABEL = 'Timing patterns';

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** "~200" */
export function kcalLabel(kcal: number): string {
  return fmtApprox(roundTo10(kcal));
}

/** "Normal · 8 times", "Mamak big · Nasi kandar near home · 6 times". */
export function rowDetail(row: Pick<DishRowView, 'portion' | 'placeName' | 'times'>): string {
  return [row.portion, row.placeName, `${fmtInt(row.times)} times`].filter(Boolean).join(' · ');
}

/** What a row says once answered. Undefined before. */
export function resultLine(row: Pick<DishRowView, 'answer' | 'saved' | 'kcal' | 'fromKcal'>): string | undefined {
  if (row.answer === undefined) return undefined;
  const now = kcalLabel(row.kcal);
  if (row.answer === 'right') return row.saved ? `Looks right. Saved as yours at ${now} kcal.` : 'Looks right. No change.';
  const was = kcalLabel(row.fromKcal ?? row.kcal);
  return `${row.answer === 'more' ? 'Usually more' : 'Usually less'}. Now ${now} kcal (was ${was}).`;
}

export interface DishCardCopy {
  title: string;
  body: string;
  /** "Start" or "Continue". */
  primaryLabel: string;
}

/** The Insights card: only while the check is ready or under way, and not hidden with "Not now". */
export function cardCopy(status: DishCheckStatus): DishCardCopy | undefined {
  if (status.hidden) return undefined;
  if (status.phase === 'ready') {
    return { title: 'Check your top dishes', body: `Your ${fmtInt(status.total)} most-logged dishes, once. About 2 minutes.`, primaryLabel: 'Start' };
  }
  if (status.phase === 'inProgress') {
    return {
      title: DISH_CHECK_LABEL,
      body: `${fmtInt(status.answered)} of ${fmtInt(status.total)} checked. Pick up where you left off.`,
      primaryLabel: 'Continue',
    };
  }
  return undefined;
}

/** The "Top dishes check" row of "Unlocks as you log". Tappable once the check is ready, under way or done. */
export function dishUnlockItem(status: DishCheckStatus, open: () => void): UnlockProgressProps {
  switch (status.phase) {
    case 'locked':
      return { label: DISH_CHECK_LABEL, have: status.loggedDays, need: DISH_CHECK_MIN_DAYS, unit: 'days' };
    case 'thin':
      return { label: DISH_CHECK_LABEL, have: status.dishCount, need: DISH_CHECK_MIN_DISHES, unit: 'dishes' };
    case 'ready':
      return { label: DISH_CHECK_LABEL, have: 0, need: 1, valueLabel: 'Ready', onPress: open };
    case 'inProgress':
      return { label: DISH_CHECK_LABEL, have: status.answered, need: status.total, valueLabel: `${fmtInt(status.answered)} of ${fmtInt(status.total)} checked`, onPress: open };
    case 'done':
      return { label: DISH_CHECK_LABEL, have: status.total, need: status.total, valueLabel: 'Checked', onPress: open };
  }
}

/**
 * The Unlock list with the dish row after "Timing patterns" (at the end when that item isn't
 * listed). The section shows while anything is locked, and while the check is ready or under way:
 * a check with every dish answered keeps its row until Done.
 */
export function unlockListModel(
  unlocks: readonly UnlockProgressProps[],
  status: DishCheckStatus,
  open: () => void,
): { items: UnlockProgressProps[]; show: boolean } {
  const dish = dishUnlockItem(status, open);
  const items = [...unlocks];
  const at = items.findIndex((item) => item.label === TIMING_LABEL);
  items.splice(at === -1 ? items.length : at + 1, 0, dish);
  const show = items.some((item) => item.have < item.need) || status.phase === 'ready' || status.phase === 'inProgress';
  return { items, show };
}

export interface DishFooterModel {
  label: string;
  variant: 'primary' | 'secondary';
  /** "3 not checked yet", under a partial Done. */
  caption?: string;
  /** Asked before finishing with dishes still unchecked. */
  confirm?: { title: string; body: string; confirmLabel: string; cancelLabel: string };
}

/** The sticky footer: "Not now" before any answer, "Done" after (asking first while dishes are left). */
export function footerModel(view: Pick<DishCheckView, 'answered' | 'total'>): DishFooterModel {
  const { answered, total } = view;
  if (total > 0 && answered === 0) return { label: 'Not now', variant: 'secondary' };
  if (answered >= total) return { label: 'Done', variant: 'primary' };
  const left = total - answered;
  return {
    label: 'Done',
    variant: 'primary',
    caption: `${fmtInt(left)} not checked yet`,
    confirm: {
      title: 'Finish the check?',
      body:
        left === 1
          ? "1 dish hasn't been checked, and it won't be asked again. Your answers so far are saved."
          : `${fmtInt(left)} dishes haven't been checked, and they won't be asked again. Your answers so far are saved.`,
      confirmLabel: 'Finish',
      cancelLabel: 'Keep checking',
    },
  };
}

/** "Top dishes checked · 3 updated", or "· nothing to change". */
export function finishToast(updated: number): string {
  return updated > 0 ? `Top dishes checked · ${fmtInt(updated)} updated` : 'Top dishes checked · nothing to change';
}

/** "12 of 30 dishes checked on Fri 16 Oct." */
export function doneBody(view: Pick<DishCheckView, 'answered' | 'total' | 'doneAt'>, tz: string, rolloverHour: number): string {
  const checked = `${fmtInt(view.answered)} of ${plural(view.total, 'dish', 'dishes')} checked`;
  return view.doneAt ? `${checked} on ${fmtDayShort(logicalDayOf(view.doneAt, tz, rolloverHour))}.` : `${checked}.`;
}

/** The summary's count rows; "Not checked" only when something was left. */
export function summaryRows(summary: DishCheckSummary): { label: string; count: number }[] {
  const rows = [
    { label: 'Looks right', count: summary.right },
    { label: 'Usually more', count: summary.more },
    { label: 'Usually less', count: summary.less },
  ];
  if (summary.notChecked > 0) rows.push({ label: 'Not checked', count: summary.notChecked });
  return rows;
}

/** "was ~200, now ~250 kcal" */
export function changeLine(change: Pick<DishCheckSummary['changes'][number], 'fromKcal' | 'toKcal'>): string {
  return `was ${kcalLabel(change.fromKcal)}, now ${kcalLabel(change.toKcal)} kcal`;
}
