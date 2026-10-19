import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckInCard } from './CheckInCard';

const OPTIONS = [
  { id: 'yes', label: "Yes, that's all I ate", consequence: 'Marks yesterday complete. Counts toward maintenance and timing.' },
  {
    id: 'guess',
    label: 'I had dinner. Fill in a typical one (~650)',
    consequence: "Adds ~650 kcal to this week's budget, marked as a guess. Left out of maintenance and timing insights.",
  },
];

function Harness({ onDone }: { onDone: (id: string | undefined) => void }) {
  const [selected, setSelected] = useState<string | undefined>();
  const consequence = OPTIONS.find((o) => o.id === selected)?.consequence ?? 'Pick an answer to see what it means for your budget.';
  return (
    <CheckInCard
      title="Yesterday · 2 meals · 1,240 kcal"
      timeline={<div>timeline</div>}
      explanation="Nothing logged for 10 hours after 3:40pm. You usually have dinner around 9pm."
      options={OPTIONS}
      selectedId={selected}
      onSelect={setSelected}
      consequence={consequence}
      onDone={() => onDone(selected)}
    />
  );
}

describe('CheckInCard', () => {
  it('confirms with Done only after an answer and updates the consequence line', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    expect(screen.getByRole('heading', { name: 'Yesterday · 2 meals · 1,240 kcal' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Was that everything?' })).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toHaveAttribute('aria-disabled', 'true');
    await user.click(done);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText('Pick an answer to see what it means for your budget.')).toHaveFocus();

    await user.click(screen.getByRole('radio', { name: /Fill in a typical one/ }));
    expect(screen.getByText(/Adds ~650 kcal to this week's budget/)).toBeInTheDocument();
    expect(done).toHaveAttribute('aria-disabled', 'false');
    await user.click(done);
    expect(onDone).toHaveBeenCalledWith('guess');
  });

  it('light variant asks "All there?" with Yes and Add more', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onAddMore = vi.fn();
    render(<CheckInCard variant="light" title="Yesterday: 3 meals, 1,760 kcal. All there?" onDone={onDone} onAddMore={onAddMore} />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add more' }));
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onAddMore).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
