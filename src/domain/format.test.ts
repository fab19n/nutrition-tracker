import {
  fmtApprox,
  fmtClock,
  fmtDayLetter,
  fmtDayRange,
  fmtDayShort,
  fmtGrams,
  fmtInt,
  fmtKcal,
  fmtKg,
  fmtKgDelta,
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

  it('names nearby days relative to today', () => {
    const today = '2026-10-16';
    expect(fmtRelativeDay('2026-10-16', today)).toBe('Today');
    expect(fmtRelativeDay('2026-10-15', today)).toBe('Yesterday');
    expect(fmtRelativeDay('2026-10-17', today)).toBe('Tomorrow');
    expect(fmtRelativeDay('2026-10-13', today)).toBe('Tue');
    expect(fmtRelativeDay('2026-10-05', today)).toBe('Mon 5 Oct');
  });
});
