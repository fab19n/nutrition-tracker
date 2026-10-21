import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MealRow, type MealRowProps } from './MealRow';

const base: MealRowProps = {
  slotLabel: 'Breakfast',
  timeLabel: '10:40am',
  placeName: 'Nasi kandar near home',
  priceLabel: 'RM 4.80',
  name: 'Roti canai + teh tarik',
  kcalLabel: '~560',
  tag: 'lateForYou',
  onPress: () => {},
};

function setup(overrides: Partial<MealRowProps> = {}) {
  const props = { ...base, onPress: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), ...overrides };
  const utils = render(<MealRow {...props} />);
  const main = screen.getByRole('button', { name: /^Breakfast/ });
  const slider = main.parentElement as HTMLElement;
  return { ...utils, props, main, slider };
}

function swipe(el: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: fromX, clientY: 20, button: 0, pointerType: 'touch' });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: (fromX + toX) / 2, clientY: 21, pointerType: 'touch' });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: toX, clientY: 22, pointerType: 'touch' });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: toX, clientY: 22, pointerType: 'touch' });
}

describe('MealRow', () => {
  it('shows the meta line, name, timing tag and kcal', () => {
    setup();
    expect(screen.getByText('Breakfast · 10:40am · Nasi kandar near home · RM 4.80')).toBeInTheDocument();
    expect(screen.getByText('Late for you')).toBeInTheDocument();
    expect(screen.getByText('~560')).toBeInTheDocument();
  });

  it('calls onPress on tap', async () => {
    const { main, props } = setup();
    await userEvent.click(main);
    expect(props.onPress).toHaveBeenCalledTimes(1);
  });

  it('marks guesses and rows waiting to sync', () => {
    setup({ isGuess: true, pending: true, tag: undefined });
    expect(screen.getByText('Guess')).toBeInTheDocument();
    expect(screen.getByText('Waiting to sync')).toBeInTheDocument();
  });

  it('swiping left past half the actions width reveals them and swallows the trailing click', () => {
    const { slider, main, props } = setup();
    swipe(slider, 300, 180);
    expect(slider.style.transform).toBe('translateX(-144px)');
    fireEvent.click(main);
    expect(props.onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toHaveAttribute('tabindex', '0');
  });

  it('a short swipe snaps back closed', () => {
    const { slider } = setup();
    swipe(slider, 300, 260);
    expect(slider.style.transform).toBe('');
  });

  it('vertical movement is left to the page scroll', () => {
    const { slider } = setup();
    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 300, clientY: 20, button: 0, pointerType: 'touch' });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 296, clientY: 80, pointerType: 'touch' });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 200, clientY: 90, pointerType: 'touch' });
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 200, clientY: 90, pointerType: 'touch' });
    expect(slider.style.transform).toBe('');
  });

  it('tapping an open row closes it instead of opening the entry', async () => {
    const { slider, main, props } = setup();
    swipe(slider, 300, 150);
    fireEvent.click(main); // tail of the swipe
    await userEvent.click(main);
    expect(props.onPress).not.toHaveBeenCalled();
    expect(slider.style.transform).toBe('');
  });

  it('keyboard: the overflow button opens the actions, focuses Duplicate, and Escape closes them', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    const more = screen.getByRole('button', { name: 'More actions for Roti canai + teh tarik' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Duplicate' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveFocus();

    await user.click(more);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('has no swipe actions or overflow button without action callbacks', () => {
    render(<MealRow {...base} />);
    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows why a search result matched under the name, as part of the row button', () => {
    render(<MealRow {...base} name="Economy rice" note="Includes Kangkung belacan" tag={undefined} />);
    const main = screen.getByRole('button', { name: /^Breakfast/ });
    const note = screen.getByText('Includes Kangkung belacan');
    expect(main).toContainElement(note);
    expect(main).toHaveTextContent('Economy riceIncludes Kangkung belacan');
    expect(main).toHaveAccessibleName(/Economy rices*Includes Kangkung belacan/);
  });

  it('draws no note element without a note', () => {
    const { rerender } = render(<MealRow {...base} tag={undefined} />);
    const main = screen.getByRole('button', { name: /^Breakfast/ });
    // The text block holds the meta line and the name only.
    const body = main.children[1] as HTMLElement;
    expect(body.children).toHaveLength(2);
    rerender(<MealRow {...base} tag={undefined} note="" />);
    expect(body.children).toHaveLength(2);
    rerender(<MealRow {...base} tag={undefined} note="Includes Teh tarik" />);
    expect(body.children).toHaveLength(3);
    expect(body.children[2]).toHaveTextContent('Includes Teh tarik');
  });

  it('is read-only without onDuplicate and onDelete: no swipe actions and no More actions button', () => {
    render(<MealRow {...base} note="Includes Teh tarik" />);
    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
