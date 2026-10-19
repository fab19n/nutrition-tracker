import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroCard, heroWidthEm, type HeroCardProps } from './HeroCard';

const base: HeroCardProps = {
  label: 'Left today',
  value: '570',
  savedLabel: '+650',
  leftWeekLabel: '4,820',
  bars: {
    bars: [{ label: 'F', kind: 'today', valueKcal: 1800, fillKcal: 1230 }],
    targetKcal: 1800,
    height: 64,
    ariaLabel: 'This week',
  },
  captionLeft: '1,230 eaten · window closes 10:40pm',
  captionRight: 'Sat: 2,450 room',
  onPress: () => {},
  ariaLabel: '570 kcal left today. Open the budget breakdown.',
};

describe('HeroCard', () => {
  it('opens the breakdown from a click or the keyboard', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(<HeroCard {...base} onPress={onPress} />);
    const card = screen.getByRole('button', { name: '570 kcal left today. Open the budget breakdown.' });
    await user.click(card);
    card.focus();
    await user.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('shows the over note only when given', () => {
    const { rerender } = render(<HeroCard {...base} />);
    expect(screen.queryByText('Covered by your +650 saved')).toBeNull();
    rerender(<HeroCard {...base} label="Over today" value="+310" valueTone="over" note="Covered by your +650 saved" />);
    expect(screen.getByText('Covered by your +650 saved')).toBeInTheDocument();
    expect(screen.getByText('+310')).toBeInTheDocument();
  });

  it('has a near state with an amber figure and note', () => {
    render(<HeroCard {...base} value="150" valueTone="near" note="Close to today's budget" />);
    expect(screen.getByText('150').className).toContain('toneOver');
    expect(screen.getByText("Close to today's budget").className).toContain('toneOver');
  });

  it('keeps a quiet note muted when asked', () => {
    render(<HeroCard {...base} note="Logging is optional this week" noteTone="muted" />);
    expect(screen.getByText('Logging is optional this week')).toHaveClass('muted');
  });

  it('counts separators as narrow when fitting the figure', () => {
    // 212px column at 390px: "1,800" fits at the full 84px (212 / 2.45em ≈ 86px).
    expect(212 / heroWidthEm('1,800')).toBeGreaterThan(84);
    expect(212 / heroWidthEm('5 of 7')).toBeGreaterThan(84);
    expect(heroWidthEm('12,345,678')).toBeGreaterThan(heroWidthEm('1,800'));
  });
});
