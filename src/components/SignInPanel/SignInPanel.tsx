import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './SignInPanel.module.css';

export interface SignInPanelProps {
  /**
   * Signs in (session.signIn). Rejects with an Error whose message is shown as is; an error with
   * kind 'invalidEmail' shows under the email field, any other under the password.
   */
  signIn: (email: string, password: string) => Promise<void>;
  /** Called once signed in. */
  onSignedIn?: () => void;
  initialEmail?: string;
  /** The line above the fields: what signing in is for here ("Sign in with the account your diary syncs to."). */
  lead?: string;
}

type Field = 'email' | 'password';

const FALLBACK_ERROR = "Couldn't sign in right now. Try again.";
const DEFAULT_LEAD = 'Your account keeps a synced copy of your diary and unlocks AI estimates. Everything works offline without it.';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

/** The field a sign-in error belongs to: the email for a bad address, the password otherwise. */
function fieldOf(error: unknown): Field {
  const kind = typeof error === 'object' && error !== null ? (error as { kind?: unknown }).kind : undefined;
  return kind === 'invalidEmail' ? 'email' : 'password';
}

/**
 * Sign-in with email and password, typed in the app: no email is sent, and nothing opens Safari
 * instead of the installed iPhone app. The fields carry the autofill hints iOS and password
 * managers need to fill the saved password. Errors show inline under the field they belong to.
 */
export function SignInPanel({ signIn, onSignedIn, initialEmail = '', lead = DEFAULT_LEAD }: SignInPanelProps) {
  const id = useId();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const [firstField] = useState<Field>(initialEmail ? 'password' : 'email');
  const mounted = useRef(true);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const refOf = (field: Field) => (field === 'email' ? emailRef : passwordRef);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The first empty field takes focus as the panel opens, so the keyboard is ready.
  useEffect(() => {
    (firstField === 'email' ? emailRef : passwordRef).current?.focus();
  }, [firstField]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await signIn(email.trim(), password);
        if (!mounted.current) return;
        setPassword('');
        onSignedIn?.();
      } catch (failure) {
        if (!mounted.current) return;
        const field = fieldOf(failure);
        setError({ field, message: messageOf(failure) });
        refOf(field).current?.focus();
      } finally {
        if (mounted.current) setBusy(false);
      }
    })();
  };

  // Return in the email field moves on to the password while it's empty, instead of submitting.
  const emailKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || password !== '') return;
    event.preventDefault();
    passwordRef.current?.focus();
  };

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const emailError = error?.field === 'email' ? error.message : null;
  const passwordError = error?.field === 'password' ? error.message : null;
  const wrapClass = (invalid: boolean) => [styles.inputWrap, invalid ? styles.invalid : ''].filter(Boolean).join(' ');

  return (
    <form className={styles.panel} noValidate aria-busy={busy} onSubmit={submit}>
      <p className={styles.lead}>{lead}</p>
      <div className={styles.field}>
        <label htmlFor={`${id}-email`} className={styles.label}>
          Email
        </label>
        <div className={wrapClass(emailError !== null)}>
          <input
            ref={emailRef}
            id={`${id}-email`}
            name="email"
            className={styles.input}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="you@example.com"
            value={email}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? errorId : undefined}
            onKeyDown={emailKeyDown}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
          />
        </div>
        {emailError ? (
          <p id={errorId} className={styles.error} role="alert">
            {emailError}
          </p>
        ) : null}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-password`} className={styles.label}>
          Password
        </label>
        <div className={wrapClass(passwordError !== null)}>
          <input
            ref={passwordRef}
            id={`${id}-password`}
            name="password"
            className={styles.input}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            value={password}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? errorId : hintId}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
          />
          <button
            type="button"
            className={styles.reveal}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => {
              setShowPassword((shown) => !shown);
              passwordRef.current?.focus();
            }}
          >
            {showPassword ? <EyeOff size={20} strokeWidth={2} aria-hidden="true" /> : <Eye size={20} strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>
        {passwordError ? (
          <p id={errorId} className={styles.error} role="alert">
            {passwordError}
          </p>
        ) : (
          <p id={hintId} className={styles.hint}>
            You stay signed in on this phone.
          </p>
        )}
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
