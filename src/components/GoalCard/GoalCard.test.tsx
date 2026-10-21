import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalCard } from './GoalCard';

describe('GoalCard (C46)', () => {
  it('shows the active goal with its week, targets and badge', () => {
    render(
      <GoalCard
        status="active"
        label="Active goal · week 3"
        title="Cut · 1,800 a day"
        detail="−0.5 kg a week · protein 110g · min 1,400"
      />,
    );
    expect(screen.getByText('Active goal · week 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Cut · 1,800 a day' })).toBeInTheDocument();
    expect(screen.getByText('−0.5 kg a week · protein 110g · min 1,400')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('can be an h2 with the saved goals as chips (S48)', () => {
    render(<GoalCard status="active" headingLevel={2} title="Cut · 1,800 a day" detail="x" chips={['Festive maintain · Saved', 'Lean bulk · Draft']} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Cut · 1,800 a day' })).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'Saved goals' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Festive maintain · Saved', 'Lean bulk · Draft']);
  });

  it('opens from the title button, named by the title or its open label', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { rerender } = render(<GoalCard status="saved" title="Festive maintain" detail="2,100 a day" onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Festive maintain' }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(<GoalCard status="template" title="Pause" detail="Budget off" onOpen={onOpen} openLabel="New goal from Pause" />);
    await user.click(screen.getByRole('button', { name: 'New goal from Pause' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['saved', undefined, 'Saved'],
    ['draft', undefined, 'Draft'],
    ['template', undefined, 'Template'],
    ['ended', undefined, 'Ended'],
    ['next', 'Starts Sat', 'Starts Sat'],
  ] as const)('shows the %s badge as a word', (status, badge, word) => {
    render(<GoalCard status={status} badge={badge} title="Goal" detail="detail" />);
    expect(screen.getByText(word)).toBeInTheDocument();
  });

  it('runs its action without opening the card, and waits while busy', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onPress = vi.fn();
    const { rerender } = render(
      <GoalCard status="next" badge="Starts Sat" title="Festive maintain" detail="x" onOpen={onOpen} action={{ label: 'Keep Cut instead', onPress }} />,
    );
    await user.click(screen.getByRole('button', { name: 'Keep Cut instead' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();

    rerender(
      <GoalCard status="next" badge="Starts Sat" title="Festive maintain" detail="x" onOpen={onOpen} action={{ label: 'Keep Cut instead', onPress, busy: true }} />,
    );
    expect(screen.getByRole('button', { name: 'Keep Cut instead' })).toBeDisabled();
  });
});
