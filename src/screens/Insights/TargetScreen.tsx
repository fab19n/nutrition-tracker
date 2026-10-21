import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CircleCheck, Clock } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { TargetSuggestionCard } from '@/components/TargetSuggestionCard/TargetSuggestionCard';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { UnlockProgress } from '@/components/UnlockProgress/UnlockProgress';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useNow } from '@/db/hooks';
import { markTargetNoticeSeen, useTargetView, type TargetView } from '@/db/targetSuggestion';
import { historyRows, pendingModel, screenTitle, statusModel, targetCardModel } from './targetModel';
import { useTargetDecisions } from './useTargetDecisions';
import styles from './TargetScreen.module.css';

function noticeKeyOf(view: TargetView | undefined): string | undefined {
  const check = view?.check;
  return check?.kind === 'suggestion' || check?.kind === 'kept' ? check.proposal.noticeKey : undefined;
}

/** @design S37 Target suggestion — your real maintenance, the new target to approve, and every target version. */
export default function TargetScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const view = useTargetView();
  const now = useNow();
  const { approve, keep, cancel, busy } = useTargetDecisions(view);

  // Opening S37 counts as seeing the Today notice for this suggestion.
  const noticeKey = noticeKeyOf(view);
  useEffect(() => {
    if (noticeKey) markTargetNoticeSeen(noticeKey);
  }, [noticeKey]);

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.insights, { replace: true }));

  if (!view) {
    return (
      <div className={styles.screen}>
        <SubScreenHeader title="Your target" onBack={back} />
        <div className={styles.loading}>
          <SkeletonList count={2} label="Loading your target" />
        </div>
      </div>
    );
  }

  const card = targetCardModel(view, { now, variant: 'full' });
  const pending = pendingModel(view, now);
  const status = statusModel(view, now);
  const history = historyRows(view);
  const slowerDetail = card?.slowerDetail;
  const statusAction = status?.action;

  return (
    <div className={styles.screen}>
      <SubScreenHeader title={screenTitle(view)} onBack={back} />

      {pending ? (
        <Card radius="card" padding="14px 16px" className={styles.card}>
          <h2 className={['t-insight', styles.headline].join(' ')}>{pending.headline}</h2>
          <p className={styles.body}>{pending.body}</p>
          {pending.weekLine ? <p className={styles.week}>{pending.weekLine}</p> : null}
          {pending.cancelLabel ? (
            <Button size="sm" variant="secondary" className={styles.action} onClick={() => void cancel(view)} disabled={busy}>
              {pending.cancelLabel}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {card ? (
        <TargetSuggestionCard
          className={styles.card}
          {...card.props}
          onApprove={() => void approve(view, 'suggested', now)}
          onKeep={card.kept ? undefined : () => void keep(view)}
          slowerPace={slowerDetail ? { detail: slowerDetail, onChoose: () => void approve(view, 'slowerPace', now) } : undefined}
          busy={busy}
        />
      ) : null}

      {status ? (
        <Card radius="card" padding="14px 16px" className={styles.card}>
          <h2 className={['t-insight', styles.headline].join(' ')}>{status.headline}</h2>
          {status.progress ? <UnlockProgress className={styles.progress} {...status.progress} /> : null}
          <p className={styles.body}>{status.body}</p>
          {status.working ? <p className={styles.working}>{status.working}</p> : null}
          {status.caption ? <p className={styles.caption}>{status.caption}</p> : null}
          {statusAction ? (
            <Button size="sm" variant="secondary" className={styles.action} onClick={() => navigate(statusAction.to)}>
              {statusAction.label}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {history.length > 0 ? (
        <>
          <SectionHeading>Target history</SectionHeading>
          <div className={styles.history}>
            <ul className={styles.list} aria-label="Target history">
              {history.map((row) => (
                <li key={row.key} className={styles.row}>
                  <span className={styles.rowText}>
                    <span className="t-item">{row.title}</span>
                    <span className={styles.sub}>{row.sub}</span>
                  </span>
                  {row.badge ? (
                    <Pill
                      className={styles.badge}
                      tone={row.badge.tone}
                      icon={row.badge.icon === 'now' ? <CircleCheck size={12} strokeWidth={2} /> : <Clock size={12} strokeWidth={2} />}
                    >
                      {row.badge.label}
                    </Pill>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      <p className={styles.footer}>Your target only changes when you approve a change.</p>
    </div>
  );
}
