import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DishCheckRow, type DishCheckRowProps } from './DishCheckRow';

function renderRow(props: Partial<DishCheckRowProps> = {}) {
  const onAnswer = vi.fn();
  const onUndo = vi.fn();
  render(
    <ul>
      <DishCheckRow name="Rice (economy rice)" kcalLabel="~200" source="catalogue" detail="1 scoop · 25 times" onAnswer={onAnswer} onUndo={onUndo} {...props} />
    </ul>,
  );
  return { onAnswer, onUndo, user: userEvent.setup() };
}

const chips = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));

describe('DishCheckRow', () => {
  it('shows the dish, the number, its source and the detail', () => {
    renderRow();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(screen.getByText('Rice (economy rice)')).toBeInTheDocument();
    expect(screen.getByText('~200')).toBeInTheDocument();
    expect(screen.getByText('Catalogue')).toBeInTheDocument();
    expect(screen.getByText('1 scoop · 25 times')).toBeInTheDocument();
  });

  it('unanswered: three unpressed chips in a named group', () => {
    renderRow();
    const group = screen.getByRole('group', { name: 'Rice (economy rice): is ~200 kcal right?' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Looks right', 'Usually more', 'Usually less']);
    expect(chips().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
    expect(chips().every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it.each([
    ['Looks right', 'right'],
    ['Usually more', 'more'],
    ['Usually less', 'less'],
  ] as const)('%s calls onAnswer with %s', async (label, answer) => {
    const { onAnswer, user } = renderRow();
    await user.click(screen.getByRole('button', { name: label }));
    expect(onAnswer).toHaveBeenCalledWith(answer);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('answered: the chosen chip is pressed, the others are disabled, and the result and Undo show', async () => {
    const { onAnswer, onUndo, user } = renderRow({
      answer: 'more',
      resultLine: 'Usually more. Now ~250 kcal (was ~200).',
    });
    expect(screen.getByRole('button', { name: 'Usually more' })).toHaveAttribute('aria-pressed', 'true');
    expect(chips().map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, true, true]);
    await user.click(screen.getByRole('button', { name: 'Looks right' }));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByText('Usually more. Now ~250 kcal (was ~200).')).toHaveAttribute('aria-live', 'polite');
    await user.click(screen.getByRole('button', { name: 'Undo answer for Rice (economy rice)' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('answered without an undo (the screen was reopened): the result stays, no Undo', () => {
    renderRow({ answer: 'right', resultLine: 'Looks right. No change.', onUndo: undefined });
    expect(screen.getByText('Looks right. No change.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Looks right' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('busy: the answers wait, none pressed', () => {
    renderRow({ busy: true });
    expect(chips().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(chips().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('a Place default says so in words, and names the Place for screen readers', () => {
    renderRow({ source: 'placeDefault', placeName: 'Nasi kandar near home', kcalLabel: '~430', detail: 'Mamak big · Nasi kandar near home · 8 times' });
    expect(screen.getByText(/Place default/)).toBeInTheDocument();
    expect(screen.getByText('at Nasi kandar near home', { exact: false })).toHaveClass('sr-only');
    expect(screen.getByText('Mamak big · Nasi kandar near home · 8 times')).toBeInTheDocument();
    expect(screen.queryByText('Catalogue')).toBeNull();
  });

  it('an AI guess shows AI guess', () => {
    renderRow({ source: 'aiGuess', kcalLabel: '~90', name: 'Sup sayur', detail: '1 portion · 5 times' });
    expect(screen.getByText('AI guess')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sup sayur: is ~90 kcal right?' })).toBeInTheDocument();
  });

  it('shows your correction and the catalogue’s own labels', () => {
    const { rerender } = render(
      <ul>
        <DishCheckRow name="A" kcalLabel="~1" source="yourCorrection" detail="x" onAnswer={() => {}} />
      </ul>,
    );
    expect(screen.getByText('Your correction')).toBeInTheDocument();
    rerender(
      <ul>
        <DishCheckRow name="A" kcalLabel="~1" source="myfcd" detail="x" onAnswer={() => {}} />
      </ul>,
    );
    expect(screen.getByText('MyFCD')).toBeInTheDocument();
  });
});
