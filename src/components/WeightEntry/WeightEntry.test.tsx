import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeightEntry } from './WeightEntry';
import { applyWeightKey, isSavableWeight, keyFromKeyboard, type WeightKey } from './weightKeypad';

const typeKeys = (start: string, keys: WeightKey[]) => keys.reduce((v, k) => applyWeightKey(v, k), start);

describe('applyWeightKey', () => {
  it('builds a weight to one decimal', () => {
    expect(typeKeys('', ['7', '7', '.', '8'])).toBe('77.8');
  });

  it('ignores a second decimal and a second decimal point', () => {
    expect(typeKeys('77.8', ['5'])).toBe('77.8');
    expect(typeKeys('77', ['.', '.'])).toBe('77.');
  });

  it('allows at most three digits before the point', () => {
    expect(typeKeys('', ['1', '2', '3', '4'])).toBe('123');
    expect(typeKeys('123', ['.', '4'])).toBe('123.4');
  });

  it('starts a leading point as "0." and drops leading zeros', () => {
    expect(applyWeightKey('', '.')).toBe('0.');
    expect(applyWeightKey('0', '7')).toBe('7');
  });

  it('backspace removes the last character', () => {
    expect(applyWeightKey('77.8', 'backspace')).toBe('77.');
    expect(applyWeightKey('', 'backspace')).toBe('');
  });

  it('after a save the next key starts fresh', () => {
    expect(applyWeightKey('77.8', '7', true)).toBe('7');
    expect(applyWeightKey('77.8', '.', true)).toBe('0.');
    expect(applyWeightKey('77.8', 'backspace', true)).toBe('');
  });
});

describe('isSavableWeight / keyFromKeyboard', () => {
  it('only accepts complete positive values', () => {
    expect(isSavableWeight('77.8')).toBe(true);
    expect(isSavableWeight('78')).toBe(true);
    expect(isSavableWeight('77.')).toBe(false);
    expect(isSavableWeight('')).toBe(false);
    expect(isSavableWeight('0')).toBe(false);
  });

  it('maps physical keys', () => {
    expect(keyFromKeyboard('5')).toBe('5');
    expect(keyFromKeyboard(',')).toBe('.');
    expect(keyFromKeyboard('Backspace')).toBe('backspace');
    expect(keyFromKeyboard('a')).toBeNull();
  });
});

function Harness({ onSave }: { onSave: () => void }) {
  const [value, setValue] = useState('77.8');
  const [saved, setSaved] = useState(false);
  return (
    <WeightEntry
      value={value}
      saved={saved}
      savedLabel="Saved · trend 77.9 kg"
      onChange={(v) => {
        setValue(v);
        setSaved(false);
      }}
      onSave={() => {
        onSave();
        setSaved(true);
      }}
    />
  );
}

describe('WeightEntry', () => {
  it('edits with the pad, saves, then starts fresh on the next key', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const display = screen.getByRole('status', { name: '' });
    expect(display).toHaveTextContent('77.8 kg');

    await user.click(screen.getByRole('button', { name: 'Backspace' }));
    await user.click(screen.getByRole('button', { name: '6' }));
    expect(display).toHaveTextContent('77.6 kg');

    await user.click(screen.getByRole('button', { name: 'Save weigh-in' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Saved · trend 77.9 kg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save weigh-in' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '7' }));
    expect(display).toHaveTextContent('7 kg');
    expect(screen.getByRole('button', { name: 'Save weigh-in' })).toBeEnabled();
  });

  it('disables Save until the value is complete', async () => {
    const user = userEvent.setup();
    render(<Harness onSave={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Backspace' }));
    expect(screen.getByRole('button', { name: 'Save weigh-in' })).toBeDisabled();
  });

  it('accepts physical keyboard input while the pad has focus', async () => {
    const user = userEvent.setup();
    render(<Harness onSave={() => {}} />);
    screen.getByRole('button', { name: '1' }).focus();
    await user.keyboard('{Backspace}{Backspace}{Backspace}9,5');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('79.5 kg');
  });
});
