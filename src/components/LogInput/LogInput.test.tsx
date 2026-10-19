import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogInput, type LogInputProps } from './LogInput';

type HarnessProps = Partial<Pick<LogInputProps, 'onSubmit' | 'sending' | 'offline'>> & { initial?: string };

function Harness({ initial = '', onSubmit = () => {}, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return <LogInput value={value} onChange={setValue} onSubmit={onSubmit} hint="Type it like a message" {...rest} />;
}

const box = () => screen.getByRole('textbox', { name: 'What did you eat?' });

describe('LogInput', () => {
  it('shows the example placeholder and a disabled Estimate while empty', () => {
    render(<Harness />);
    expect(box()).toHaveAttribute('placeholder', 'nasi lemak ayam goreng, teh o ais');
    expect(screen.getByRole('button', { name: 'Estimate' })).toBeDisabled();
  });

  it('submits the trimmed text on Enter', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(box(), '  nasi lemak, teh o ais  {Enter}');
    expect(onSubmit).toHaveBeenCalledWith('nasi lemak, teh o ais');
  });

  it('adds a new line on Shift+Enter instead of submitting', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(box(), 'roti canai{Shift>}{Enter}{/Shift}teh tarik');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box()).toHaveValue('roti canai\nteh tarik');
  });

  it('does not submit blank text', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(box(), '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enables Estimate once there is text and submits on click', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(box(), 'teh o ais');
    const send = screen.getByRole('button', { name: 'Estimate' });
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith('teh o ais');
  });

  it('locks while sending', async () => {
    const onSubmit = vi.fn();
    render(<Harness initial="teh o ais" sending onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: 'Estimating…' })).toBeDisabled();
    await userEvent.type(box(), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the camera button only when it has a handler', async () => {
    const onCamera = vi.fn();
    const { rerender } = render(<LogInput value="" onChange={() => {}} onSubmit={() => {}} hint="h" />);
    expect(screen.queryByRole('button', { name: 'Add a photo' })).not.toBeInTheDocument();
    rerender(<LogInput value="" onChange={() => {}} onSubmit={() => {}} hint="h" onCamera={onCamera} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a photo' }));
    expect(onCamera).toHaveBeenCalledOnce();
  });

  it('describes the box with the hint, marked offline when offline', () => {
    render(<LogInput value="" onChange={() => {}} onSubmit={() => {}} hint="Estimate will run when you're back online" offline />);
    expect(box()).toHaveAccessibleDescription("Offline. Estimate will run when you're back online");
  });
});
