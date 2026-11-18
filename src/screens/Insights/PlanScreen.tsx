import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { MetricRow, MetricTile } from '@/components/MetricTile/MetricTile';
import { PlanChart } from '@/components/PlanChart/PlanChart';
import { SkeletonList } from '@/components/Skeleton/Skeleton';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { usePlanView } from '@/db/planProgress';
import { planScreenModel, type PlanCheckModel, type PlanRow } from './planModel';
import styles from './PlanScreen.module.css';

function Rows({ rows, label }: { rows: PlanRow[]; label: string }) {
  return (
    <dl className={styles.rows} aria-label={label}>
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className={styles.row}>
          <div className={styles.rowText}>
            <dt className={styles.rowLabel}>{row.label}</dt>
            {row.sub ? <dd className={styles.rowSub}>{row.sub}</dd> : null}
          </div>
          <dd className={[styles.rowValue, row.tone ? styles[row.tone] : ''].filter(Boolean).join(' ')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CheckCard({ check }: { check: PlanCheckModel }) {
  return (
    <Card radius="card" padding="14px 16px" className={styles.card}>
      <div className={styles.checkHead}>
        <h2 className={['t-insight', styles.headline].join(' ')}>{check.headline}</h2>
        {check.badge ? <span className={styles.badge}>{check.badge}</span> : null}
      </div>
      <p className={styles.body}>{check.body}</p>
      {check.progress !== undefined ? (
        <div className={styles.meter} role="progressbar" aria-label="Days toward the check" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(check.progress * 100)}>
          <div className={styles.meterFill} style={{ width: `${Math.round(check.progress * 100)}%` }} />
        </div>
      ) : null}
      {check.rows.length > 0 ? <Rows rows={check.rows} label="Your logs against your weight" /> : null}
      {check.extras.map((line) => (
        <p key={line} className={styles.caption}>
          {line}
        </p>
      ))}
    </Card>
  );
}

/** @design Your plan — where you stand against the goal you picked, and what workouts add to it. */
export default function PlanScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const view = usePlanView();
  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.insights, { replace: true }));

  if (!view) {
    return (
      <div className={styles.screen}>
        <SubScreenHeader title="Your plan" onBack={back} />
        <div className={styles.loading}>
          <SkeletonList count={3} label="Loading your plan" />
        </div>
      </div>
    );
  }

  const model = planScreenModel(view);
  const { weight, energy, workouts, check } = model;
  const { actual, plan } = view.progress.weight;

  return (
    <div className={styles.screen}>
      <SubScreenHeader title="Your plan" onBack={back} />

      <Card radius="card" padding="14px 16px" className={styles.card}>
        <p className={styles.eyebrow}>{model.name}</p>
        <p className={styles.since}>{model.since}</p>
        {model.facts.length > 0 ? <p className={styles.facts}>{model.facts.join(' · ')}</p> : null}
      </Card>

      {model.paused ? (
        <Card radius="card" padding="14px 16px" className={styles.card}>
          <h2 className={['t-insight', styles.headline].join(' ')}>Your plan is paused</h2>
          <p className={styles.body}>A paused goal has no budget and no pace to read against. Switch goals under More › Goals to see progress again.</p>
        </Card>
      ) : (
        <>
          <SectionHeading>Weight</SectionHeading>
          <Card radius="card" padding="14px 16px" className={styles.card}>
            <h2 className={['t-insight', styles.headline, weight.tone === 'good' ? styles.good : ''].filter(Boolean).join(' ')}>{weight.headline}</h2>
            <p className={styles.body}>{weight.note}</p>
          </Card>
          {weight.tiles.length > 0 ? (
            <MetricRow className={styles.tiles}>
              {weight.tiles.map((t) => (
                <MetricTile key={t.label} label={t.label} value={t.value} tone={t.tone} {...(t.sub ? { sub: t.sub } : {})} />
              ))}
            </MetricRow>
          ) : null}
          {weight.chart ? (
            <PlanChart className={styles.card} actual={actual} plan={plan} startLabel={weight.chart.startLabel} endLabel={weight.chart.endLabel} ariaLabel={weight.chart.ariaLabel} />
          ) : null}
          {weight.end ? (
            <Card radius="card" padding="14px 16px" className={styles.card}>
              <h3 className={styles.cardLabel}>{weight.end.title}</h3>
              {weight.end.lines.map((line) => (
                <p key={line} className={styles.line}>
                  {line}
                </p>
              ))}
            </Card>
          ) : null}

          <SectionHeading>Calories against your budget</SectionHeading>
          <p className={styles.intro}>{energy.note}</p>
          {energy.empty ? (
            <p className={styles.quiet}>{energy.empty}</p>
          ) : (
            <>
              <MetricRow className={styles.tiles}>
                {energy.tiles.map((t) => (
                  <MetricTile key={t.label} label={t.label} value={t.value} tone={t.tone} {...(t.sub ? { sub: t.sub } : {})} />
                ))}
              </MetricRow>
              <Card radius="card" padding="4px 16px" className={styles.card}>
                <h3 className={[styles.cardLabel, styles.listLabel].join(' ')}>Week by week</h3>
                <Rows rows={energy.weeks} label="Week by week" />
              </Card>
            </>
          )}

          <SectionHeading>What workouts changed</SectionHeading>
          {workouts.empty ? (
            <p className={styles.quiet}>{workouts.empty}</p>
          ) : (
            <Card radius="card" padding="4px 16px" className={styles.card}>
              <Rows rows={workouts.rows} label="What workouts changed" />
            </Card>
          )}
          <p className={[styles.intro, workouts.empty ? '' : styles.introAfter].filter(Boolean).join(' ')}>{workouts.note}</p>

          <SectionHeading>A reality check</SectionHeading>
          <CheckCard check={check} />
        </>
      )}
    </div>
  );
}
