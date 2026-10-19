import { CircleCheck, Clock, CookingPot } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { fmtApprox, fmtInt, roundTo10 } from '@/domain/format';
import styles from './PotCard.module.css';

export type PotCardState = 'active' | 'clearsToday' | 'cleared';

/** 3 → "3", 2.5 → "2½", 0.5 → "½". */
export function servingsText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const whole = Math.floor(n);
  const half = Math.abs(n - whole - 0.5) < 1e-6;
  if (half) return whole === 0 ? '½' : `${fmtInt(whole)}½`;
  return fmtInt(n);
}

/** "3 of 8 servings left". */
export function servingsLeftText(servingsLeft: number, servings: number): string {
  return `${servingsText(servingsLeft)} of ${fmtInt(servings)} servings left`;
}

export type MeterCell = 'full' | 'half' | 'empty';

/** Most pots fit one cell per serving; bigger ones still show 12 cells, in proportion. */
const MAX_CELLS = 12;

/** The serving meter's cells, left = still in the pot. */
export function meterCells(servingsLeft: number, servings: number): MeterCell[] {
  const total = Math.max(0, Math.round(servings));
  if (total === 0) return [];
  const count = Math.min(total, MAX_CELLS);
  const left = Math.max(0, Math.min(total, servingsLeft)) * (count / total);
  return Array.from({ length: count }, (_, i) => {
    if (left >= i + 1 - 1e-6) return 'full';
    if (left > i + 1e-6) return 'half';
    return 'empty';
  });
}

const STATE_TONE: Record<PotCardState, PillTone> = { active: 'neutral', clearsToday: 'amber', cleared: 'neutral' };

export interface PotCardProps {
  name: string;
  servings: number;
  /** ½ steps allowed. */
  servingsLeft: number;
  /** One serving, unrounded (the card rounds it to 10). */
  kcalPerServing: number;
  state: PotCardState;
  /** "Clears Sunday", "Clears today", "Cleared". */
  clearsText: string;
  /** Logs one serving. Hidden once the pot has cleared. */
  onLog?: () => void;
  /** Opens the pot (S28): the whole card is the target. */
  onOpen?: () => void;
  /** A serving is being saved: the button waits, so a double tap logs one. */
  busy?: boolean;
  /** Heading level of the name inside its list. */
  headingLevel?: 2 | 3;
}

/**
 * A pot in the fridge: servings left (with a meter), kcal a serving, when it clears, and
 * Log 1 serving. Tapping the card opens the pot.
 * @design C38 PotCard
 */
export function PotCard({
  name,
  servings,
  servingsLeft,
  kcalPerServing,
  state,
  clearsText,
  onLog,
  onOpen,
  busy = false,
  headingLevel = 3,
}: PotCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const cleared = state === 'cleared';
  const cells = meterCells(servingsLeft, servings);
  // The last half serving logs as ½.
  const logLabel = servingsLeft >= 1 ? 'Log 1 serving' : `Log ${servingsText(servingsLeft)} serving`;
  return (
    <Card radius="card" padding="14px 16px" className={[styles.card, cleared ? styles.cleared : '', onOpen ? styles.pressable : ''].filter(Boolean).join(' ')}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <CookingPot size={20} strokeWidth={2} />
        </span>
        <div className={styles.text}>
          <Heading className={styles.name}>
            {onOpen ? (
              <button type="button" className={styles.open} onClick={onOpen}>
                {name}
              </button>
            ) : (
              name
            )}
          </Heading>
          <p className={styles.left}>{servingsLeftText(servingsLeft, servings)}</p>
        </div>
        <Pill
          tone={STATE_TONE[state]}
          icon={cleared ? <CircleCheck size={12} strokeWidth={2} /> : <Clock size={12} strokeWidth={2} />}
          className={styles.status}
        >
          {clearsText}
        </Pill>
      </div>

      {cells.length > 0 ? (
        <div className={styles.meter} aria-hidden="true">
          {cells.map((cell, i) => (
            <span key={i} className={[styles.cell, styles[cell]].join(' ')} />
          ))}
        </div>
      ) : null}

      <div className={styles.foot}>
        <span className={styles.kcal}>
          <b>{fmtApprox(roundTo10(kcalPerServing))} kcal</b> a serving
        </span>
        {onLog && !cleared ? (
          <Button size="sm" className={styles.log} aria-label={`${logLabel} of ${name}`} disabled={busy || servingsLeft <= 0} onClick={onLog}>
            {logLabel}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
