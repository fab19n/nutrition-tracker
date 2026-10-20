import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignInPanel, type SignInPanelProps } from './SignInPanel';

const EMAIL = 'fabian@example.com';
const PASSWORD = 'correct horse battery staple';

function setup(props: Partial<SignInPanelProps> = {}) {
  const signIn = vi.fn<SignInPanelProps['signIn']>(async () => {});
  const onSignedIn = vi.fn();
  const user = userEvent.setup();
  render(<SignInPanel signIn={signIn} onSignedIn={onSignedIn} {...props} />);
  return { user, signIn, onSignedIn };
}

/** The password field: a password input has no role, so it's found by its label. */
function passwordField(): HTMLElement {
  return screen.getByLabelText('Password');
}

async function fillIn(user: ReturnType<typeof userEvent.setup>, email = EMAIL, password = PASSWORD) {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(passwordField(), password);
}

/** A promise the test settles by hand, to look at busy states. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** An error shaped like session.SignInError. */
function signInError(kind: string, message: string): Error {
  return Object.assign(new Error(message), { kind });
}

describe('SignInPanel', () => {
  it('asks for an email and password with the autofill hints password managers need', () => {
    setup();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toHaveFocus();

    const password = passwordField();
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password.closest('form')).toBe(email.closest('form'));
    expect(
      screen.getByText('Your account keeps a synced copy of your diary and unlocks AI estimates. Everything works offline without it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('You stay signed in on this phone.')).toBeInTheDocument();
  });

  it('says what signing in is for when given a lead', () => {
    setup({ lead: 'Sign in with the account your diary syncs to.' });
    expect(screen.getByText('Sign in with the account your diary syncs to.')).toBeInTheDocument();
    expect(screen.queryByText(/unlocks AI estimates/)).not.toBeInTheDocument();
  });

  it('starts on the password when the email is known', () => {
    setup({ initialEmail: EMAIL });
    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL);
    expect(passwordField()).toHaveFocus();
  });

  it('signs in with the trimmed email and the password as typed', async () => {
    const { user, signIn, onSignedIn } = setup();
    await fillIn(user, `  ${EMAIL} `, ` ${PASSWORD} `);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(signIn).toHaveBeenCalledWith(EMAIL, ` ${PASSWORD} `);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('moves from the email to an empty password on Return instead of submitting', async () => {
    const { user, signIn } = setup();
    await user.type(screen.getByLabelText('Email'), `${EMAIL}{Enter}`);
    expect(passwordField()).toHaveFocus();
    expect(signIn).not.toHaveBeenCalled();

    await user.type(passwordField(), `${PASSWORD}{Enter}`);
    expect(signIn).toHaveBeenCalledWith(EMAIL, PASSWORD);
  });

  it('shows and hides the password', async () => {
    const { user } = setup();
    await user.type(passwordField(), PASSWORD);

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordField()).toHaveAttribute('type', 'text');
    expect(passwordField()).toHaveValue(PASSWORD);
    expect(passwordField()).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordField()).toHaveAttribute('type', 'password');
  });

  it('shows the busy state while signing in', async () => {
    const signingIn = deferred();
    const { user, onSignedIn } = setup({ signIn: () => signingIn.promise });
    await fillIn(user);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    await act(async () => signingIn.resolve());
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('shows a wrong password under the password field and lets you try again', async () => {
    const signIn = vi
      .fn<SignInPanelProps['signIn']>()
      .mockRejectedValueOnce(signInError('wrongPassword', 'Wrong email or password.'))
      .mockResolvedValueOnce(undefined);
    const { user, onSignedIn } = setup({ signIn });
    await fillIn(user, EMAIL, 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(passwordField()).toHaveAttribute('aria-invalid', 'true');
    expect(passwordField()).toHaveAccessibleDescription('Wrong email or password.');
    expect(passwordField()).toHaveFocus();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(onSignedIn).not.toHaveBeenCalled();

    // Typing again clears the error.
    await user.clear(passwordField());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(passwordField(), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenLastCalledWith(EMAIL, PASSWORD);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('shows an email problem under the email field', async () => {
    const { user } = setup({ signIn: async () => Promise.reject(signInError('invalidEmail', "That doesn't look like an email address.")) });
    await fillIn(user, 'fabian@example');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("That doesn't look like an email address.");
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(passwordField()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('You stay signed in on this phone.')).toBeInTheDocument();
  });

  it('falls back to a general message for an error without one', async () => {
    const { user } = setup({ signIn: async () => Promise.reject(new Error('')) });
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign in right now. Try again.");
  });
});
