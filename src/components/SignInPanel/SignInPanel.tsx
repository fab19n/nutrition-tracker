import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import styles from './SignInPanel.module.css';

/** A code already on its way: the address and when it went out (epoch ms). */
export interface SignInCodeRequest {
  email: string;
  sentAt: number;
}

export interface SignInPanelProps {
  /** Emails a code (session.sendSignInCode). Rejects with an Error whose message is shown as is. */
  sendCode: (email: string) => Promise<void>;
  /** Signs in with the code (session.verifySignInCode). Rejects like sendCode. */
  verifyCode: (email: string, code: string) => Promise<void>;
  /** Called once the code is accepted. */
  onSignedIn?: () => void;
  /** Seconds before "Send a new code" works again. Supabase allows one code a minute. */
  cooldownSeconds?: number;
  /** Digits in the emailed code. */
  codeLength?: number;
  initialEmail?: string;
  /**
   * The last code asked for (session.readCodeRequest), while it still works. The panel opens on
   * its code step, with the resend cooldown counted from when it went out, so closing the sheet
   * or a relaunch of the app doesn't cost another email.
   */
  lastRequest?: SignInCodeRequest | null;
}

type Step = 'email' | 'code';
type Busy = 'sending' | 'verifying' | 'resending' | null;

const FALLBACK_ERROR = "Couldn't sign in right now. Try again.";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
}

/** "a 6-digit code", "an 8-digit code": the code length is a Supabase setting. */
function digitCode(length: number): string {
  return `${/^(8|11|18)$/.test(String(length)) ? 'an' : 'a'} ${length}-digit code`;
}

function secondsUntil(at: number): number {
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Sign-in by emailed one-time code: email → "Send code", then the 6-digit code → "Sign in", with
 * "Use a different email" and "Send a new code" (after a cooldown). Once a code is out, the email
 * step offers "I have a code" to go back to it without sending another. Codes, not links, because
 * an emailed link opens Safari instead of the installed iPhone app. Errors show inline.
 */
export function SignInPanel({
  sendCode,
  verifyCode,
  onSignedIn,
  cooldownSeconds = 60,
  codeLength = 6,
  initialEmail = '',
  lastRequest = null,
}: SignInPanelProps) {
  const id = useId();
  const [step, setStep] = useState<Step>(lastRequest ? 'code' : 'email');
  const [email, setEmail] = useState(lastRequest?.email ?? initialEmail);
  const [sentTo, setSentTo] = useState(lastRequest?.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [initialResendAt] = useState(() => (lastRequest ? lastRequest.sentAt + cooldownSeconds * 1000 : 0));
  const [cooldown, setCooldown] = useState(() => secondsUntil(initialResendAt));
  const resendAt = useRef(initialResendAt);
  const mounted = useRef(true);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const counting = cooldown > 0;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Each step's field takes focus as the step opens, so the keyboard is ready.
  useEffect(() => {
    (step === 'email' ? emailRef : codeRef).current?.focus();
  }, [step]);

  // "Send a new code in 42s": counts down from the moment the last code went out.
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => {
      setCooldown(secondsUntil(resendAt.current));
    }, 1000);
    return () => clearInterval(timer);
  }, [counting]);

  const startCooldown = () => {
    resendAt.current = Date.now() + cooldownSeconds * 1000;
    setCooldown(cooldownSeconds);
  };

  const run = async (kind: Exclude<Busy, null>, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (failure) {
      if (mounted.current) setError(messageOf(failure));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    void run('sending', async () => {
      await sendCode(address);
      if (!mounted.current) return;
      setSentTo(address);
      setCode('');
      setStep('code');
      startCooldown();
    });
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    void run('verifying', async () => {
      await verifyCode(sentTo, code);
      if (mounted.current) onSignedIn?.();
    });
  };

  const resend = () => {
    if (cooldown > 0) return;
    void run('resending', async () => {
      await sendCode(sentTo);
      if (!mounted.current) return;
      setCode('');
      setNotice('New code sent.');
      startCooldown();
      codeRef.current?.focus();
    });
  };

  const useDifferentEmail = () => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setCode('');
    setStep('email');
  };

  const enterCode = () => {
    if (busy || sentTo === '') return;
    setError(null);
    setNotice(null);
    setCode('');
    setStep('code');
  };

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  if (step === 'email') {
    return (
      <form className={styles.panel} noValidate aria-busy={busy !== null} onSubmit={submitEmail}>
        <p className={styles.lead}>Only AI estimates need this. Everything else works without an account.</p>
        <div className={styles.field}>
          <label htmlFor={`${id}-email`} className={styles.label}>
            Email
          </label>
          <div className={[styles.inputWrap, error ? styles.invalid : ''].filter(Boolean).join(' ')}>
            <input
              ref={emailRef}
              id={`${id}-email`}
              className={styles.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              placeholder="you@example.com"
              value={email}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : hintId}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>
          {error ? (
            <p id={errorId} className={styles.error} role="alert">
              {error}
            </p>
          ) : (
            <p id={hintId} className={styles.hint}>
              We email you {digitCode(codeLength)}. No password.
            </p>
          )}
        </div>
        <Button type="submit" disabled={busy !== null}>
          {busy === 'sending' ? 'Sending code…' : 'Send code'}
        </Button>
        {sentTo !== '' ? (
          <div className={styles.secondary}>
            <Button variant="ghost" size="md" disabled={busy !== null} onClick={enterCode}>
              I have a code
            </Button>
          </div>
        ) : null}
      </form>
    );
  }

  const resendLabel = busy === 'resending' ? 'Sending…' : cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code';

  return (
    <form className={styles.panel} noValidate aria-busy={busy !== null} onSubmit={submitCode}>
      <p className={styles.lead}>
        We sent {digitCode(codeLength)} to <span className={styles.email}>{sentTo}</span>.
      </p>
      <div className={styles.field}>
        <label htmlFor={`${id}-code`} className={styles.label}>
          Code
        </label>
        <div className={[styles.inputWrap, error ? styles.invalid : ''].filter(Boolean).join(' ')}>
          <input
            ref={codeRef}
            id={`${id}-code`}
            className={[styles.input, styles.codeInput].join(' ')}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            enterKeyHint="done"
            placeholder={'0'.repeat(codeLength)}
            value={code}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : hintId}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, codeLength));
              if (error) setError(null);
            }}
          />
        </div>
        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : (
          <p id={hintId} className={styles.hint} role="status">
            {notice ?? "It can take a minute. Check spam if it isn't there."}
          </p>
        )}
      </div>
      <Button type="submit" disabled={busy !== null}>
        {busy === 'verifying' ? 'Signing in…' : 'Sign in'}
      </Button>
      <div className={styles.secondary}>
        <Button variant="ghost" size="md" disabled={busy !== null || cooldown > 0} onClick={resend}>
          {resendLabel}
        </Button>
        <Button variant="ghost" size="md" disabled={busy !== null} onClick={useDifferentEmail}>
          Use a different email
        </Button>
      </div>
    </form>
  );
}
