import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemSearch, type ItemSearchResult } from './ItemSearch';

const LIBRARY: ItemSearchResult[] = [
  { id: 'teh-tarik', name: 'Teh tarik', detail: 'Catalogue', kcalLabel: '~200' },
  { id: 'teh-o-ais', name: 'Teh o ais', detail: 'your correction', kcalLabel: '~60' },
];

function Harness({ onPick = () => {}, onCustom }: { onPick?: (id: string) => void; onCustom?: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const results = LIBRARY.filter((r) => r.name.toLowerCase().includes(q));
  return <ItemSearch query={query} onQuery={setQuery} results={results} onPick={onPick} onCustom={onCustom} />;
}

const box = () => screen.getByRole('searchbox', { name: 'Search food' });

describe('ItemSearch', () => {
  it('lists results with their estimates and picks one on tap', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    expect(screen.getByRole('list', { name: 'Results' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Teh o ais/ }));
    expect(onPick).toHaveBeenCalledWith('teh-o-ais');
  });

  it('Enter picks the top result', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await userEvent.type(box(), 'teh{Enter}');
    expect(onPick).toHaveBeenCalledWith('teh-tarik');
  });

  it('offers to add the typed text, and Enter adds it when nothing matches', async () => {
    const onPick = vi.fn();
    const onCustom = vi.fn();
    render(<Harness onPick={onPick} onCustom={onCustom} />);
    await userEvent.type(box(), 'roti tisu');
    expect(screen.getByText('No matches in your library')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add 'roti tisu'/ })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onCustom).toHaveBeenCalledWith('roti tisu');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('hides the add row when the typed name is already in the library', async () => {
    render(<Harness onCustom={() => {}} />);
    await userEvent.type(box(), 'Teh tarik');
    expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();
  });

  it('has no add row without onCustom', async () => {
    render(<Harness />);
    await userEvent.type(box(), 'roti tisu{Enter}');
    expect(screen.queryByRole('button', { name: /Add 'roti tisu'/ })).not.toBeInTheDocument();
  });

  it('clears the search', async () => {
    render(<Harness />);
    await userEvent.type(box(), 'teh');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
  });
});
