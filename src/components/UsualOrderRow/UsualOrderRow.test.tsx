import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsualOrderList, UsualOrderRow } from './UsualOrderRow';

describe('UsualOrderRow', () => {
  it('logs with one tap, then shows Logged today and still offers Log again', async () => {
    const user = userEvent.setup();
    const onLog = vi.fn();
    const { rerender } = render(
      <UsualOrderList label="Your usual orders">
        <UsualOrderRow name="Nasi kandar ayam goreng" detail="Kuah campur · 9 times · ~950 kcal" onLog={onLog} />
      </UsualOrderList>,
    );
    const list = screen.getByRole('list', { name: 'Your usual orders' });
    expect(within(list).getByText('Kuah campur · 9 times · ~950 kcal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log Nasi kandar ayam goreng' }));
    expect(onLog).toHaveBeenCalledTimes(1);

    rerender(
      <UsualOrderList label="Your usual orders">
        <UsualOrderRow name="Nasi kandar ayam goreng" detail="Kuah campur · 9 times · ~950 kcal" logged onLog={onLog} />
      </UsualOrderList>,
    );
    expect(screen.getByText('Logged today')).toBeInTheDocument();
    // Not a dead end: a second one the same day is one tap away.
    const again = screen.getByRole('button', { name: 'Log Nasi kandar ayam goreng again' });
    expect(again).toHaveTextContent('Log again');
    await user.click(again);
    expect(onLog).toHaveBeenCalledTimes(2);
  });

  it('takes a custom label and waits while busy', () => {
    render(
      <UsualOrderList>
        <UsualOrderRow name="Kari ayam pot" detail="3 of 8 left · ~500 a serving" logLabel="Log 1" actionLabel="Log 1 serving of Kari ayam" busy onLog={() => {}} />
      </UsualOrderList>,
    );
    const button = screen.getByRole('button', { name: 'Log 1 serving of Kari ayam' });
    expect(button).toHaveTextContent('Log 1');
    expect(button).toBeDisabled();
  });
});
