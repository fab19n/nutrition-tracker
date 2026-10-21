import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { getWeightTrend } from '@/db/selectors';
import { fmtKg } from '@/domain/format';
import { resetUiState, useUiStore } from '@/state/ui';
import WeightScreen from './WeightScreen';

const SLOW = { timeout: 4000 };

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
    </div>
  );
}

function renderWeight() {
  const router = createMemoryRouter(
    [
      { path: '/more', element: <Probe name="More" /> },
      { path: '/more/weight', element: <WeightScreen /> },
    ],
    { initialEntries: ['/more/weight'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** A MetricTile by its label. */
function tile(label: string): HTMLElement {
  const found = screen
    .getAllByText(label)
    .map((el) => el.parentElement)
    .find((el): el is HTMLElement => el instanceof HTMLElement && el.className.includes('_tile_'));
  if (!found) throw new Error(`No tile ${label}`);
  return found;
}

function weighInRows(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /^Delete weigh-in/ }).map((b) => b.closest('li') as HTMLElement);
}

beforeEach(async () => {
  resetUiState();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  await resetAll();
});

describe('WeightScreen (S16)', () => {
  it('plans by the pace of the target in force', async () => {
    const cut = (await db.goalVersions.get(DEMO_IDS.goalVersions.cut))!;
    await db.goalVersions.put({ ...cut, id: 'version-slower', effectiveFrom: '2026-10-16', dailyKcal: 1825, paceKgPerWeek: 0.25, reason: 'approvedSuggestion', createdAt: '2026-10-15T11:00:00.000Z' });
    renderWeight();
    await screen.findByText('77.8', { exact: false, selector: 'output' }, SLOW);
    await waitFor(() => expect(tile('Plan')).toHaveTextContent('Plan−0.25kg a week'));
  });

  it('pre-fills the latest weigh-in and shows the trend, tiles and recent weigh-ins', async () => {
    renderWeight();

    expect(screen.getByRole('heading', { level: 1, name: 'Weight' })).toBeInTheDocument();
    expect(await screen.findByText('77.8', { exact: false, selector: 'output' }, SLOW)).toHaveTextContent('77.8 kg');
    // The demo clock reads 7:10pm.
    expect(screen.getByText('Today')).toBeInTheDocument();

    const chart = await screen.findByRole('img', { name: /^Trend 78\.0 kg, down 0\.4 kg this week\. 14 weigh-ins from Sat 3 Oct to Fri 16 Oct\.$/ }, SLOW);
    expect(within(chart).getByText(/jump: salt and water$/)).toBeInTheDocument();
    expect(screen.getByText('3 Oct')).toBeInTheDocument();
    expect(screen.getByText('today')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '14d' })).toHaveAttribute('aria-checked', 'true');

    expect(tile('Trend')).toHaveTextContent('Trend78.0 kg');
    expect(tile('This week')).toHaveTextContent('This week−0.4 kg');
    expect(within(tile('This week')).getByText('−0.4 kg').className).toMatch(/_good_/);
    expect(tile('Plan')).toHaveTextContent('Plan−0.5kg a week');

    expect(screen.getByRole('heading', { level: 2, name: 'Recent weigh-ins' })).toBeInTheDocument();
    expect(weighInRows()).toHaveLength(7);
    expect(within(weighInRows()[0] as HTMLElement).getByText('Fri 16 Oct')).toBeInTheDocument();
    expect(within(weighInRows()[0] as HTMLElement).getByText('8:05am')).toBeInTheDocument();
  });

  it('saves a weigh-in and shows the trend after saving', async () => {
    const user = userEvent.setup();
    renderWeight();
    await screen.findByText('77.8', { exact: false, selector: 'output' }, SLOW);

    await user.click(screen.getByRole('button', { name: 'Backspace' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    expect(screen.getByText('77.5', { exact: false, selector: 'output' })).toHaveTextContent('77.5 kg');
    await user.click(screen.getByRole('button', { name: 'Save weigh-in' }));

    await expect.poll(() => db.weights.count()).toBe(15);
    const trend = await getWeightTrend(db);
    const label = `Saved · trend ${fmtKg(trend.latest?.trendKg ?? 0)}`;
    expect(await screen.findByText(label, {}, SLOW)).toBeInTheDocument();
    expect(label).toBe('Saved · trend 77.9 kg');

    // The next key starts a fresh entry.
    await user.click(screen.getByRole('button', { name: '7' }));
    expect(screen.getByText('7', { exact: false, selector: 'output' })).toHaveTextContent(/^7 kg$/);
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save weigh-in' })).toBeEnabled();
  });

  it('saves one weigh-in on a double tap', async () => {
    renderWeight();
    await screen.findByText('77.8', { exact: false, selector: 'output' }, SLOW);
    const save = screen.getByRole('button', { name: 'Save weigh-in' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(await screen.findByText(/^Saved · trend /, {}, SLOW)).toBeInTheDocument();
    expect(await db.weights.count()).toBe(15);
  });

  it('switches the range and keeps older weigh-ins out of 14 days', async () => {
    const user = userEvent.setup();
    await db.weights.put({ id: 'weight-2026-09-26', measuredAt: '2026-09-26T00:05:00.000Z', logicalDay: '2026-09-26', kg: 78.9 });
    renderWeight();

    expect(await screen.findByRole('img', { name: /14 weigh-ins from Sat 3 Oct/ }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('3 Oct')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '30d' }));
    expect(screen.getByRole('img', { name: /15 weigh-ins from Sat 26 Sep/ })).toBeInTheDocument();
    expect(screen.getByText('26 Sep')).toBeInTheDocument();
  });

  it('deletes a weigh-in with undo and lists them all on request', async () => {
    const user = userEvent.setup();
    renderWeight();
    await screen.findByRole('heading', { level: 2, name: 'Recent weigh-ins' }, SLOW);

    await user.click(screen.getByRole('button', { name: 'Show all 14' }));
    expect(weighInRows()).toHaveLength(14);

    await user.click(screen.getByRole('button', { name: 'Delete weigh-in, Sat 3 Oct, 78.6 kg' }));
    await expect.poll(() => db.weights.count()).toBe(13);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Weigh-in deleted');
    expect(await screen.findByRole('button', { name: 'Show fewer' }, SLOW)).toBeInTheDocument();
    await expect.poll(() => weighInRows().length).toBe(13);

    toast?.undo?.();
    await expect.poll(() => db.weights.count()).toBe(14);
    expect(await screen.findByRole('button', { name: 'Delete weigh-in, Sat 3 Oct, 78.6 kg' }, SLOW)).toBeInTheDocument();
  });

  it('starts empty before the first weigh-in', async () => {
    await db.weights.clear();
    renderWeight();

    expect(await screen.findByText('Your trend appears after a few weigh-ins', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText(/One reading a morning is plenty/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save weigh-in' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Recent weigh-ins' })).not.toBeInTheDocument();
  });

  it('goes back to More', async () => {
    const user = userEvent.setup();
    const router = renderWeight();
    await user.click(screen.getByRole('button', { name: 'Back to More' }));
    expect(router.state.location.pathname).toBe('/more');
  });
});
