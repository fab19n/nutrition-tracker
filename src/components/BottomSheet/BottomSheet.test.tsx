import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { BottomSheet, SheetTitle, topLocalSheet } from './BottomSheet';

function Harness({ dismissible, autoFocusInput }: { dismissible?: boolean; autoFocusInput?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} dismissible={dismissible} title="This week's budget">
        <SheetTitle>This week&apos;s budget</SheetTitle>
        {autoFocusInput ? <input aria-label="Bonus" autoFocus /> : null}
        <button type="button">First action</button>
        <button type="button" onClick={() => setOpen(false)}>
          Done
        </button>
      </BottomSheet>
    </>
  );
}

const scrimOf = (dialog: HTMLElement) => dialog.parentElement?.previousElementSibling as HTMLElement;

describe('BottomSheet', () => {
  it('renders nothing while closed', () => {
    render(<BottomSheet open={false} onClose={() => {}} title="Log food">content</BottomSheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders into document.body as a named modal dialog', () => {
    const { container } = render(
      <BottomSheet open onClose={() => {}} title="Log food">
        content
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Log food' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('closes on Escape, scrim tap and the grab handle when dismissible', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Budget">
        content
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(scrimOf(screen.getByRole('dialog')));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('ignores Escape and scrim taps when not dismissible (check-in)', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} dismissible={false} title="Check-in">
        content
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(scrimOf(screen.getByRole('dialog')));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('moves focus into the sheet and returns it to the opener on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps focus on an autoFocus field inside the sheet', async () => {
    const user = userEvent.setup();
    render(<Harness autoFocusInput />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    expect(screen.getByRole('textbox', { name: 'Bonus' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('traps Tab inside the sheet', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const done = screen.getByRole('button', { name: 'Done' });
    done.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(done).toHaveFocus();
  });

  it('is named by its visible SheetTitle, else by the title prop', () => {
    const { unmount } = render(
      <BottomSheet open onClose={() => {}} title="Morning check-in">
        <SheetTitle>Yesterday · 2 meals · 1,240 kcal</SheetTitle>
      </BottomSheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Yesterday · 2 meals · 1,240 kcal' })).toBeInTheDocument();
    unmount();
    render(<BottomSheet open onClose={() => {}} title="Log food">content</BottomSheet>);
    expect(screen.getByRole('dialog', { name: 'Log food' })).toBeInTheDocument();
  });

  it('leaves Tab to a ConfirmDialog opened over it', async () => {
    const user = userEvent.setup();
    render(
      <BottomSheet open onClose={() => {}} title="Entry">
        <button type="button">Sheet action</button>
        <ConfirmDialog open title="Delete this entry?" body="It comes out of today." confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete this entry?' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    cancel.focus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('locks page scroll while open', () => {
    const { rerender } = render(
      <BottomSheet open onClose={() => {}} title="Budget">
        content
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <BottomSheet open={false} onClose={() => {}} title="Budget">
        content
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('unlocks page scroll when a sheet and the sheet nested in it close together', () => {
    const nested = (open: boolean) => (
      <BottomSheet open={open} onClose={() => {}} title="Log food">
        <BottomSheet open={open} onClose={() => {}} title="Pots in the fridge">
          pots
        </BottomSheet>
      </BottomSheet>
    );
    const { rerender } = render(nested(true));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(document.body.style.overflow).toBe('hidden');
    // Log 1 serving closes both in one commit (outer cleanup runs first).
    rerender(nested(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the lock until the last open sheet closes, and puts back what was there', () => {
    document.body.style.overflow = 'clip';
    const two = (outer: boolean, inner: boolean) => (
      <>
        <BottomSheet open={outer} onClose={() => {}} title="Log food">
          log
        </BottomSheet>
        <BottomSheet open={inner} onClose={() => {}} title="Which meal?">
          slot
        </BottomSheet>
      </>
    );
    const { rerender } = render(two(true, false));
    rerender(two(true, true));
    rerender(two(false, true));
    expect(document.body.style.overflow).toBe('hidden');
    rerender(two(false, false));
    expect(document.body.style.overflow).toBe('clip');
    document.body.style.overflow = '';
  });

  it('offers the newest sheet without a history entry of its own to the back button', () => {
    const onPickerClose = vi.fn();
    const { rerender } = render(
      <BottomSheet open routed onClose={() => {}} title="Log food">
        <BottomSheet open onClose={onPickerClose} title="When did you eat?">
          picker
        </BottomSheet>
      </BottomSheet>,
    );
    const top = topLocalSheet();
    expect(top?.dismissible).toBe(true);
    top?.close();
    expect(onPickerClose).toHaveBeenCalledTimes(1);

    // With only the routed (?sheet=) sheet open, back pops its history entry instead.
    rerender(
      <BottomSheet open routed onClose={() => {}} title="Log food">
        <BottomSheet open={false} onClose={onPickerClose} title="When did you eat?">
          picker
        </BottomSheet>
      </BottomSheet>,
    );
    expect(topLocalSheet()).toBeUndefined();
  });
});
