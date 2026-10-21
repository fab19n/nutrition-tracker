import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalSwitchPanel, GoalSwitchSheet, type GoalSwitchPanelProps } from './GoalSwitchSheet';

function festiveProps(overrides: Partial<GoalSwitchPanelProps> = {}): GoalSwitchPanelProps {
  return {
    goalName: 'Festive maintain',
    startsLine: 'Starts tomorrow (Sat). Past days keep the goal they had.',
    week: { lead: 'This week: 5 days at 1,800 + 2 days at 2,100 = ', total: '13,200 kcal' },
    changes: ['Main number becomes days in range (2,100 ± 10%).', 'Timing: 14-hour eating window, more than 6 eating occasions flagged.'],
    confirmLabel: 'Switch from tomorrow',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe('GoalSwitchSheet (C47)', () => {
  it('says what the switch does, and confirms or cancels', async () => {
    const user = userEvent.setup();
    const props = festiveProps();
    render(<GoalSwitchSheet open {...props} />);
    const dialog = screen.getByRole('dialog', { name: 'Switch to Festive maintain?' });
    expect(within(dialog).getByText('Starts tomorrow (Sat). Past days keep the goal they had.')).toBeInTheDocument();
    expect(within(dialog).getByText(/This week: 5 days at 1,800 \+ 2 days at 2,100 =/)).toBeInTheDocument();
    expect(within(dialog).getByText('13,200 kcal').tagName).toBe('B');
    expect(within(dialog).getByText('Main number becomes days in range (2,100 ± 10%).')).toBeInTheDocument();
    expect(within(dialog).getByText('Timing: 14-hour eating window, more than 6 eating occasions flagged.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('group', { name: 'Until' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Switch from tomorrow' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const props = festiveProps();
    render(<GoalSwitchSheet open {...props} />);
    await user.keyboard('{Escape}');
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('waits while the switch is saved', () => {
    render(<GoalSwitchPanel {...festiveProps({ busy: true })} />);
    expect(screen.getByRole('button', { name: 'Switch from tomorrow' })).toBeDisabled();
  });

  it('shows a booking it replaces', () => {
    render(<GoalSwitchPanel {...festiveProps({ replaces: 'This replaces Festive maintain from Sat.' })} />);
    expect(screen.getByText('This replaces Festive maintain from Sat.')).toBeInTheDocument();
  });

  it('lets a pause run to a day, to a picked date or until the next switch', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onDate = vi.fn();
    const until: NonNullable<GoalSwitchPanelProps['until']> = {
      options: [
        { id: 'monday', label: 'Mon 19 Oct' },
        { id: 'date', label: 'Pick a date' },
        { id: 'open', label: 'Until I switch back' },
      ],
      selected: 'monday',
      onSelect,
      date: '2026-10-24',
      minDate: '2026-10-18',
      maxDate: '2026-12-16',
      onDate,
      line: 'Cut starts again on Mon 19 Oct.',
    };
    const props = festiveProps({
      goalName: 'Pause',
      week: { lead: 'This week: 5 days at 1,800 = ', total: '9,000 kcal', tail: '. Sat and Sun: budget off.' },
      changes: ['Budget off. Logging is optional, and these days stay out of trends.'],
      until,
    });
    const { rerender } = render(<GoalSwitchPanel {...props} />);
    expect(screen.getByText(/Sat and Sun: budget off\./)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Until' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mon 19 Oct', 'Pick a date', 'Until I switch back']);
    expect(within(group).getByRole('button', { name: 'Mon 19 Oct' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Cut starts again on Mon 19 Oct.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Until date')).toBeNull();
    await user.click(within(group).getByRole('button', { name: 'Pick a date' }));
    expect(onSelect).toHaveBeenCalledWith('date');

    rerender(<GoalSwitchPanel {...props} until={{ ...until, selected: 'date', line: 'Cut starts again on Sat 24 Oct.' }} />);
    const input = screen.getByLabelText('Until date');
    expect(input).toHaveAttribute('min', '2026-10-18');
    expect(input).toHaveAttribute('max', '2026-12-16');
    expect(input).toHaveValue('2026-10-24');
    fireEvent.change(input, { target: { value: '2026-11-02' } });
    expect(onDate).toHaveBeenCalledWith('2026-11-02');

    rerender(<GoalSwitchPanel {...props} until={{ ...until, selected: 'date', error: 'Pick a day between Sun 18 Oct and Wed 16 Dec' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a day between Sun 18 Oct and Wed 16 Dec');
    expect(screen.getByLabelText('Until date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Switch from tomorrow' })).toBeDisabled();
  });
});
