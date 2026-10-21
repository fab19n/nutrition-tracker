import { CUSTOM_PRESET, GOAL_PRESETS, GOAL_PRESET_ORDER, NEW_GOAL_TEMPLATES, buildGoal, buildStarterGoals, presetFor } from './defaults';

describe('goal presets', () => {
  it('match the plan templates', () => {
    expect(GOAL_PRESETS.cut).toMatchObject({
      name: 'Cut',
      heroMetric: 'kcalLeft',
      paceKgPerWeek: 0.5,
      timing: { maxWindowHours: 12, minHoursBeforeSleep: 2, maxEatingOccasions: 5 },
    });
    expect(GOAL_PRESETS.festive).toMatchObject({ name: 'Festive maintain', heroMetric: 'daysInRange', paceKgPerWeek: 0, rangePct: 0.1 });
    expect(GOAL_PRESETS.leanBulk).toMatchObject({ name: 'Lean bulk', heroMetric: 'proteinLeft', paceKgPerWeek: -0.25, surplusKcal: 200 });
    expect(GOAL_PRESETS.pause).toMatchObject({ name: 'Pause', heroMetric: 'none', timing: {} });
  });

  it('weigh budget first for a cut and protein first for a bulk', () => {
    const top = (template: keyof typeof GOAL_PRESETS): string => {
      const weights = Object.entries(GOAL_PRESETS[template].suggestionWeights).sort(([, a], [, b]) => b - a);
      return weights[0]?.[0] ?? '';
    };
    expect(top('cut')).toBe('budget');
    expect(top('leanBulk')).toBe('protein');
    expect(GOAL_PRESETS.pause.suggestionWeights.budget).toBe(0);
    for (const template of GOAL_PRESET_ORDER) {
      const total = Object.values(GOAL_PRESETS[template].suggestionWeights).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });
});

describe('buildGoal', () => {
  it('builds a goal with copied settings', () => {
    const goal = buildGoal('cut', { id: 'g1', createdAt: '2026-09-28T01:10:00.000Z', status: 'active' });
    expect(goal).toMatchObject({ id: 'g1', name: 'Cut', template: 'cut', status: 'active', paceKgPerWeek: 0.5 });
    expect(goal).not.toHaveProperty('rangePct');
    goal.timing.maxWindowHours = 10;
    goal.suggestionWeights.budget = 0;
    expect(GOAL_PRESETS.cut.timing.maxWindowHours).toBe(12);
    expect(GOAL_PRESETS.cut.suggestionWeights.budget).toBeGreaterThan(0);
  });

  it('defaults to a template and takes a custom name', () => {
    const goal = buildGoal('festive', { id: 'g2', createdAt: '2026-10-10T13:00:00.000Z', name: 'Raya maintain' });
    expect(goal).toMatchObject({ status: 'template', name: 'Raya maintain', rangePct: 0.1 });
  });

  it('builds the starter library with one active goal', () => {
    const goals = buildStarterGoals('cut', '2026-09-28T01:10:00.000Z', (t) => `goal-${t}`);
    expect(goals.map((g) => [g.id, g.status])).toEqual([
      ['goal-cut', 'active'],
      ['goal-festive', 'template'],
      ['goal-leanBulk', 'template'],
      ['goal-pause', 'template'],
    ]);
  });
});

describe('custom goals (S43)', () => {
  it('offers the templates in chip order, Custom last', () => {
    expect(NEW_GOAL_TEMPLATES).toEqual(['cut', 'festive', 'leanBulk', 'pause', 'custom']);
  });

  it('has a Custom preset set by a pace, like Cut', () => {
    expect(presetFor('custom')).toBe(CUSTOM_PRESET);
    expect(presetFor('custom')).toMatchObject({ name: 'Custom', template: 'custom', heroMetric: 'kcalLeft', paceKgPerWeek: 0.5 });
    expect(presetFor('festive')).toBe(GOAL_PRESETS.festive);
  });

  it('builds a custom goal with copied settings', () => {
    const goal = buildGoal('custom', { id: 'g-custom', createdAt: '2026-10-16T11:10:00.000Z', status: 'saved' });
    expect(goal).toMatchObject({ id: 'g-custom', name: 'Custom', template: 'custom', status: 'saved', heroMetric: 'kcalLeft' });
    goal.timing.maxWindowHours = 9;
    expect(CUSTOM_PRESET.timing.maxWindowHours).toBe(12);
  });
});
