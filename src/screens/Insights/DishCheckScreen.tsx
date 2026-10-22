import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ListChecks } from 'lucide-react';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { DishCheckRow } from '@/components/DishCheckRow/DishCheckRow';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { UnlockProgress } from '@/components/UnlockProgress/UnlockProgress';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useDishCheckView, type DishCheckView } from '@/db/dishCheck';
import { DISH_CHECK_MIN_DAYS, DISH_CHECK_MIN_DISHES } from '@/domain/dishCheck';
import { fmtInt } from '@/domain/format';
import { changeLine, doneBody, footerModel, kcalLabel, resultLine, rowDetail, summaryRows } from './dishCheckModel';
import { useDishCheckActions } from './useDishCheckActions';
import styles from './DishCheck.module.css';

const INTRO =
  "A one-time look at the dishes you log most. Tell the app if each number looks right, or if you usually have more or less. Meals you've already logged don't change.";

function DoneSummary({ view, onBack }: { view: DishCheckView; onBack: () => void }) {
  const { summary } = view;
  if (!summary) return null;
  return (
    <>
      <Card radius="card" padding="14px 16px" className={styles.summary}>
        <h2 className={['t-insight', styles.headline].join(' ')}>Top dishes checked</h2>
        <p className={styles.body}>{doneBody(view, view.tz, view.rolloverHour)}</p>
        <dl className={styles.counts}>
          {summaryRows(summary).map((row) => (
            <div key={row.label} className={styles.count}>
              <dt>{row.label}</dt>
              <dd>{fmtInt(row.count)}</dd>
            </div>
          ))}
        </dl>
        {summary.changes.length > 0 ? (
          <>
            <h3 className={styles.changesTitle}>What changed</h3>
            <ul className={styles.changes} aria-label="What changed">
              {summary.changes.map((change) => (
                <li key={change.key} className={styles.change}>
                  <span className={['t-item', styles.changeName].join(' ')}>{change.name}</span>
                  <span className={styles.changeNumbers}>{changeLine(change)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
      <div className={styles.backRow}>
        <Button size="lg" variant="secondary" onClick={onBack}>
          Back to Insights
        </Button>
      </div>
    </>
  );
}

/** @design S34 Top dishes check — your most-logged dishes, once: does each number look right, or do you have more or less? */
export default function DishCheckScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const view = useDishCheckView();
  const actions = useDishCheckActions(view);
  const [confirming, setConfirming] = useState(false);

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.insights, { replace: true }));
  const toInsights = () => navigate(PATHS.insights, { replace: true });

  if (!view) {
    return (
      <div className={styles.screen}>
        <SubScreenHeader title="Top dishes check" onBack={back} />
        <div className={styles.loading}>
          <SkeletonList count={3} label="Loading your dishes" />
        </div>
      </div>
    );
  }

  if (view.phase === 'locked' || view.phase === 'thin') {
    const locked = view.phase === 'locked';
    return (
      <div className={styles.screen}>
        <SubScreenHeader title="Top dishes check" onBack={back} />
        <div className={styles.empty}>
          <EmptyState
            icon={<ListChecks size={24} strokeWidth={2} />}
            headline={locked ? `Top dishes unlock at ${DISH_CHECK_MIN_DAYS} days` : 'Not enough repeats yet'}
            body={
              locked
                ? `Log meals on ${DISH_CHECK_MIN_DAYS} days and your most-logged dishes are ready to check.`
                : 'Dishes you log twice or more show up here. Keep logging and check back.'
            }
          />
          <Card radius="card" padding="12px 16px" className={styles.block}>
            {locked ? (
              <UnlockProgress label="Days logged" have={view.loggedDays} need={DISH_CHECK_MIN_DAYS} />
            ) : (
              <UnlockProgress label="Dishes logged twice or more" have={view.dishCount} need={DISH_CHECK_MIN_DISHES} unit="dishes" />
            )}
          </Card>
        </div>
      </div>
    );
  }

  if (view.phase === 'done') {
    return (
      <div className={styles.screen}>
        <SubScreenHeader title="Top dishes check" onBack={back} />
        <DoneSummary view={view} onBack={toInsights} />
      </div>
    );
  }

  const footer = footerModel(view);
  const busy = actions.busy();

  const finish = async () => {
    setConfirming(false);
    if (await actions.finish()) back();
  };
  const onFooter = () => {
    if (footer.label === 'Not now') back();
    else if (footer.confirm) setConfirming(true);
    else void finish();
  };

  return (
    <div className={[styles.screen, styles.withFooter].join(' ')}>
      <SubScreenHeader title="Top dishes check" onBack={back} />
      <p className={styles.intro}>{INTRO}</p>

      <Card radius="card" padding="12px 16px" className={styles.block}>
        <UnlockProgress label="Dishes checked" have={view.answered} need={view.total} valueLabel={`${fmtInt(view.answered)} of ${fmtInt(view.total)}`} />
      </Card>

      <h2 className="sr-only">Dishes</h2>
      {view.rows.length === 0 ? (
        <p className={styles.gone}>These dishes aren&apos;t in your diary any more.</p>
      ) : (
        <ul className={styles.list} aria-label="Dishes to check">
          {view.rows.map((row) => (
            <DishCheckRow
              key={row.key}
              name={row.name}
              kcalLabel={kcalLabel(row.kcal)}
              source={row.source}
              placeName={row.placeName}
              detail={rowDetail(row)}
              answer={row.answer}
              resultLine={resultLine(row)}
              busy={actions.busy(row.key)}
              onAnswer={(answer) => void actions.answer(row, answer)}
              onUndo={actions.canUndo(row.key) ? () => void actions.undo(row.key) : undefined}
            />
          ))}
        </ul>
      )}

      <div className={styles.stickyFooter}>
        <Button size="lg" variant={footer.variant} disabled={busy} onClick={onFooter}>
          {footer.label}
        </Button>
        {footer.caption ? <p className={styles.footerCaption}>{footer.caption}</p> : null}
      </div>

      <ConfirmDialog
        open={confirming && footer.confirm !== undefined}
        title={footer.confirm?.title ?? ''}
        body={footer.confirm?.body ?? ''}
        confirmLabel={footer.confirm?.confirmLabel ?? 'Finish'}
        cancelLabel={footer.confirm?.cancelLabel}
        onConfirm={() => void finish()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
