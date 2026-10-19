import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestionCard, SurpriseCard } from './SuggestionCard';

const card = {
  role: 'usual' as const,
  name: 'Ayam bakar, half rice, ulam',
  reason: 'You had this 6 times this month',
  kcalLabel: '~540 kcal',
  proteinLabel: '38g protein',
  placeName: 'Medan selera nearby',
};

describe('SuggestionCard', () => {
  it('shows role, fit, dish, reason and numbers, and logs', async () => {
    const onLog = vi.fn();
    render(<SuggestionCard {...card} fit="fits" onLog={onLog} />);
    expect(screen.getByText('Your usual')).toBeInTheDocument();
    expect(screen.getByText('Fits')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: card.name })).toBeInTheDocument();
    expect(screen.getByText('~540 kcal')).toBeInTheDocument();
    expect(screen.getByText(/38g protein · Medan selera nearby/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `Log this: ${card.name}` }));
    expect(onLog).toHaveBeenCalledOnce();
  });

  it('labels a tight fit and the logged state', () => {
    render(<SuggestionCard {...card} role="lighterSwap" fit="tightFit" logged onLog={() => {}} />);
    expect(screen.getByText('Lighter swap')).toBeInTheDocument();
    expect(screen.getByText('Tight fit')).toBeInTheDocument();
    expect(screen.getByText('Logged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log this/ })).not.toBeInTheDocument();
  });

  it('has a Surprise me button', async () => {
    const onPress = vi.fn();
    render(<SurpriseCard onPress={onPress} />);
    await userEvent.click(screen.getByRole('button', { name: 'Surprise me' }));
    expect(onPress).toHaveBeenCalledOnce();
  });
});
