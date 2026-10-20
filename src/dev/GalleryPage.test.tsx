import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import GalleryPage from './GalleryPage';

describe('GalleryPage (/dev)', () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    delete document.documentElement.dataset.theme;
  });

  it('renders every section without React errors', () => {
    render(<GalleryPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeInTheDocument();
    // Structure (C01–C15)
    expect(screen.getByText('C01 BottomNav / Diary active')).toBeInTheDocument();
    expect(screen.getByText('C07 HeroCard / Over (covered by savings)')).toBeInTheDocument();
    expect(screen.getByText('C15 UnlockProgress / Unlocked')).toBeInTheDocument();
    // Logging (C16–C28)
    expect(screen.getByText('C16 LogInput / Empty (type to see matches)')).toBeInTheDocument();
    expect(screen.getByText('C23 RangeTotal / Review, over and covered by savings')).toBeInTheDocument();
    expect(screen.getByText('C28 ScopePicker / Always at this Place')).toBeInTheDocument();
    // Ledger, status and system (C29–C61)
    expect(screen.getByRole('heading', { level: 2, name: 'Ledger, status and system' })).toBeInTheDocument();
    expect(screen.getByText('C29 MealRow / Today · Late for you')).toBeInTheDocument();
    expect(screen.getByText('C49 CheckInCard / Nothing picked (interactive)')).toBeInTheDocument();
    expect(screen.getByText('C61 SleepTap / Shown')).toBeInTheDocument();
    expect(screen.getByText('SyncStatus / Up to date')).toBeInTheDocument();
    // Suggestions and insights (C40–C43)
    expect(screen.getByRole('heading', { level: 2, name: 'Suggestions and insights' })).toBeInTheDocument();
    expect(screen.getByText('C41 InsightCard / Marked useful')).toBeInTheDocument();
    // Phase 2: Places (C34–C36), Usuals (C37), Pots (C38–C39), Activity (C51–C52)
    for (const name of ['Places', 'Usuals', 'Pots', 'Activity']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText('C34 PlaceCard / Economy rice')).toBeInTheDocument();
    expect(screen.getByText('C36 LearnedDefaultRow / Portion and kuah (Change · Remove)')).toBeInTheDocument();
    expect(screen.getByText('C37 UsualCard / Default (Place, used 6 times)')).toBeInTheDocument();
    expect(screen.getByText('C38 PotCard / Clears today')).toBeInTheDocument();
    expect(screen.getAllByText(/^C39 IngredientRow \//).length).toBeGreaterThan(0);
    expect(screen.getByText('C51 WorkoutForm / Futsal · 60 min · Moderate (~470 kcal this week)')).toBeInTheDocument();
    expect(screen.getByText('C52 OneOffBonus / Empty · today')).toBeInTheDocument();

    expect(consoleError).not.toHaveBeenCalled();
    // Renders every component in one go: about 1 s alone, 10 s+ while the whole suite runs.
  }, 30_000);

  it('shows the sample week from the engine (trend 78.0 kg, 570 left)', () => {
    render(<GalleryPage />);
    const weightTiles = screen.getByText('C09 MetricTile / Neutral without sub · Good · Neutral (Weight)').closest('figure');
    expect(weightTiles).not.toBeNull();
    expect(within(weightTiles as HTMLElement).getByText('78.0 kg')).toBeInTheDocument();
    expect(screen.getAllByText('570').length).toBeGreaterThan(0);
  });

  it('switches the theme on the document', async () => {
    const user = userEvent.setup();
    render(<GalleryPage />);
    expect(document.documentElement.dataset.theme).toBe('light');

    const theme = screen.getByRole('radiogroup', { name: 'Theme' });
    await user.click(within(theme).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
