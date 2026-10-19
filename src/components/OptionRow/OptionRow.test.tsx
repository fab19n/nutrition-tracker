import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OptionGroup, type OptionItem } from './OptionRow';
import { nextOptionIndex } from './optionKeys';

const OPTIONS: OptionItem[] = [
  { id: 'yes', label: "Yes, that's all I ate" },
  { id: 'guess', label: 'I had dinner. Fill in a typical one (~650)' },
  { id: 'more', label: 'I ate more. Let me add it' },
  { id: 'skip', label: "Don't count this day" },
];

function Harness({ initial }: { initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return <OptionGroup label="Was that everything?" options={OPTIONS} value={value} onChange={setValue} />;
}

describe('nextOptionIndex', () => {
  it('wraps arrows at both ends and handles Home/End', () => {
    expect(nextOptionIndex('ArrowDown', 3, 4)).toBe(0);
    expect(nextOptionIndex('ArrowUp', 0, 4)).toBe(3);
    expect(nextOptionIndex('ArrowRight', 1, 4)).toBe(2);
    expect(nextOptionIndex('Home', 2, 4)).toBe(0);
    expect(nextOptionIndex('End', 0, 4)).toBe(3);
    expect(nextOptionIndex('a', 0, 4)).toBeNull();
    expect(nextOptionIndex('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('OptionGroup', () => {
  it('is a labelled radio group with one tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Was that everything?' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('selects on click and moves the tab stop to the selection', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Fill in a typical one/ }));
    const radios = screen.getAllByRole('radio');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveAttribute('tabindex', '0');
    expect(radios[0]).toHaveAttribute('tabindex', '-1');
  });

  it('arrow keys move focus and select, wrapping around', async () => {
    render(<Harness initial="skip" />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('radio', { name: "Don't count this day" })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    const first = screen.getByRole('radio', { name: "Yes, that's all I ate" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: "Don't count this day" })).toHaveAttribute('aria-checked', 'true');
  });
});
