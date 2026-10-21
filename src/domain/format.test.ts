import {
  ageText,
  fmtAgo,
  fmtApprox,
  fmtClock,
  fmtDateYear,
  fmtDayLetter,
  fmtDayRange,
  fmtDayShort,
  fmtGrams,
  fmtInt,
  fmtKcal,
  fmtKg,
  fmtKgDelta,
  fmtKgRate,
  fmtRange,
  fmtRelativeDay,
  fmtRm,
  fmtSigned,
  fmtTime,
  fmtWeekday,
  roundTo10,
  roundTo5,
} from './format';

const MINUS = '−';
const EN_DASH = '–';

describe('numbers', () => {
  it('formats integers with thousands separators', () => {
    expect(fmtInt(1800)).toBe('1,800');
    expect(fmtInt(12600)).toBe('12,600');
    expect(fmtInt(570)).toBe('570');
    expect(fmtInt(1234567)).toBe('1,234,567');
    expect(fmtInt(1799.6)).toBe('1,800');
  });

  it('uses the true minus sign and never shows −0', () => {
    expect(fmtInt(-120)).toBe(`${MINUS}120`);
    expect(fmtInt(-0.4)).toBe('0');
    expect(fmtInt(-1800)).toBe(`${MINUS}1,800`);
  });

  it('shows signed changes', () => {
    expect(fmtSigned(650)).toBe('+650');
    expect(fmtSigned(-120)).toBe(`${MINUS}120`);
    expect(fmtSigned(-120)).toBe('−120');
    expect(fmtSigned(0)).toBe('0');
    expect(fmtSigned(1450)).toBe('+1,450');
  });

  it('formats kcal, estimates and grams', () => {
    expect(fmtKcal(1800)).toBe('1,800 kcal');
    expect(fmtApprox(560)).toBe('~560');
    expect(fmtGrams(42)).toBe('42g');
  });

  it('formats ranges with an en dash', () => {
    expect(fmtRange({ low: 750, high: 1010 })).toBe(`750${EN_DASH}1,010`);
    expect(fmtRange({ low: 750, high: 1010 })).toBe('750–1,010');
  });

  it('formats weights with one decimal', () => {
    expect(fmtKg(77.9)).toBe('77.9 kg');
    expect(fmtKg(78)).toBe('78.0 kg');
    expect(fmtKg(77.94)).toBe('77.9 kg');
    expect(fmtKgDelta(-0.4)).toBe(`${MINUS}0.4 kg`);
    expect(fmtKgDelta(-0.4)).toBe('−0.4 kg');
    expect(fmtKgDelta(0.3)).toBe('+0.3 kg');
    expect(fmtKgDelta(-0.04)).toBe('0.0 kg');
  });

  it('formats ringgit', () => {
    expect(fmtRm(9.5)).toBe('RM 9.50');
    expect(fmtRm(4.8)).toBe('RM 4.80');
    expect(fmtRm(1234.5)).toBe('RM 1,234.50');
    expect(fmtRm(0)).toBe('RM 0.00');
  });

  it('shows a placeholder for non-finite numbers', () => {
    expect(fmtInt(Number.NaN)).toBe('—');
    expect(fmtSigned(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('rounds to 10 and 5 without negative zero', () => {
    expect(roundTo10(748)).toBe(750);
    expect(roundTo10(1012)).toBe(1010);
    expect(roundTo10(1785)).toBe(1790);
    expect(roundTo5(129.69)).toBe(130);
    expect(roundTo5(76.67)).toBe(75);
    expect(Object.is(roundTo10(-4), 0)).toBe(true);
    expect(Object.is(roundTo5(-2), 0)).toBe(true);
  });
});

describe('times', () => {
  it('formats instants as 12-hour times in the zone', () => {
    expect(fmtTime('2026-10-16T02:40:00.000Z')).toBe('10:40am');
    expect(fmtTime('2026-10-16T11:10:00.000Z')).toBe('7:10pm');
    expect(fmtTime('2026-10-16T16:05:00.000Z')).toBe('12:05am');
    expect(fmtTime('2026-10-16T04:00:00.000Z')).toBe('12:00pm');
    expect(fmtTime('2026-10-16T06:15:00.000Z', 'Asia/Kuala_Lumpur')).toBe('2:15pm');
    expect(fmtTime(new Date('2026-10-16T11:10:00.000Z'), 'Europe/London')).toBe('12:10pm');
  });

  it('formats minutes after midnight, compact on the hour', () => {
    expect(fmtClock(640)).toBe('10:40am');
    expect(fmtClock(21 * 60)).toBe('9:00pm');
    expect(fmtClock(21 * 60, { compact: true })).toBe('9pm');
    expect(fmtClock(21 * 60 + 30, { compact: true })).toBe('9:30pm');
    expect(fmtClock(5 * 60, { compact: true })).toBe('5am');
    expect(fmtClock(0, { compact: true })).toBe('12am');
    expect(fmtClock(1440 + 65)).toBe('1:05am');
  });
});

describe('days', () => {
  it('formats short dates and weekdays', () => {
    expect(fmtDayShort('2026-10-16')).toBe('Fri 16 Oct');
    expect(fmtDayShort('2026-09-03')).toBe('Thu 3 Sep');
    expect(fmtWeekday('2026-10-16')).toBe('Fri');
    expect(fmtWeekday('2026-10-18')).toBe('Sun');
    expect(fmtDayLetter('2026-10-16')).toBe('F');
    expect(fmtDayLetter('2026-10-15')).toBe('T');
    expect(fmtDayLetter('2026-10-17')).toBe('S');
  });

  it('formats week ranges', () => {
    expect(fmtDayRange('2026-10-12', '2026-10-18')).toBe(`12${EN_DASH}18 Oct`);
    expect(fmtDayRange('2026-10-12', '2026-10-18')).toBe('12–18 Oct');
    expect(fmtDayRange('2026-09-28', '2026-10-04')).toBe('28 Sep–4 Oct');
    expect(fmtDayRange('2026-12-28', '2027-01-03')).toBe('28 Dec–3 Jan');
  });

  it('formats a date with the year, no weekday', () => {
    expect(fmtDateYear('2026-10-16')).toBe('16 Oct 2026');
    expect(fmtDateYear('2027-01-05')).toBe('5 Jan 2027');
  });

  it('says how long ago in whole days', () => {
    expect(ageText(0)).toBe('today');
    expect(ageText(1)).toBe('yesterday');
    expect(ageText(2)).toBe('2 days ago');
    expect(ageText(41)).toBe('41 days ago');
    expect(ageText(1200)).toBe('1,200 days ago');
  });

  it('names nearby days relative to today', () => {
    const today = '2026-10-16';
    expect(fmtRelativeDay('2026-10-16', today)).toBe('Today');
    expect(fmtRelativeDay('2026-10-15', today)).toBe('Yesterday');
    expect(fmtRelativeDay('2026-10-17', today)).toBe('Tomorrow');
    expect(fmtRelativeDay('2026-10-13', today)).toBe('Tue');
    expect(fmtRelativeDay('2026-10-05', today)).toBe('Mon 5 Oct');
  });
});

describe('fmtAgo', () => {
  /** Fri 16 Oct 2026, 7:10pm in Kuala Lumpur. */
  const now = Date.parse('2026-10-16T11:10:00.000Z');
  const minutes = (n: number) => n * 60_000;

  it('says just now under a minute, and for a time a little ahead', () => {
    expect(fmtAgo(now, now)).toBe('just now');
    expect(fmtAgo(now - 59_999, now)).toBe('just now');
    expect(fmtAgo(now + minutes(3), now)).toBe('just now');
  });

  it('counts minutes under an hour', () => {
    expect(fmtAgo(now - minutes(1), now)).toBe('1 min ago');
    expect(fmtAgo(now - minutes(5) - 30_000, now)).toBe('5 min ago');
    expect(fmtAgo(now - minutes(59) - 59_000, now)).toBe('59 min ago');
  });

  it('gives the time earlier today and yesterday', () => {
    expect(fmtAgo(now - minutes(60), now)).toBe('at 6:10pm');
    expect(fmtAgo(Date.parse('2026-10-16T01:30:00.000Z'), now)).toBe('at 9:30am');
    // Today is the calendar day: 12:10am is today even before the 5am rollover.
    expect(fmtAgo(Date.parse('2026-10-15T16:10:00.000Z'), now)).toBe('at 12:10am');
    expect(fmtAgo(Date.parse('2026-10-15T15:59:00.000Z'), now)).toBe('yesterday at 11:59pm');
    expect(fmtAgo(Date.parse('2026-10-15T13:40:00.000Z'), now)).toBe('yesterday at 9:40pm');
  });

  it('gives the date before that', () => {
    expect(fmtAgo(Date.parse('2026-10-14T13:40:00.000Z'), now)).toBe('on Wed 14 Oct');
    expect(fmtAgo(Date.parse('2026-09-03T02:00:00.000Z'), now)).toBe('on Thu 3 Sep');
  });

  it('uses the given zone for the day and time', () => {
    // 12:10pm in London (BST); 2:40am there that morning is today.
    const at = Date.parse('2026-10-16T01:40:00.000Z');
    expect(fmtAgo(at, now, 'Europe/London')).toBe('at 2:40am');
    // 11:59pm on the 15th in London is 6:59am on the 16th in Kuala Lumpur.
    const lateNight = Date.parse('2026-10-15T22:59:00.000Z');
    expect(fmtAgo(lateNight, now, 'Europe/London')).toBe('yesterday at 11:59pm');
    expect(fmtAgo(lateNight, now)).toBe('at 6:59am');
  });

  it('shows a placeholder for a time that is not a number', () => {
    expect(fmtAgo(Number.NaN, now)).toBe('—');
  });
});

describe('fmtKgRate', () => {
  it('shows paces and trend rates to the nearest 0.05 kg', () => {
    expect(fmtKgRate(0.2348)).toBe('0.25 kg');
    expect(fmtKgRate(0.5)).toBe('0.5 kg');
    expect(fmtKgRate(0.75)).toBe('0.75 kg');
    expect(fmtKgRate(-0.25)).toBe(`${MINUS}0.25 kg`);
    expect(fmtKgRate(1)).toBe('1 kg');
    expect(fmtKgRate(0.01)).toBe('0 kg');
  });

  it('never shows "−0"', () => {
    expect(fmtKgRate(-0.01)).toBe('0 kg');
    expect(fmtKgRate(-0)).toBe('0 kg');
  });
});
