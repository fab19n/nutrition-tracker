import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LearnedDefaultList, LearnedDefaultRow } from './LearnedDefaultRow';

describe('LearnedDefaultRow', () => {
  it('shows what it learned with labelled Change and Remove', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onRemove = vi.fn();
    render(
      <LearnedDefaultList label="What you've taught it">
        <LearnedDefaultRow label="Rice (nasi kandar)" value="Mamak big, +30%" onChange={onChange} onRemove={onRemove} />
      </LearnedDefaultList>,
    );
    expect(screen.getByRole('list', { name: "What you've taught it" })).toBeInTheDocument();
    expect(screen.getByText('Mamak big, +30%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change Rice (nasi kandar)' }));
    await user.click(screen.getByRole('button', { name: 'Remove Rice (nasi kandar)' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('has no Change without chips to pick from', () => {
    render(
      <LearnedDefaultList>
        <LearnedDefaultRow label="Kari ayam, home style" value="Your version · ~420" onRemove={() => {}} />
      </LearnedDefaultList>,
    );
    expect(screen.queryByRole('button', { name: /^Change/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Kari ayam, home style' })).toBeInTheDocument();
  });
});
