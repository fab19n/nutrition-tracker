import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignInPanel, type SignInPanelProps } from './SignInPanel';

const EMAIL = 'fabian@example.com';

function setup(props: Partial<SignInPanelProps> = {}, opts: { fakeTimers?: boolean } = {}) {
  const sendCode = vi.fn<SignInPanelProps['sendCode']>(async () => {});
  const verifyCode = vi.fn<SignInPanelProps['verifyCode']>(async () => {});
  const onSignedIn = vi.fn();
  const user = userEvent.setup(opts.fakeTimers ? { advanceTimers: (ms) => vi.advanceTimersByTime(ms) } : {});
  render(<SignInPanel sendCode={sendCode} verifyCode={verifyCode} onSignedIn={onSignedIn} {...props} />);
  return { user, sendCode, verifyCode, onSignedIn };
}

async function sendTo(user: ReturnType<typeof userEvent.setup>, email = EMAIL) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByLabelText('Code');
}

/** A promise the test settles by hand, to look at busy states. */
function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SignInPanel', () => {
  it('asks for an email with the right keyboard and autofill', () => {
    setup();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveFocus();
    expect(screen.getByText('Only AI estimates need this. Everything else works without an account.')).toBeInTheDocument();
  });

  it('sends a code and moves to the code step', async () => {
    const { user, sendCode } = setup();
    await sendTo(user, `  ${EMAIL} `);

    expect(sendCode).toHaveBeenCalledWith(EMAIL);
    expect(screen.getByText(/We sent a 6-digit code to/)).toHaveTextContent(`We sent a 6-digit code to ${EMAIL}.`);
    const code = screen.getByLabelText('Code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveFocus();
  });

  it('shows the busy state while the code is on its way', async () => {
    const sending = deferred();
    const { user } = setup({ sendCode: () => sending.promise });

    await user.type(screen.getByLabelText('Email'), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByRole('button', { name: 'Sending code…' })).toBeDisabled();

    await act(async () => sending.resolve());
    expect(await screen.findByLabelText('Code')).toBeInTheDocument();
  });

  it('shows a send error under the email field and stays there', async () => {
    const { user } = setup({ sendCode: async () => Promise.reject(new Error("That email can't sign in to this app.")) });

    await user.type(screen.getByLabelText('Email'), EMAIL);
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("That email can't sign in to this app.");
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument();

    // Typing again clears the error.
    await user.type(screen.getByLabelText('Email'), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps only digits in the code and signs in with it', async () => {
    const { user, verifyCode, onSignedIn } = setup();
    await sendTo(user);

    await user.type(screen.getByLabelText('Code'), '12 34-56789');
    expect(screen.getByLabelText('Code')).toHaveValue('123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(verifyCode).toHaveBeenCalledWith(EMAIL, '123456');
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('shows the busy state while signing in', async () => {
    const verifying = deferred();
    const { user, onSignedIn } = setup({ verifyCode: () => verifying.promise });
    await sendTo(user);

    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Use a different email' })).toBeDisabled();

    await act(async () => verifying.resolve());
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('shows a wrong code inline and lets you try again', async () => {
    const verifyCode = vi
      .fn<SignInPanelProps['verifyCode']>()
      .mockRejectedValueOnce(new Error('That code is wrong or has expired. Check it, or send a new code.'))
      .mockResolvedValueOnce(undefined);
    const { user, onSignedIn } = setup({ verifyCode });
    await sendTo(user);

    await user.type(screen.getByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired.');
    expect(onSignedIn).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Code'));
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('goes back to the email step with the email kept', async () => {
    const { user } = setup();
    await sendTo(user);

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL);
    expect(screen.getByRole('button', { name: 'Send code' })).toBeEnabled();
  });

  it('offers "I have a code" only once a code is out, and goes back to it without sending', async () => {
    const { user, sendCode, verifyCode } = setup();
    expect(screen.queryByRole('button', { name: 'I have a code' })).not.toBeInTheDocument();
    await sendTo(user);

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    await user.click(screen.getByRole('button', { name: 'I have a code' }));

    expect(sendCode).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/We sent a 6-digit code to/)).toHaveTextContent(EMAIL);
    expect(screen.getByLabelText('Code')).toHaveFocus();
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(verifyCode).toHaveBeenCalledWith(EMAIL, '123456');
  });

  it('reopens on the code step for a code asked for earlier, without sending another', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, sendCode, verifyCode, onSignedIn } = setup({ lastRequest: { email: EMAIL, sentAt: Date.now() - 45_000 } }, { fakeTimers: true });

    expect(screen.getByText(/We sent a 6-digit code to/)).toHaveTextContent(`We sent a 6-digit code to ${EMAIL}.`);
    expect(screen.getByLabelText('Code')).toHaveFocus();
    // The cooldown counts from when that code went out.
    expect(screen.getByRole('button', { name: 'Send a new code in 15s' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();

    await user.type(screen.getByLabelText('Code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(verifyCode).toHaveBeenCalledWith(EMAIL, '654321');
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(sendCode).not.toHaveBeenCalled();
  });

  it('can still switch to another email from a code asked for earlier', async () => {
    const { user, sendCode } = setup({ lastRequest: { email: EMAIL, sentAt: Date.now() - 120_000 } });
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL);
    await user.clear(screen.getByLabelText('Email'));
    await sendTo(user, 'other@example.com');
    expect(sendCode).toHaveBeenCalledWith('other@example.com');
    expect(screen.getByText(/We sent a 6-digit code to/)).toHaveTextContent('other@example.com');
  });

  it('waits 60 s before sending a new code', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, sendCode } = setup({}, { fakeTimers: true });
    await sendTo(user);

    const resend = screen.getByRole('button', { name: 'Send a new code in 60s' });
    expect(resend).toBeDisabled();

    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole('button', { name: 'Send a new code in 40s' })).toBeDisabled();

    act(() => vi.advanceTimersByTime(40_000));
    const ready = screen.getByRole('button', { name: 'Send a new code' });
    expect(ready).toBeEnabled();

    await user.click(ready);
    expect(sendCode).toHaveBeenCalledTimes(2);
    expect(sendCode).toHaveBeenLastCalledWith(EMAIL);
    expect(await screen.findByText('New code sent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new code in 60s' })).toBeDisabled();
  });

  it('honours a custom cooldown and code length', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup({ cooldownSeconds: 5, codeLength: 8 }, { fakeTimers: true });
    await sendTo(user);

    expect(screen.getByText(/We sent an 8-digit code/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code'), '1234567890');
    expect(screen.getByLabelText('Code')).toHaveValue('12345678');
    expect(screen.getByRole('button', { name: 'Send a new code in 5s' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it('shows a failed resend inline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sendCode = vi
      .fn<SignInPanelProps['sendCode']>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Too many codes sent for now. Enter the last code you got, or try again later.'));
    const { user } = setup({ sendCode, cooldownSeconds: 1 }, { fakeTimers: true });
    await sendTo(user);

    act(() => vi.advanceTimersByTime(1_000));
    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many codes sent for now.');
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
  });
});
