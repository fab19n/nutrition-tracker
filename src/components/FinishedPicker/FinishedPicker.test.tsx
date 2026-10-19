import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Finished } from '@/domain/types';
import { FinishedPicker } from './FinishedPicker';

function Harness({ onChange }: { onChange?: (f: Finished) => void }) {
  const [value, setValue] = useState<Finished>('all');
  return (
    <FinishedPicker
      value={value}
      onChange={(f) => {
        setValue(f);
        onChange?.(f);
      }}
    />
  );
}

describe('FinishedPicker', () => {
  it('starts collapsed with the question', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Finished it all?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'How much did you finish?' })).not.toBeInTheDocument();
  });

  it('expands to All / Most / Half, then collapses showing the choice', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Finished it all?' }));
    expect(screen.getByRole('button', { name: 'Finished it all?' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Half' }));
    expect(onChange).toHaveBeenCalledWith('half');
    const toggle = screen.getByRole('button', { name: 'Ate about half' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Half' })).not.toBeInTheDocument();
  });

  it('can start expanded', () => {
    render(<FinishedPicker value="most" onChange={() => {}} defaultExpanded />);
    expect(screen.getByRole('button', { name: 'Ate most of it' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Most' })).toHaveAttribute('aria-pressed', 'true');
  });
});
