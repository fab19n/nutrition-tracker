import { DEMO_NOW_ISO, isDemoClock, now, setDemoClock } from './clock';
import { fmtTime } from './format';
import { logicalDayOf } from './day';

afterEach(() => setDemoClock(false));

describe('clock', () => {
  it('pins now to Fri 16 Oct 2026, 7:10pm MYT in demo mode', () => {
    setDemoClock(true);
    expect(isDemoClock()).toBe(true);
    expect(now().toISOString()).toBe(DEMO_NOW_ISO);
    expect(logicalDayOf(now())).toBe('2026-10-16');
    expect(fmtTime(now())).toBe('7:10pm');
  });

  it('returns a fresh Date each call, so callers cannot change the demo time', () => {
    setDemoClock(true);
    const first = now();
    first.setFullYear(2000);
    expect(now().toISOString()).toBe(DEMO_NOW_ISO);
  });

  it('uses the real time otherwise', () => {
    setDemoClock(false);
    expect(isDemoClock()).toBe(false);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
