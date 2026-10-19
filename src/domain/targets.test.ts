import {
  ACTIVITY_FACTOR,
  KCAL_PER_KG,
  bmrMifflinStJeor,
  dailyTargetFor,
  defaultMacroTargets,
  deficitForPace,
  startingMaintenance,
} from './targets';
import type { GoalTemplate } from './types';

const sample = { weightKg: 78.6, heightCm: 172, age: 30 };

describe('constants', () => {
  it('matches the plan', () => {
    expect(ACTIVITY_FACTOR).toEqual({ sedentary: 1.2, light: 1.375, active: 1.55 });
    expect(KCAL_PER_KG).toBe(7700);
  });
});

describe('bmrMifflinStJeor', () => {
  it('adds 5 for men', () => {
    // 786 + 1,075 − 150 + 5
    expect(bmrMifflinStJeor({ ...sample, sex: 'male' })).toBeCloseTo(1716, 6);
  });

  it('subtracts 161 for women', () => {
    expect(bmrMifflinStJeor({ ...sample, sex: 'female' })).toBeCloseTo(1550, 6);
    expect(bmrMifflinStJeor({ sex: 'female', weightKg: 60, heightCm: 160, age: 40 })).toBeCloseTo(1239, 6);
  });
});

describe('startingMaintenance', () => {
  it('multiplies by the activity factor and rounds to 10', () => {
    expect(startingMaintenance({ ...sample, sex: 'male', activity: 'sedentary' })).toBe(2060); // 2,059.2
    expect(startingMaintenance({ ...sample, sex: 'male', activity: 'light' })).toBe(2360); // 2,359.5
    expect(startingMaintenance({ ...sample, sex: 'female', activity: 'active' })).toBe(2400); // 2,402.5
  });
});

describe('deficitForPace', () => {
  it('turns pace into a daily deficit', () => {
    expect(deficitForPace(0.25)).toBe(275);
    expect(deficitForPace(0.5)).toBe(550);
    expect(deficitForPace(0.75)).toBe(825);
    expect(deficitForPace(0)).toBe(0);
    expect(deficitForPace(-0.25)).toBe(-275);
  });
});

describe('dailyTargetFor', () => {
  const min = 1400;

  it('cut: maintenance minus the pace deficit', () => {
    expect(dailyTargetFor({ template: 'cut', paceKgPerWeek: 0.5 }, 2350, min)).toBe(1800);
    expect(dailyTargetFor({ template: 'cut', paceKgPerWeek: 0.5 }, 2100, min)).toBe(1550);
    expect(dailyTargetFor({ template: 'cut', paceKgPerWeek: 0.25 }, 2100, min)).toBe(1825);
  });

  it('festive: maintenance', () => {
    expect(dailyTargetFor({ template: 'festive', paceKgPerWeek: 0 }, 2100, min)).toBe(2100);
  });

  it('lean bulk: maintenance plus the surplus (default 200)', () => {
    expect(dailyTargetFor({ template: 'leanBulk', paceKgPerWeek: -0.25 }, 2100, min)).toBe(2300);
    expect(dailyTargetFor({ template: 'leanBulk', paceKgPerWeek: -0.25, surplusKcal: 300 }, 2100, min)).toBe(2400);
  });

  it('pause and custom: maintenance minus any deficit', () => {
    expect(dailyTargetFor({ template: 'pause', paceKgPerWeek: 0 }, 2100, min)).toBe(2100);
    expect(dailyTargetFor({ template: 'custom', paceKgPerWeek: 0.25 }, 2100, min)).toBe(1825);
  });

  it('never goes below the daily minimum, for any template', () => {
    const templates: GoalTemplate[] = ['cut', 'festive', 'leanBulk', 'pause', 'custom'];
    for (const template of templates) {
      expect(dailyTargetFor({ template, paceKgPerWeek: 0.75, surplusKcal: -900 }, 1500, min)).toBeGreaterThanOrEqual(min);
    }
    expect(dailyTargetFor({ template: 'cut', paceKgPerWeek: 0.75 }, 1700, min)).toBe(1400);
  });
});

describe('defaultMacroTargets', () => {
  it('cut: 1.4 g/kg protein, 30% fat, carbs for the rest, all rounded to 5', () => {
    expect(defaultMacroTargets(1800, 78.6, 'cut')).toEqual({ proteinG: 110, fatG: 60, carbsG: 205 });
  });

  it('lean bulk: 1.65 g/kg protein', () => {
    expect(defaultMacroTargets(2300, 78.6, 'leanBulk')).toEqual({ proteinG: 130, fatG: 75, carbsG: 275 });
  });

  it('always returns multiples of 5 and never negative carbs', () => {
    for (const kcal of [1400, 1555, 1825, 2111, 2600]) {
      const t = defaultMacroTargets(kcal, 71.3, 'festive');
      for (const g of [t.proteinG, t.carbsG, t.fatG]) expect(g % 5).toBe(0);
    }
    expect(defaultMacroTargets(600, 150, 'leanBulk').carbsG).toBe(0);
  });
});
