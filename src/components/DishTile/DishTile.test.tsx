import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DishTile, nextDishCount, type DishCount } from './DishTile';

function Harness({ initial = 0, often }: { initial?: DishCount; often?: boolean }) {
  const [count, setCount] = useState<DishCount>(initial);
  return <DishTile name="Ayam masak merah" kcalLabel="~250" unit="a piece" count={count} often={often} onTap={() => setCount(nextDishCount)} />;
}

describe('nextDishCount', () => {
  it('cycles 0 → 1 → 2 → 0', () => {
    expect(nextDishCount(0)).toBe(1);
    expect(nextDishCount(1)).toBe(2);
    expect(nextDishCount(2)).toBe(0);
  });
});

describe('DishTile', () => {
  it('cycles its count on tap and reflects it in pressed state, badge and label', async () => {
    render(<Harness often />);
    const tile = screen.getByRole('button');
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    expect(tile).toHaveAccessibleName('Ayam masak merah, about 250 kcal a piece, picked often');
    expect(screen.getByText('Picked often')).toBeInTheDocument();

    await userEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(tile).toHaveAccessibleName('Ayam masak merah, about 250 kcal a piece, 1 on your plate');
    expect(screen.getByText('×1')).toBeInTheDocument();
    expect(screen.queryByText('Picked often')).not.toBeInTheDocument();

    await userEvent.click(tile);
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(tile).toHaveAccessibleName('Ayam masak merah, about 250 kcal a piece, 2 on your plate');

    await userEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('shows the per-unit estimate', () => {
    render(<Harness />);
    expect(screen.getByText('~250 a piece')).toBeInTheDocument();
  });
});
