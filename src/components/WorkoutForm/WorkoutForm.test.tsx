import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { netWorkoutKcal } from '@/domain/workout';
import { WorkoutForm, type WorkoutFormProps } from './WorkoutForm';
import {
  MINUTES,
  WORKOUT_TYPES,
  gridMove,
  initialWorkoutValue,
  lineMove,
  minutesError,
  parseMinutes,
  stepMinutes,
  workoutName,
  type WorkoutFormValue,
} from './workoutOptions';

describe('workout options', () => {
  it('lists the eight types in the design order', () => {
    expect(WORKOUT_TYPES).toEqual(['walking', 'futsal', 'badminton', 'gym', 'running', 'cycling', 'swimming', 'other']);
    expect(workoutName('futsal')).toBe('Futsal');
    expect(workoutName('other')).toBe('Workout');
  });

  it('starts from the last workout, else walking 30 min moderate', () => {
    expect(initialWorkoutValue({ type: 'futsal', intensity: 'moderate', minutes: 60 })).toEqual({ type: 'futsal', intensity: 'moderate', minutesText: '60' });
    expect(initialWorkoutValue()).toEqual({ type: 'walking', intensity: 'moderate', minutesText: '30' });
    expect(initialWorkoutValue({ type: 'gym', intensity: 'hard', minutes: 400 }).minutesText).toBe('300');
  });

  it('reads whole minutes within 5–300', () => {
    expect(parseMinutes('60')).toBe(60);
    expect(parseMinutes(' 47 ')).toBe(47);
    expect(parseMinutes('5')).toBe(5);
    expect(parseMinutes('300')).toBe(300);
    expect(parseMinutes('4')).toBeNull();
    expect(parseMinutes('301')).toBeNull();
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('1.5')).toBeNull();
    expect(parseMinutes('abc')).toBeNull();
  });

  it('explains what is wrong with the minutes', () => {
    expect(minutesError('60')).toBeNull();
    expect(minutesError('')).toBe('Enter how many minutes.');
    expect(minutesError('4')).toBe('At least 5 minutes.');
    expect(minutesError('400')).toBe('Up to 300 minutes (5 hours).');
    expect(minutesError('4x')).toBe('Use whole minutes, like 45.');
  });

  it('steps by 5, snaps odd values and stays in bounds', () => {
    expect(stepMinutes('60', 1)).toBe(65);
    expect(stepMinutes('60', -1)).toBe(55);
    expect(stepMinutes('47', 1)).toBe(50);
    expect(stepMinutes('47', -1)).toBe(45);
    expect(stepMinutes('5', -1)).toBe(MINUTES.min);
    expect(stepMinutes('300', 1)).toBe(MINUTES.max);
    expect(stepMinutes('3', 1)).toBe(5);
    expect(stepMinutes('999', -1)).toBe(300);
    expect(stepMinutes('', 1)).toBe(5);
  });

  it('moves around the 4 × 2 grid with the arrow keys', () => {
    expect(gridMove(0, 'ArrowRight', 8)).toBe(1);
    expect(gridMove(7, 'ArrowRight', 8)).toBe(0);
    expect(gridMove(0, 'ArrowLeft', 8)).toBe(7);
    expect(gridMove(1, 'ArrowDown', 8)).toBe(5);
    expect(gridMove(5, 'ArrowDown', 8)).toBe(1);
    expect(gridMove(5, 'ArrowUp', 8)).toBe(1);
    expect(gridMove(2, 'ArrowUp', 8)).toBe(6);
    expect(gridMove(2, 'ArrowUp', 7)).toBe(6);
    expect(gridMove(3, 'ArrowUp', 7)).toBe(3);
    expect(gridMove(4, 'Home', 8)).toBe(0);
    expect(gridMove(4, 'End', 8)).toBe(7);
    expect(gridMove(4, 'Enter', 8)).toBeNull();
  });

  it('moves along the intensity row with the arrow keys, wrapping', () => {
    expect(lineMove(0, 'ArrowRight', 3)).toBe(1);
    expect(lineMove(1, 'ArrowDown', 3)).toBe(2);
    expect(lineMove(2, 'ArrowRight', 3)).toBe(0);
    expect(lineMove(0, 'ArrowLeft', 3)).toBe(2);
    expect(lineMove(2, 'ArrowUp', 3)).toBe(1);
    expect(lineMove(1, 'Home', 3)).toBe(0);
    expect(lineMove(0, 'End', 3)).toBe(2);
    expect(lineMove(0, 'Tab', 3)).toBeNull();
    expect(lineMove(0, 'ArrowRight', 0)).toBeNull();
  });
});

const WEIGHT_KG = 77.8;

/** The form with a live estimate, as S29 wires it. */
function Harness({ initial, ...rest }: { initial?: WorkoutFormValue } & Partial<WorkoutFormProps>) {
  const [value, setValue] = useState<WorkoutFormValue>(initial ?? { type: 'futsal', intensity: 'moderate', minutesText: '60' });
  const minutes = parseMinutes(value.minutesText);
  const estimate = minutes === null ? null : netWorkoutKcal(value.type, value.intensity, minutes, WEIGHT_KG);
  return <WorkoutForm value={value} onChange={setValue} estimateKcal={estimate} {...rest} />;
}

function estimateLine(): HTMLElement {
  const helper = screen.getByText('Estimated from activity type, time, intensity and your weight.');
  const line = helper.previousElementSibling;
  if (!(line instanceof HTMLElement)) throw new Error('No estimate line');
  return line;
}

describe('WorkoutForm (C51)', () => {
  it('shows the type grid, time, intensity and the live estimate', () => {
    render(<Harness />);
    const types = screen.getByRole('radiogroup', { name: 'Activity' });
    expect(types.querySelectorAll('[role="radio"]')).toHaveLength(8);
    expect(screen.getByRole('radio', { name: 'Futsal' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Futsal' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Walking' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('textbox', { name: 'Time in minutes' })).toHaveValue('60');
    expect(screen.getByRole('radio', { name: 'Moderate' })).toHaveAttribute('aria-checked', 'true');
    expect(estimateLine()).toHaveTextContent('~470 kcal added to this week');
  });

  it('updates the estimate as the type, time and intensity change', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('radio', { name: 'Walking' }));
    expect(screen.getByRole('radio', { name: 'Walking' })).toHaveAttribute('aria-checked', 'true');
    // (3.5 − 1) × 77.8 kg × 1 h = 194.5 → ~190
    expect(estimateLine()).toHaveTextContent('~190 kcal added to this week');

    await user.click(screen.getByRole('button', { name: '5 minutes less' }));
    expect(screen.getByRole('textbox', { name: 'Time in minutes' })).toHaveValue('55');
    await user.click(screen.getByRole('button', { name: '5 minutes more' }));
    await user.click(screen.getByRole('button', { name: '5 minutes more' }));
    expect(screen.getByRole('textbox', { name: 'Time in minutes' })).toHaveValue('65');

    await user.click(screen.getByRole('radio', { name: 'Hard' }));
    // (5.0 − 1) × 77.8 × 65/60 = 337.1 → ~340
    expect(estimateLine()).toHaveTextContent('~340 kcal added to this week');
  });

  it('moves the type with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('radio', { name: 'Futsal' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Badminton' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Badminton' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Swimming' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Other' })).toHaveAttribute('aria-checked', 'true');
  });

  it('picks the intensity from accent chips: a labelled radio group with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Intensity' });
    const radios = group.querySelectorAll('[role="radio"]');
    expect([...radios].map((r) => r.textContent)).toEqual(['Easy', 'Moderate', 'Hard']);
    const moderate = screen.getByRole('radio', { name: 'Moderate' });
    // Radio semantics only (no toggle-button state on top), one tab stop on the selected chip.
    expect(moderate).not.toHaveAttribute('aria-pressed');
    expect(moderate).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Easy' })).toHaveAttribute('tabindex', '-1');

    moderate.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Hard' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Hard' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Easy' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Easy' })).toHaveFocus();
    // Easy futsal: (5.0 − 1) × 77.8 kg × 1 h = 311.2 → ~310
    expect(estimateLine()).toHaveTextContent('~310 kcal added to this week');
  });

  it('takes typed minutes, steps with ↑/↓ and disables the buttons at the bounds', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Time in minutes' });

    await user.clear(input);
    await user.type(input, '300');
    expect(screen.getByRole('button', { name: '5 minutes more' })).toBeDisabled();
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveValue('295');

    await user.clear(input);
    await user.type(input, '5');
    expect(screen.getByRole('button', { name: '5 minutes less' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '5 minutes more' })).toBeEnabled();

    await user.clear(input);
    await user.type(input, '4a5');
    expect(input).toHaveValue('45');
  });

  it('shows the time message after leaving the field, not while typing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Time in minutes' });

    await user.clear(input);
    await user.type(input, '2');
    expect(screen.queryByText('At least 5 minutes.')).not.toBeInTheDocument();
    expect(estimateLine()).toHaveTextContent('Set the time to see the estimate.');

    fireEvent.blur(input);
    expect(screen.getByText('At least 5 minutes.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('At least 5 minutes.');

    await user.type(input, '0');
    expect(screen.queryByText('At least 5 minutes.')).not.toBeInTheDocument();
    expect(estimateLine()).toHaveTextContent('~160 kcal added to this week');
  });

  it('shows errors straight away when asked, and the week and note it is given', () => {
    const { rerender } = render(<Harness initial={{ type: 'gym', intensity: 'easy', minutesText: '' }} showErrors />);
    expect(screen.getByText('Enter how many minutes.')).toBeInTheDocument();

    rerender(<Harness initial={{ type: 'gym', intensity: 'easy', minutesText: '' }} showErrors estimateNote="Add a weigh-in first." />);
    expect(estimateLine()).toHaveTextContent('Add a weigh-in first.');
  });

  it('names the week the kcal go to', () => {
    render(<Harness weekLabel="last week" />);
    expect(estimateLine()).toHaveTextContent('~470 kcal added to last week');
  });
});
