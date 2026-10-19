import { MET_TABLE, netWorkoutKcal } from './workout';
import type { Intensity, WorkoutType } from './types';

const TYPES: WorkoutType[] = ['walking', 'futsal', 'badminton', 'gym', 'running', 'cycling', 'swimming', 'other'];
const INTENSITIES: Intensity[] = ['easy', 'moderate', 'hard'];

describe('MET_TABLE', () => {
  it('uses MET 7 for moderate futsal', () => {
    expect(MET_TABLE.futsal.moderate).toBe(7);
  });

  it('has a value above resting for every type and intensity', () => {
    for (const type of TYPES) {
      for (const intensity of INTENSITIES) expect(MET_TABLE[type][intensity]).toBeGreaterThan(1);
    }
  });
});

describe('netWorkoutKcal', () => {
  it('futsal, moderate, 60 min at 78 kg → 470', () => {
    expect(netWorkoutKcal('futsal', 'moderate', 60, 78)).toBe(470);
  });

  it('scales with duration and weight, rounded to 10', () => {
    expect(netWorkoutKcal('futsal', 'moderate', 30, 78)).toBe(230); // 234
    expect(netWorkoutKcal('walking', 'moderate', 45, 80)).toBe(150); // 150
    expect(netWorkoutKcal('futsal', 'moderate', 90, 78) % 10).toBe(0);
  });

  it('is easy < moderate < hard for every type', () => {
    for (const type of TYPES) {
      const [easy, moderate, hard] = INTENSITIES.map((i) => netWorkoutKcal(type, i, 60, 78));
      expect(easy).toBeLessThan(moderate ?? 0);
      expect(moderate).toBeLessThan(hard ?? 0);
    }
  });

  it('gives 0 for missing or invalid inputs', () => {
    expect(netWorkoutKcal('futsal', 'moderate', 0, 78)).toBe(0);
    expect(netWorkoutKcal('futsal', 'moderate', -30, 78)).toBe(0);
    expect(netWorkoutKcal('futsal', 'moderate', 60, 0)).toBe(0);
    expect(netWorkoutKcal('futsal', 'moderate', Number.NaN, 78)).toBe(0);
  });
});
