import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSheet } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { EvidenceList, type EvidenceItem } from '@/components/EvidenceList/EvidenceList';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SLOT_LABEL } from '@/components/SlotPicker/slots';
import { Button } from '@/components/ui/Button';
import { recordFeedback, useEvidence, type EvidenceView } from '@/db/insightsData';
import { fmtApprox, fmtDayLetter, fmtDayShort, fmtTime, roundTo10 } from '@/domain/format';
import { fmtWeekdayLong } from '@/domain/insights';
import { useUiStore } from '@/state/ui';
import styles from './EvidenceSheet.module.css';

/** A mini chart only makes sense for a week or less. */
const MAX_BAR_DAYS = 7;

function itemsOf(evidence: EvidenceView): EvidenceItem[] {
  return evidence.rows.map(({ meal, kcal, label }) => {
    const item: EvidenceItem = {
      id: meal.id,
      dayLabel: fmtDayShort(meal.logicalDay),
      slotLabel: SLOT_LABEL[meal.slot],
      timeLabel: fmtTime(meal.eatenAt, evidence.tz),
      name: label ?? meal.name,
      kcalLabel: fmtApprox(roundTo10(kcal)),
    };
    const place = meal.placeId ? evidence.placeNames[meal.placeId] : undefined;
    if (place) item.placeName = place;
    return item;
  });
}

/** @design S32 Evidence sheet — the summary, a mini bar by day, the meals behind an insight, "Not for me". */
export default function EvidenceSheet({ close }: { close: () => void }) {
  const { params } = useSheet();
  const ruleId = params.get('rule');
  const evidence = useEvidence(ruleId);
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  if (!ruleId || (evidence && !evidence.insight)) {
    return (
      <div className={styles.root}>
        <EmptyState
          surface="plain"
          headline="Nothing to show here"
          body="This insight has no meals behind it right now."
          actionLabel="Close"
          onAction={close}
        />
      </div>
    );
  }

  if (!evidence?.insight) {
    return (
      <div className={styles.root}>
        <SkeletonList count={3} label="Loading the meals behind this" />
      </div>
    );
  }

  const { insight } = evidence;
  const days = evidence.days.length <= MAX_BAR_DAYS ? evidence.days : [];
  const busiest = [...days].sort((a, b) => b.kcal - a.kcal)[0];
  const barsLabel = busiest && busiest.kcal > 0 ? `${insight.summary}. Most on ${fmtWeekdayLong(busiest.day)}.` : insight.summary;

  const notForMe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const undo = await recordFeedback(evidence.ruleId, 'notForMe');
      showToast('Paused for 4 weeks', () => void undo());
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root}>
      <SheetTitle className={styles.title}>{insight.headline}</SheetTitle>
      <EvidenceList
        summary={insight.summary}
        bars={days.map((d) => ({ label: fmtDayLetter(d.day), kcal: d.kcal }))}
        barsLabel={barsLabel}
        items={itemsOf(evidence)}
        onOpen={(id) => navigate(PATHS.entry(id))}
      />
      {insight.tryText ? (
        <p className={styles.try}>
          <b>Try:</b> {insight.tryText}
        </p>
      ) : null}
      <div className={styles.footer}>
        {evidence.paused ? (
          <p className={styles.caption}>Paused for about 4 weeks.</p>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={() => void notForMe()} disabled={busy}>
              Not for me
            </Button>
            <p className={styles.caption}>Pauses this insight for about 4 weeks.</p>
          </>
        )}
      </div>
    </div>
  );
}
