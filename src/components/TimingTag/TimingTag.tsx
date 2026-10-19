import type { LucideIcon } from 'lucide-react';
import { CircleCheck, Clock, Moon, TimerOff } from 'lucide-react';
import type { TimingTagKind } from '@/domain/timing';
import { Pill, type PillTone } from '@/components/ui/Pill';

export type { TimingTagKind };

interface TagSpec {
  label: string;
  tone: PillTone;
  Icon: LucideIcon;
  /** Extra words for screen readers where the short label leaves something out. */
  srHint?: string;
}

const TAGS: Record<TimingTagKind, TagSpec> = {
  onTime: { label: 'On time', tone: 'accent', Icon: CircleCheck },
  lateForYou: { label: 'Late for you', tone: 'amber', Icon: Clock },
  earlyForYou: { label: 'Early for you', tone: 'neutral', Icon: Clock },
  outsideWindow: { label: 'Outside window', tone: 'amber', Icon: TimerOff },
  afterMidnight: { label: 'After midnight', tone: 'neutral', Icon: Moon, srHint: 'counts toward the previous day' },
};

export interface TimingTagProps {
  kind: TimingTagKind;
  className?: string;
}

/**
 * @design C31 TimingTag — 11px/600 pill: "On time" (accent), "Late for you" (amber), "Early for you" (neutral),
 * "Outside window" (amber), "After midnight" (neutral). Always a word plus an icon, never colour alone.
 */
export function TimingTag({ kind, className }: TimingTagProps) {
  const { label, tone, Icon, srHint } = TAGS[kind];
  return (
    <Pill tone={tone} icon={<Icon size={12} strokeWidth={2} />} className={className}>
      {label}
      {srHint ? <span className="sr-only">, {srHint}</span> : null}
    </Pill>
  );
}
