import {
  DEFAULT_ROLLOVER_HOUR,
  DEFAULT_TZ,
  addDays,
  compareDays,
  dayParts,
  daysBetween,
  instantAt,
  logicalDayOf,
  logicalToWallMinutes,
  minutesIntoLogicalDay,
  wallToLogicalMinutes,
  weekDays,
  weekStartOf,
  weekdayIndex,
  zonedParts,
} from './day';

describe('defaults', () => {
  it('uses Kuala Lumpur and a 5am rollover', () => {
    expect(DEFAULT_TZ).toBe('Asia/Kuala_Lumpur');
    expect(DEFAULT_ROLLOVER_HOUR).toBe(5);
  });
});

describe('logicalDayOf', () => {
  it('puts 2:00am Saturday (MYT) on Friday', () => {
    // Sat 17 Oct 2026, 2:00am MYT = Fri 16 Oct 18:00 UTC
    expect(logicalDayOf('2026-10-16T18:00:00.000Z')).toBe('2026-10-16');
  });

  it('starts the new day at 5:00am', () => {
    expect(logicalDayOf('2026-10-16T20:59:00.000Z')).toBe('2026-10-16'); // 4:59am Sat
    expect(logicalDayOf('2026-10-16T21:00:00.000Z')).toBe('2026-10-17'); // 5:00am Sat
  });

  it('keeps an evening meal on its own calendar day', () => {
    expect(logicalDayOf('2026-10-16T11:10:00.000Z')).toBe('2026-10-16'); // 7:10pm Fri
  });

  it('accepts Date objects', () => {
    expect(logicalDayOf(new Date('2026-10-16T18:00:00.000Z'))).toBe('2026-10-16');
  });

  it('respects a custom rollover hour and time zone', () => {
    expect(logicalDayOf('2026-10-16T18:00:00.000Z', DEFAULT_TZ, 0)).toBe('2026-10-17');
    // 2:00am in London (BST) on 17 Oct is 01:00 UTC
    expect(logicalDayOf('2026-10-17T01:00:00.000Z', 'Europe/London')).toBe('2026-10-16');
    expect(logicalDayOf('2026-10-17T04:00:00.000Z', 'Europe/London')).toBe('2026-10-17');
  });

  it('crosses month and year boundaries', () => {
    // 1:00am MYT on 1 Jan 2027
    expect(logicalDayOf('2026-12-31T17:00:00.000Z')).toBe('2026-12-31');
    expect(logicalDayOf('2026-10-31T17:00:00.000Z')).toBe('2026-10-31');
  });

  it('throws on an invalid instant', () => {
    expect(() => logicalDayOf('not a date')).toThrow(RangeError);
  });
});

describe('zonedParts', () => {
  it('reads wall-clock parts in the zone', () => {
    expect(zonedParts('2026-10-16T11:10:00.000Z')).toEqual({
      year: 2026,
      month: 10,
      day: 16,
      hour: 19,
      minute: 10,
      weekday: 4,
    });
  });

  it('reports midnight as hour 0', () => {
    expect(zonedParts('2026-10-16T16:00:00.000Z').hour).toBe(0);
    expect(zonedParts('2026-10-16T16:00:00.000Z').weekday).toBe(5); // Sat
  });
});

describe('calendar arithmetic', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-10-16', 1)).toBe('2026-10-17');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-16', 0)).toBe('2026-10-16');
  });

  it('counts days between, across months', () => {
    expect(daysBetween('2026-09-28', '2026-10-04')).toBe(6);
    expect(daysBetween('2026-10-16', '2026-10-12')).toBe(-4);
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2);
    expect(daysBetween('2026-12-25', '2027-01-08')).toBe(14);
    expect(daysBetween('2026-10-16', '2026-10-16')).toBe(0);
  });

  it('compares days', () => {
    expect(compareDays('2026-10-15', '2026-10-16')).toBe(-1);
    expect(compareDays('2026-10-16', '2026-10-16')).toBe(0);
    expect(compareDays('2026-11-01', '2026-10-31')).toBe(1);
  });

  it('indexes weekdays from Monday', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0);
    expect(weekdayIndex('2026-10-16')).toBe(4);
    expect(weekdayIndex('2026-10-18')).toBe(6);
  });

  it('finds the Monday for every weekday', () => {
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) {
      expect(weekStartOf(day)).toBe('2026-10-12');
    }
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28');
  });

  it('lists the 7 days of a week', () => {
    expect(weekDays('2026-10-12')).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(weekDays('2026-09-28').at(-1)).toBe('2026-10-04');
  });

  it('parses and validates days', () => {
    expect(dayParts('2026-10-16')).toEqual({ year: 2026, month: 10, day: 16 });
    expect(() => dayParts('2026-02-30')).toThrow(RangeError);
    expect(() => dayParts('16/10/2026')).toThrow(RangeError);
  });
});

describe('minutesIntoLogicalDay', () => {
  it('is 0 at the rollover and counts from there', () => {
    expect(minutesIntoLogicalDay('2026-10-15T21:00:00.000Z')).toBe(0); // 5:00am
    expect(minutesIntoLogicalDay('2026-10-16T11:10:00.000Z')).toBe(14 * 60 + 10); // 7:10pm
    expect(minutesIntoLogicalDay('2026-10-16T18:00:00.000Z')).toBe(21 * 60); // 2:00am
    expect(minutesIntoLogicalDay('2026-10-16T20:59:00.000Z')).toBe(1439); // 4:59am
  });

  it('respects the rollover hour', () => {
    expect(minutesIntoLogicalDay('2026-10-16T11:10:00.000Z', DEFAULT_TZ, 0)).toBe(19 * 60 + 10);
  });

  it('converts between wall-clock and logical minutes', () => {
    expect(wallToLogicalMinutes(30)).toBe(19 * 60 + 30);
    expect(logicalToWallMinutes(19 * 60 + 30)).toBe(30);
    expect(logicalToWallMinutes(wallToLogicalMinutes(1410))).toBe(1410);
  });
});

describe('instantAt', () => {
  it('gives the UTC instant of a wall-clock time', () => {
    expect(instantAt('2026-10-16', 10, 40)).toBe('2026-10-16T02:40:00.000Z');
    expect(instantAt('2026-10-16', 0, 0)).toBe('2026-10-15T16:00:00.000Z');
  });

  it('rolls hour 24 and above into the next calendar day', () => {
    expect(instantAt('2026-10-16', 25, 0)).toBe('2026-10-16T17:00:00.000Z'); // 1:00am Sat
    expect(instantAt('2026-10-16', 29, 0)).toBe('2026-10-16T21:00:00.000Z'); // end of Fri's logical day
    expect(logicalDayOf(instantAt('2026-10-16', 26, 0))).toBe('2026-10-16');
  });

  it('handles daylight saving zones', () => {
    // London moves to BST on 29 Mar 2026
    expect(instantAt('2026-03-28', 12, 0, 'Europe/London')).toBe('2026-03-28T12:00:00.000Z');
    expect(instantAt('2026-03-29', 12, 0, 'Europe/London')).toBe('2026-03-29T11:00:00.000Z');
    expect(instantAt('2026-10-16', 9, 30, 'America/New_York')).toBe('2026-10-16T13:30:00.000Z');
  });

  it('round-trips through zonedParts', () => {
    const p = zonedParts(instantAt('2026-10-16', 14, 15));
    expect([p.hour, p.minute, p.day]).toEqual([14, 15, 16]);
  });
});
