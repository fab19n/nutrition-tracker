import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetSuggestionCard, type TargetSuggestionCardProps } from './TargetSuggestionCard';

const BASE: TargetSuggestionCardProps = {
  meta: 'Based on 4 weeks',
  headline: 'Your real maintenance looks like ~2,100, not 2,350',
  working: 'You logged ~1,820 a day, and your trend dropped 0.25 kg a week.',
  currentKcal: '1,800',
  suggestedKcal: '1,550',
  targetNote: 'At your 0.5 kg a week pace, never below your 1,400 minimum.',
  startsNote: 'Starts tomorrow (Sat) if you approve.',
  onApprove: () => {},
};

const FULL: Partial<TargetSuggestionCardProps> = {
  variant: 'full',
  workingRows: [
    { label: 'Logged', value: '~1,820 a day' },
    { label: 'Workouts added', value: '−70 a day' },
    { label: 'Trend', value: '−0.25 kg a week ≈ +275 a day' },
    { label: 'Maintenance', value: '~2,100 a day', strong: true },
  ],
  basis: 'From 28 complete days, Mon 28 Sep to Sun 25 Oct. Days with a guess, not counted or not confirmed are left out. Checked again on Mon 2 Nov.',
  startsNote: 'Starts tomorrow (Sat). Today and earlier days keep their target.',
  weekLine: 'This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal',
};

describe('C45 TargetSuggestionCard', () => {
  it('compact: the numbers, the working and the three actions', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onKeep = vi.fn();
    const onDetails = vi.fn();
    const { container } = render(<TargetSuggestionCard {...BASE} onApprove={onApprove} onKeep={onKeep} onDetails={onDetails} />);

    expect(screen.getByText('Target suggestion')).toBeInTheDocument();
    expect(screen.getByText('Based on 4 weeks')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: BASE.headline })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: BASE.headline })).toBeInTheDocument();
    expect(screen.getByText(BASE.working)).toBeInTheDocument();
    const compare = screen.getByRole('group', { name: 'Now 1,800 a day, suggested 1,550 a day' });
    expect(within(compare).getByText('1,800')).toBeInTheDocument();
    expect(within(compare).getByText('1,550')).toBeInTheDocument();
    expect(screen.getByText('Starts tomorrow (Sat) if you approve.')).toBeInTheDocument();
    expect(screen.getByText(BASE.targetNote)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'See the working' }));
    await user.click(screen.getByRole('button', { name: 'Keep current' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDetails).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole('button', { name: /Change pace instead/ })).toBeNull();
    expect(container.querySelector('dl')).toBeNull();
  });

  it('full: the working step by step, the basis, the week and Change pace instead', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<TargetSuggestionCard {...BASE} {...FULL} onKeep={() => {}} slowerPace={{ detail: '0.25 kg a week → 1,825 a day', onChoose }} />);

    const rows = screen.getByLabelText('How it was worked out');
    expect(rows.tagName).toBe('DL');
    expect(within(rows).getAllByRole('term').map((t) => t.textContent)).toEqual(['Logged', 'Workouts added', 'Trend', 'Maintenance']);
    expect(within(rows).getByText('−0.25 kg a week ≈ +275 a day')).toBeInTheDocument();
    expect(screen.getByText(/^From 28 complete days, Mon 28 Sep to Sun 25 Oct\./)).toBeInTheDocument();
    expect(screen.getByText('This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal')).toBeInTheDocument();
    expect(screen.getByText('Starts tomorrow (Sat). Today and earlier days keep their target.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep current' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See the working' })).toBeNull();

    const slower = screen.getByRole('button', { name: /Change pace instead/ });
    expect(slower).toHaveTextContent('0.25 kg a week → 1,825 a day');
    await user.click(slower);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('kept: the note instead of Keep current, Approve still there', () => {
    const keptNote = 'You kept 1,800 on Fri 30 Oct. The suggestion comes back on Fri 27 Nov, or sooner if your maintenance moves by more than 100 kcal.';
    render(<TargetSuggestionCard {...BASE} {...FULL} keptNote={keptNote} />);
    expect(screen.getByText(keptNote)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep current' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('waits while a decision saves', () => {
    render(
      <TargetSuggestionCard {...BASE} onKeep={() => {}} onDetails={() => {}} busy headingLevel="h3" />,
    );
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('heading', { level: 3, name: BASE.headline })).toBeInTheDocument();
  });

  it('waits on every full button too', () => {
    render(<TargetSuggestionCard {...BASE} {...FULL} onKeep={() => {}} slowerPace={{ detail: 'x', onChoose: () => {} }} busy />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});
