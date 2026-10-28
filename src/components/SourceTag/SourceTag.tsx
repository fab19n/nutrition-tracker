import { Pill } from '@/components/ui/Pill';
import type { SourceTag as SourceTagKind } from '@/domain/types';

export const SOURCE_LABEL: Record<SourceTagKind, string> = {
  yourCorrection: 'Your correction',
  catalogue: 'Catalogue',
  label: 'Label',
  myfcd: 'MyFCD',
  sgfoodid: 'SG FoodID',
  usda: 'USDA',
  aiGuess: 'AI guess',
};

export interface SourceTagProps {
  source: SourceTagKind;
  className?: string;
}

/**
 * Where an estimate came from: a small outline pill. "AI guess" gets the dashed amber outline.
 * @design C24
 */
export function SourceTag({ source, className }: SourceTagProps) {
  return (
    <Pill tone={source === 'aiGuess' ? 'outlineAmber' : 'outline'} className={className}>
      {SOURCE_LABEL[source]}
    </Pill>
  );
}
