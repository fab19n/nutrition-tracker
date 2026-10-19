import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InsightCard } from './InsightCard';

const base = {
  headline: 'Drinks were 17% of your calories',
  evidence: 'Teh tarik 8 times, milo ais 3 times, ~2,170 kcal.',
  linkLabel: 'See 11 drinks',
  tryText: 'kurang manis for half of them, about 240 kcal a week less',
  meta: 'Based on 7 days',
};

describe('InsightCard', () => {
  it('shows the fact, evidence link, Try box and footer', async () => {
    const onLink = vi.fn();
    const onUseful = vi.fn();
    const onNotForMe = vi.fn();
    render(<InsightCard {...base} onLink={onLink} onUseful={onUseful} onNotForMe={onNotForMe} />);
    expect(screen.getByRole('heading', { name: base.headline })).toBeInTheDocument();
    expect(screen.getByText(/Teh tarik 8 times/)).toBeInTheDocument();
    expect(screen.getByText('Try:')).toBeInTheDocument();
    expect(screen.getByText('Based on 7 days')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See 11 drinks' }));
    await userEvent.click(screen.getByRole('button', { name: 'Useful' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not for me' }));
    expect(onLink).toHaveBeenCalledOnce();
    expect(onUseful).toHaveBeenCalledOnce();
    expect(onNotForMe).toHaveBeenCalledOnce();
  });

  it('marks useful with a pressed pill', () => {
    render(<InsightCard {...base} useful onUseful={() => {}} onNotForMe={() => {}} />);
    expect(screen.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('collapses with undo when dismissed', async () => {
    const onUndo = vi.fn();
    render(<InsightCard {...base} dismissed onUndo={onUndo} />);
    expect(screen.getByText('Paused for 4 weeks')).toBeInTheDocument();
    expect(screen.queryByText('Try:')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('drops the buttons without a footer (weekly review)', () => {
    render(<InsightCard {...base} footer={false} meta={undefined} />);
    expect(screen.queryByRole('button', { name: 'Useful' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See 11 drinks' })).not.toBeInTheDocument();
  });
});
