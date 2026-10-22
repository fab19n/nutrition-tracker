import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionPrimer } from './PermissionPrimer';

function renderPrimer(extra: Partial<Parameters<typeof PermissionPrimer>[0]> = {}) {
  const onAllow = vi.fn();
  const onNotNow = vi.fn();
  render(
    <PermissionPrimer
      kind="drive"
      title="Keep meal photos in Google Drive?"
      body="The app can only see files it creates."
      allowLabel="Continue with Google"
      onAllow={onAllow}
      onNotNow={onNotNow}
      {...extra}
    />,
  );
  return { onAllow, onNotNow };
}

describe('PermissionPrimer (C58)', () => {
  it('shows the title, body and both buttons, as before', async () => {
    const user = userEvent.setup();
    const { onAllow, onNotNow } = renderPrimer();
    const region = screen.getByRole('region', { name: 'Keep meal photos in Google Drive?' });
    expect(region).toHaveAccessibleDescription('The app can only see files it creates.');
    const allow = screen.getByRole('button', { name: 'Continue with Google' });
    expect(allow).toBeEnabled();
    expect(allow).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(allow);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onNotNow).toHaveBeenCalledTimes(1);
  });

  it('disables the allow button until it can be used', async () => {
    const user = userEvent.setup();
    const { onAllow } = renderPrimer({ allowLabel: 'Getting ready…', allowDisabled: true });
    const allow = screen.getByRole('button', { name: 'Getting ready…' });
    expect(allow).toBeDisabled();
    expect(allow).not.toHaveAttribute('aria-busy');
    await user.click(allow);
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('says the allow button is busy', () => {
    renderPrimer({ allowLabel: 'Connecting…', allowBusy: true });
    const allow = screen.getByRole('button', { name: 'Connecting…' });
    expect(allow).toBeDisabled();
    expect(allow).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error line as an alert', () => {
    renderPrimer({ error: "The Google window didn't open. Try again." });
    expect(screen.getByRole('alert')).toHaveTextContent("The Google window didn't open. Try again.");
  });
});
