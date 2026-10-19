import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PotCard, meterCells, servingsLeftText, servingsText, type PotCardProps } from './PotCard';

const BASE: PotCardProps = {
  name: 'Kari ayam',
  servings: 8,
  servingsLeft: 3,
  kcalPerServing: 503.75,
  state: 'active',
  clearsText: 'Clears Sunday',
};

describe('servings text', () => {
  it('writes whole and half servings', () => {
    expect(servingsText(3)).toBe('3');
    expect(servingsText(2.5)).toBe('2½');
    expect(servingsText(0.5)).toBe('½');
    expect(servingsText(0)).toBe('0');
    expect(servingsText(-1)).toBe('0');
    expect(servingsLeftText(3, 8)).toBe('3 of 8 servings left');
    expect(servingsLeftText(2.5, 8)).toBe('2½ of 8 servings left');
  });
});

describe('meterCells', () => {
  it('has one cell per serving, the ones left first', () => {
    expect(meterCells(3, 8)).toEqual(['full', 'full', 'full', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(meterCells(2.5, 4)).toEqual(['full', 'full', 'half', 'empty']);
    expect(meterCells(0, 3)).toEqual(['empty', 'empty', 'empty']);
    expect(meterCells(9, 3)).toEqual(['full', 'full', 'full']);
    expect(meterCells(1, 0)).toEqual([]);
  });

  it('keeps big pots to 12 cells, in proportion', () => {
    const cells = meterCells(12, 24);
    expect(cells).toHaveLength(12);
    expect(cells.filter((c) => c === 'full')).toHaveLength(6);
  });
});

describe('PotCard (C38)', () => {
  it('shows servings left, ~kcal a serving and when it clears', () => {
    render(<PotCard {...BASE} onLog={() => {}} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Kari ayam' })).toBeInTheDocument();
    expect(screen.getByText('3 of 8 servings left')).toBeInTheDocument();
    expect(screen.getByText('~500 kcal')).toBeInTheDocument();
    expect(screen.getByText('Clears Sunday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log 1 serving of Kari ayam' })).toBeEnabled();
  });

  it('logs and opens with separate targets', async () => {
    const user = userEvent.setup();
    const onLog = vi.fn();
    const onOpen = vi.fn();
    render(<PotCard {...BASE} onLog={onLog} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Log 1 serving of Kari ayam' }));
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Kari ayam' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('waits while a serving saves', () => {
    render(<PotCard {...BASE} onLog={() => {}} busy />);
    expect(screen.getByRole('button', { name: /^Log 1 serving/ })).toBeDisabled();
  });

  it('offers the last half serving as ½', () => {
    render(<PotCard {...BASE} servingsLeft={0.5} state="clearsToday" clearsText="Clears today" onLog={() => {}} />);
    expect(screen.getByText('½ of 8 servings left')).toBeInTheDocument();
    expect(screen.getByText('Clears today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log ½ serving of Kari ayam' })).toBeEnabled();
  });

  it('hides Log once the pot has cleared', () => {
    render(<PotCard {...BASE} servingsLeft={0} state="cleared" clearsText="Cleared" onLog={() => {}} />);
    expect(screen.getByText('Cleared')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Log/ })).not.toBeInTheDocument();
  });

  it('renders the name as plain text when it does not open', () => {
    render(<PotCard {...BASE} headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Kari ayam' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
