import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlacePicker, type PlaceOption } from './PlacePicker';

const PLACES: PlaceOption[] = [
  { id: 'kedai', name: 'Kedai near home', type: 'economyRice' },
  { id: 'nk', name: 'Nasi kandar near home', type: 'mamak', nearby: true },
  { id: 'home', name: 'Home', type: 'home' },
];

const search = () => screen.getByRole('searchbox', { name: 'Search places' });

describe('PlacePicker', () => {
  it('groups nearby places first and marks the chosen one', () => {
    render(<PlacePicker places={PLACES} selectedId="kedai" onSelect={() => {}} onCreate={() => {}} />);
    const nearby = screen.getByRole('region', { name: 'Nearby' });
    expect(within(nearby).getByRole('button', { name: /Nasi kandar near home/ })).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recent' });
    expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['Kedai near homeEconomy rice', 'HomeHome']);
    expect(screen.getByRole('button', { name: /Kedai near home/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects on tap', async () => {
    const onSelect = vi.fn();
    render(<PlacePicker places={PLACES} onSelect={onSelect} onCreate={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /^Home/ }));
    expect(onSelect).toHaveBeenCalledWith('home');
  });

  it('filters as you type and offers to create a new Place', async () => {
    const onCreate = vi.fn();
    render(<PlacePicker places={PLACES} onSelect={() => {}} onCreate={onCreate} />);
    await userEvent.type(search(), 'near');
    expect(screen.queryByRole('button', { name: /^Home/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kedai near home/ })).toBeInTheDocument();

    await userEvent.clear(search());
    await userEvent.type(search(), '  Medan   selera nearby ');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Create 'Medan selera nearby'" }));
    expect(onCreate).toHaveBeenCalledWith('Medan selera nearby');
  });

  it('does not offer create when the name already exists (any case)', async () => {
    render(<PlacePicker places={PLACES} onSelect={() => {}} onCreate={() => {}} />);
    await userEvent.type(search(), 'HOME');
    expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeInTheDocument();
  });

  it('Enter picks the exact or only match, creates when nothing matches, and waits when ambiguous', async () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    render(<PlacePicker places={PLACES} onSelect={onSelect} onCreate={onCreate} />);
    await userEvent.type(search(), 'kandar{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('nk');

    await userEvent.clear(search());
    await userEvent.type(search(), 'home{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('home');

    await userEvent.clear(search());
    await userEvent.type(search(), 'Kopitiam Sri{Enter}');
    expect(onCreate).toHaveBeenCalledWith('Kopitiam Sri');

    onSelect.mockClear();
    onCreate.mockClear();
    await userEvent.clear(search());
    await userEvent.type(search(), 'near h{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('can start from a typed name', () => {
    render(<PlacePicker places={PLACES} onSelect={() => {}} onCreate={() => {}} initialQuery="Medan selera nearby" />);
    expect(search()).toHaveValue('Medan selera nearby');
    expect(screen.getByRole('button', { name: "Create 'Medan selera nearby'" })).toBeInTheDocument();
  });

  it('offers "No place" when it can be cleared', async () => {
    const onClear = vi.fn();
    render(<PlacePicker places={PLACES} selectedId="nk" onSelect={() => {}} onCreate={() => {}} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'No place' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('explains the empty state', () => {
    render(<PlacePicker places={[]} onSelect={() => {}} onCreate={() => {}} />);
    expect(screen.getByText('No places yet. Type a name to add one.')).toBeInTheDocument();
  });
});
