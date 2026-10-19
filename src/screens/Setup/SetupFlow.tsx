import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { PATHS } from '@/app/paths';
import { loadDemoData } from '@/db/actions';
import { useHasProfile } from '@/db/hooks';
import { finishSetup } from '@/db/settings';
import { fmtKcal } from '@/domain/format';
import { useUiStore } from '@/state/ui';
import { AboutStep } from './AboutStep';
import { ActivityStep } from './ActivityStep';
import { DayStep } from './DayStep';
import { initialDraft, pickedRegulars, toSetupInput, type SetupDraft, type StepProps } from './draft';
import { GoalStep } from './GoalStep';
import { PlacesStep } from './PlacesStep';
import { RegularsStep } from './RegularsStep';
import { WelcomeScreen } from './WelcomeScreen';
import styles from './Setup.module.css';

/** S02–S07; S01 Welcome is step 0 and has no progress bar. */
const STEPS = 6;

/**
 * S01–S07 first run (plan §16.1). Answers stay in memory until Done, which runs completeSetup and
 * saves the regulars as Usuals, then opens Today. With a profile already there, /setup goes to Today.
 */
export default function SetupFlow() {
  const hasProfile = useHasProfile();
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(initialDraft);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const update = useCallback((patch: Partial<SetupDraft>) => setDraft((d) => ({ ...d, ...patch })), []);

  // Each step change moves focus to the new question, so screen readers hear it and the page starts at the top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const heading = rootRef.current?.querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }, [step]);

  const goTo = (next: number) => setStep(Math.min(Math.max(next, 0), STEPS));

  const explore = async () => {
    setBusy(true);
    try {
      await loadDemoData();
      showToast('Showing a sample week. Leave demo any time in Settings.');
      navigate(PATHS.today, { replace: true });
    } catch {
      setBusy(false);
      showToast("Couldn't load the sample week. Try again.");
    }
  };

  const finish = async () => {
    const input = toSetupInput(draft);
    if (!input) {
      // An earlier answer is missing (can't normally happen): go back to the first step.
      goTo(1);
      return;
    }
    setBusy(true);
    try {
      const { version } = await finishSetup(input, pickedRegulars(draft));
      showToast(`All set · ${fmtKcal(version.dailyKcal)} a day`);
      navigate(PATHS.today, { replace: true });
    } catch {
      setBusy(false);
      showToast("Couldn't finish setup. Try again.");
    }
  };

  if (hasProfile === undefined) return null;
  // Setup is done (or the sample week is loaded): /setup goes to Today.
  if (hasProfile) return <Navigate to={PATHS.today} replace />;

  const props: StepProps = {
    step,
    total: STEPS,
    draft,
    update,
    onNext: () => goTo(step + 1),
    onBack: () => goTo(step - 1),
  };

  return (
    <div ref={rootRef} className={styles.flow}>
      {step === 0 ? <WelcomeScreen onStart={() => goTo(1)} onExplore={() => void explore()} exploring={busy} /> : null}
      {step === 1 ? <AboutStep {...props} /> : null}
      {step === 2 ? <ActivityStep {...props} /> : null}
      {step === 3 ? <GoalStep {...props} /> : null}
      {step === 4 ? <RegularsStep {...props} /> : null}
      {step === 5 ? <PlacesStep {...props} /> : null}
      {step === 6 ? <DayStep {...props} onNext={() => void finish()} busy={busy} /> : null}
    </div>
  );
}
