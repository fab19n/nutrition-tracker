/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CUSTOM_PACE_CHOICES, PACE_CHOICES } from '@/domain/goals';
import type { GoalTemplate } from '@/domain/types';
import { GoalEditorFields, type GoalEditorFieldsProps, type GoalEditorValue } from './GoalEditorFields';

const CUT: GoalEditorValue = {
  name: 'Cut',
  heroMetric: 'kcalLeft',
  dailyKcal: 1800,
  proteinG: 110,
  paceKgPerWeek: 0.5,
  rangePct: 0.1,
  windowHours: 12,
  fixedWindow: { on: false, start: '10:00', end: '20:00' },
  sleepGap: { on: true, hours: 2 },
  grazing: { on: true, occasions: 5 },
  insightsOff: [],
  end: { kind: 'none', date: '', weightKg: '' },
};

function props(template: GoalTemplate, overrides: Partial<GoalEditorFieldsProps> = {}): GoalEditorFieldsProps {
  return {
    template,
    value: CUT,
    onChange: vi.fn(),
    onSelectPace: vi.fn(),
    paceOptions: template === 'custom' ? CUSTOM_PACE_CHOICES : PACE_CHOICES,
    kcalMin: 1400,
    hints: { target: 'Maintenance ~2,350 − 550 for 0.5 kg a week', macros: 'Carbs 205g and fat 60g follow from the rest.' },
    allowWeightEnd: true,
    endDateMin: '2026-10-17',
    endDateMax: '2028-10-15',
    ...overrides,
  };
}

/** A controlled form, like the screens. */
function Live({ template, initial = CUT }: { template: GoalTemplate; initial?: GoalEditorValue }) {
  const [value, setValue] = useState(initial);
  return <GoalEditorFields {...props(template)} value={value} onChange={setValue} />;
}

describe('GoalEditorFields (C48)', () => {
  it('shows every section of a Cut goal', () => {
    render(<GoalEditorFields {...props('cut')} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Cut');
    for (const heading of ['Name', 'Target', 'Timing', 'Insights', 'End']) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
    const target = screen.getByRole('group', { name: 'Daily target' });
    expect(target).toHaveTextContent('1,800 kcal');
    expect(target).toHaveTextContent('Maintenance ~2,350 − 550 for 0.5 kg a week');
    expect(screen.getByRole('group', { name: 'Pace, per week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0.5 kg' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Protein' })).toHaveTextContent('110 g');
    expect(screen.getByText('Carbs 205g and fat 60g follow from the rest.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Range' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Main number' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Eating window' })).toHaveTextContent('12 h');
    expect(screen.getByRole('switch', { name: 'Last meal before sleep' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('More than 5 eating occasions a day')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Fixed hours' })).toBeNull();
    for (const name of ['Food and budget', 'Protein', 'Meal timing', 'Weight trend']) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
    }
    expect(within(screen.getByRole('group', { name: 'End' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'No end',
      'By a date',
      'At a weight',
    ]);
  });

  it('steps the target by 50, never under the daily minimum', async () => {
    const user = userEvent.setup();
    const p = props('cut');
    const { rerender } = render(<GoalEditorFields {...p} />);
    await user.click(screen.getByRole('button', { name: 'Raise daily target' }));
    expect(p.onChange).toHaveBeenCalledWith({ ...CUT, dailyKcal: 1850 });
    rerender(<GoalEditorFields {...p} value={{ ...CUT, dailyKcal: 1400 }} />);
    expect(screen.getByRole('button', { name: 'Lower daily target' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Raise protein' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ ...CUT, dailyKcal: 1400, proteinG: 115 });
  });

  it('hands a pace to the screen, which works out the target', async () => {
    const user = userEvent.setup();
    const p = props('cut');
    render(<GoalEditorFields {...p} />);
    await user.click(screen.getByRole('button', { name: '0.25 kg' }));
    expect(p.onSelectPace).toHaveBeenCalledWith(0.25);
    expect(p.onChange).not.toHaveBeenCalled();
  });

  it('turns timing rules and insight groups on and off', async () => {
    const user = userEvent.setup();
    render(<Live template="cut" />);
    expect(screen.getByRole('group', { name: 'Hours before sleep' })).toHaveTextContent('2 h');
    await user.click(screen.getByRole('switch', { name: 'Last meal before sleep' }));
    expect(screen.getByRole('switch', { name: 'Last meal before sleep' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('group', { name: 'Hours before sleep' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Raise eating occasions' }));
    expect(screen.getByText('More than 6 eating occasions a day')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Meal timing' }));
    expect(screen.getByRole('switch', { name: 'Meal timing' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reports the insight groups turned off', async () => {
    const user = userEvent.setup();
    const p = props('cut');
    render(<GoalEditorFields {...p} />);
    await user.click(screen.getByRole('switch', { name: 'Meal timing' }));
    expect(p.onChange).toHaveBeenCalledWith({ ...CUT, insightsOff: ['timing'] });
  });

  it('asks for an end date or weight', async () => {
    const user = userEvent.setup();
    render(<Live template="cut" />);
    expect(screen.queryByLabelText('End date')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'By a date' }));
    const date = screen.getByLabelText('End date');
    expect(date).toHaveAttribute('min', '2026-10-17');
    expect(date).toHaveAttribute('max', '2028-10-15');
    await user.click(screen.getByRole('button', { name: 'At a weight' }));
    expect(screen.queryByLabelText('End date')).toBeNull();
    const weight = screen.getByLabelText('End weight');
    expect(weight).toHaveAttribute('inputmode', 'decimal');
    await user.type(weight, '75,5');
    expect(weight).toHaveValue('75,5');
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('marks fields with errors', () => {
    render(
      <GoalEditorFields
        {...props('cut', { errors: { name: 'Give it a name', end: 'Pick a date after today' }, hints: { end: 'Ends Sat 17 Oct · 1 day to go' } })}
        value={{ ...CUT, name: '', end: { kind: 'date', date: '2026-10-16', weightKg: '' } }}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Give it a name');
    expect(screen.getByText('Give it a name')).toBeInTheDocument();
    expect(screen.getByLabelText('End date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Pick a date after today')).toBeInTheDocument();
    expect(screen.getByText('Ends Sat 17 Oct · 1 day to go')).toBeInTheDocument();
  });

  it('has a range and no pace or weight end for Festive maintain', () => {
    render(
      <GoalEditorFields
        {...props('festive', { allowWeightEnd: false, hints: { range: 'In range 1,890–2,310' } })}
        value={{ ...CUT, paceKgPerWeek: 0, dailyKcal: 2100 }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '± 10%' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '± 5%' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('In range 1,890–2,310')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Pace, per week' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'At a weight' })).toBeNull();
  });

  it('has only the name and what a pause means for Pause', () => {
    render(<GoalEditorFields {...props('pause')} value={{ ...CUT, name: 'Pause' }} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Pause');
    expect(screen.getByText('Budget off. Logging is optional, and these days stay out of trends.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Daily target' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Timing' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'End' })).toBeNull();
  });

  it('says when a Pause picks its length, only for a goal still to switch to', () => {
    render(<GoalEditorFields {...props('pause')} value={{ ...CUT, name: 'Pause' }} switchNote />);
    expect(screen.getByText('Budget off. Logging is optional, and these days stay out of trends. You pick how long when you switch.')).toBeInTheDocument();
  });

  it('lets a Custom goal pick its main number, hold its weight and set fixed hours', async () => {
    const user = userEvent.setup();
    render(<Live template="custom" />);
    const main = screen.getByRole('group', { name: 'Main number' });
    expect(within(main).getByRole('button', { name: 'Kcal left' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(main).getByRole('button', { name: 'Protein left' }));
    expect(within(main).getByRole('button', { name: 'Protein left' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Hold' })).toBeInTheDocument();

    expect(screen.getByRole('group', { name: 'Eating window' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Fixed hours' }));
    expect(screen.queryByRole('group', { name: 'Eating window' })).toBeNull();
    expect(screen.getByLabelText('Opens')).toHaveValue('10:00');
    expect(screen.getByLabelText('Closes')).toHaveValue('20:00');
  });

  it('keeps the fixed hours inputs at the 44px touch minimum', () => {
    const css = readFileSync('src/components/GoalEditorFields/GoalEditorFields.module.css', 'utf8');
    const rule = css.match(/\.time\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(Number(rule.match(/min-height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
  });

  describe('errors', () => {
    const FIXED: GoalEditorValue = { ...CUT, fixedWindow: { on: true, start: '10:00', end: '10:00' } };

    it('announces each message and ties it to its field', () => {
      render(
        <GoalEditorFields
          {...props('custom')}
          value={{ ...FIXED, end: { kind: 'date', date: '2026-10-16', weightKg: '' } }}
          errors={{ name: 'Give it a name', dailyKcal: 'At least your 1,400 daily minimum', proteinG: 'Between 40 and 250g', timing: 'Opening and closing times need to differ', end: 'Pick a date after today' }}
        />,
      );
      expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
        'Give it a name',
        'At least your 1,400 daily minimum',
        'Between 40 and 250g',
        'Opening and closing times need to differ',
        'Pick a date after today',
      ]);
      const described = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent;
      expect(described(screen.getByLabelText('Name'))).toBe('Give it a name');
      expect(described(screen.getByRole('group', { name: 'Daily target' }))).toBe('At least your 1,400 daily minimum');
      expect(described(screen.getByRole('group', { name: 'Protein' }))).toBe('Between 40 and 250g');
      expect(described(screen.getByLabelText('Opens'))).toBe('Opening and closing times need to differ');
      expect(described(screen.getByLabelText('Closes'))).toBe('Opening and closing times need to differ');
      expect(described(screen.getByLabelText('End date'))).toBe('Pick a date after today');
    });

    it('moves the focus to the first invalid field when the screen bumps focusSeq', () => {
      const errors = { proteinG: 'Between 40 and 250g', timing: 'Opening and closing times need to differ' };
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const { rerender } = render(<GoalEditorFields {...props('custom')} value={FIXED} errors={errors} />);
      // Errors alone (typing in the field again) never move the focus.
      expect(document.body).toHaveFocus();
      rerender(<GoalEditorFields {...props('custom')} value={FIXED} errors={errors} focusSeq={1} />);
      expect(screen.getByRole('group', { name: 'Protein' })).toHaveFocus();
      expect(scroll).toHaveBeenCalledTimes(1);
      rerender(<GoalEditorFields {...props('custom')} value={FIXED} errors={{ timing: errors.timing }} focusSeq={2} />);
      expect(screen.getByLabelText('Opens')).toHaveFocus();
      rerender(<GoalEditorFields {...props('custom')} value={{ ...FIXED, name: '' }} errors={{ name: 'Give it a name', ...errors }} focusSeq={3} />);
      expect(screen.getByLabelText('Name')).toHaveFocus();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('focuses the end field of a date and of a weight', () => {
      const date = render(<GoalEditorFields {...props('cut')} value={{ ...CUT, end: { kind: 'date', date: '2026-10-16', weightKg: '' } }} errors={{ end: 'Pick a date after today' }} focusSeq={1} />);
      expect(screen.getByLabelText('End date')).toHaveFocus();
      date.unmount();
      render(<GoalEditorFields {...props('cut')} value={{ ...CUT, end: { kind: 'weight', date: '', weightKg: '74' } }} errors={{ end: 'Pick a weight under your 73.0 kg trend' }} focusSeq={1} />);
      expect(screen.getByLabelText('End weight')).toHaveFocus();
    });
  });
});
