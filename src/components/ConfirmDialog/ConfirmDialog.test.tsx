import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';
import { typingMatches } from './typingMatches';

function Harness(props: { requireTyping?: string; destructive?: boolean; onConfirm?: () => void; onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete everything
      </button>
      <ConfirmDialog
        open={open}
        title="Delete everything?"
        body="Meals, weights, Places and photos on this phone are removed. This can't be undone."
        confirmLabel="Delete everything"
        destructive={props.destructive}
        requireTyping={props.requireTyping}
        onConfirm={() => {
          props.onConfirm?.();
          setOpen(false);
        }}
        onCancel={() => {
          props.onCancel?.();
          setOpen(false);
        }}
      />
    </>
  );
}

describe('typingMatches', () => {
  it('is case-sensitive and ignores surrounding spaces', () => {
    expect(typingMatches('DELETE', 'DELETE')).toBe(true);
    expect(typingMatches(' DELETE ', 'DELETE')).toBe(true);
    expect(typingMatches('delete', 'DELETE')).toBe(false);
    expect(typingMatches('', undefined)).toBe(true);
  });
});

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Confirm disabled until the required text is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness destructive requireTyping="DELETE" onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete everything?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = screen.getByRole('textbox', { name: /Type DELETE to confirm/ });
    expect(input).toHaveFocus();

    const confirm = screen.getAllByRole('button', { name: 'Delete everything' }).find((b) => dialog.contains(b));
    expect(confirm).toBeDisabled();
    await user.type(input, 'delete');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'DELETE{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('starts destructive dialogs on Cancel, traps Tab and closes on Escape with focus restored', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness destructive onCancel={onCancel} />);
    const trigger = screen.getByRole('button', { name: 'Delete everything' });
    await user.click(trigger);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await user.tab();
    const dialog = screen.getByRole('alertdialog');
    const confirm = screen.getAllByRole('button', { name: 'Delete everything' }).find((b) => dialog.contains(b));
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('uses role dialog when not destructive', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(screen.getByRole('dialog', { name: 'Delete everything?' })).toBeInTheDocument();
  });
});
