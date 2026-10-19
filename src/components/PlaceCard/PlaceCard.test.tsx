import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaceCard, PlaceTypePill, placeTypeLabel } from './PlaceCard';

describe('PlaceCard', () => {
  it('shows name, type, visits, average, elsewhere and spend as one button', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <PlaceCard
        name="Nasi kandar near home"
        type="mamak"
        visitsLabel="14 visits"
        avgLabel="~920"
        elsewhereLabel="~640"
        spendLabel="RM 58.00 this week"
        onPress={onPress}
      />,
    );
    const card = screen.getByRole('button', { name: /^Nasi kandar near home/ });
    expect(card).toHaveTextContent('Mamak');
    expect(card).toHaveTextContent('14 visits');
    expect(card).toHaveTextContent('RM 58.00 this week');
    expect(card).toHaveTextContent('~920 kcal a meal');
    expect(card).toHaveTextContent('vs ~640 elsewhere');
    expect(screen.queryByText('Learning')).not.toBeInTheDocument();
    await user.click(card);
    card.focus();
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('marks a Place still learning and leaves out numbers it has none for', () => {
    render(<PlaceCard name="Medan selera nearby" type="hawker" visitsLabel="No visits" learning onPress={() => {}} />);
    expect(screen.getByText('Learning')).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toHaveTextContent('kcal');
    expect(screen.getByRole('button')).not.toHaveTextContent('elsewhere');
  });
});

describe('PlaceTypePill', () => {
  it('names every type in words', () => {
    expect(['mamak', 'economyRice', 'kopitiam', 'hawker', 'home', 'other'].map((t) => placeTypeLabel(t as never))).toEqual([
      'Mamak',
      'Economy rice',
      'Kopitiam',
      'Hawker',
      'Home',
      'Other',
    ]);
    render(<PlaceTypePill type="economyRice" />);
    expect(screen.getByText('Economy rice')).toBeInTheDocument();
  });
});
