import { useState, type CSSProperties, type ReactNode } from 'react';
import { CloudOff, CloudUpload, Info, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Segmented } from '@/components/ui/Segmented';
import { BottomNav, type NavTab } from '@/components/BottomNav/BottomNav';
import { DateSwitcher, SubScreenHeader, TopBar } from '@/components/TopBar/TopBar';
import { GoalPill } from '@/components/GoalPill/GoalPill';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { Toast } from '@/components/Toast/Toast';
import { Banner } from '@/components/Banner/Banner';
import { HeroCard, type HeroCardProps } from '@/components/HeroCard/HeroCard';
import { isBehind, MacroBar, MacroRow } from '@/components/MacroBar/MacroBar';
import { MetricRow, MetricTile } from '@/components/MetricTile/MetricTile';
import { WeekBars, type WeekBar } from '@/components/WeekBars/WeekBars';
import { WeightTrendChart, type WeightPoint, type WeightRange } from '@/components/WeightTrendChart/WeightTrendChart';
import { DayTimeline } from '@/components/DayTimeline/DayTimeline';
import { TimingGrid, type TimingGridRow } from '@/components/TimingGrid/TimingGrid';
import { CategoryList } from '@/components/CategoryBar/CategoryBar';
import { UnlockList } from '@/components/UnlockProgress/UnlockProgress';
import { fmtClock, fmtInt, fmtKg, fmtKgDelta, fmtSigned } from '@/domain/format';
import { emaTrend } from '@/domain/trend';
import { CHECK_IN_CAPTIONS, CheckInTimelineSample, pctOfDay } from './checkInSample';

/* ---------- Sample data (design_handoff.md §9): today is Fri 16 Oct, 7:10pm ---------- */

const TARGET = 1800;
const SAVED = 650;
const EATEN_TODAY = 1230;
const MAKAN_ROOM = 2450;
const LEFT_WEEK = 4820;

const thisWeek: WeekBar[] = [
  { label: 'M', kind: 'logged', valueKcal: 1620 },
  { label: 'T', kind: 'logged', valueKcal: 1710 },
  { label: 'W', kind: 'logged', valueKcal: 1540 },
  { label: 'T', kind: 'logged', valueKcal: 1680 },
  { label: 'F', kind: 'today', valueKcal: TARGET, fillKcal: EATEN_TODAY },
  { label: 'S', kind: 'makan', valueKcal: MAKAN_ROOM },
  { label: 'S', kind: 'planned', valueKcal: TARGET },
];

// Over example (ARCHITECTURE §5.6): a 2,110 day, Saturday's room shrinks to 2,140.
const OVER_EATEN = 2110;
const OVER_ROOM = 2140;
const overWeek: WeekBar[] = thisWeek.map((bar) => {
  if (bar.kind === 'today') return { ...bar, fillKcal: OVER_EATEN };
  if (bar.kind === 'makan') return { ...bar, valueKcal: OVER_ROOM };
  return bar;
});

const pausedWeek: WeekBar[] = [1620, 1710, 1540, 1680, EATEN_TODAY, 0, 0].map((kcal, i) => ({
  label: 'MTWTFSS'.charAt(i),
  kind: 'paused',
  valueKcal: kcal,
  isToday: i === 4,
}));

// Last week (5–11 Oct): 12,950 of 12,600, Saturday over, Sunday not counted (counts as 1,800).
const lastWeek: WeekBar[] = [
  { label: 'M', kind: 'logged', valueKcal: 1650 },
  { label: 'T', kind: 'logged', valueKcal: 1790 },
  { label: 'W', kind: 'logged', valueKcal: 1600 },
  { label: 'T', kind: 'logged', valueKcal: 1790 },
  { label: 'F', kind: 'logged', valueKcal: 1770 },
  { label: 'S', kind: 'over', valueKcal: 2550 },
  { label: 'S', kind: 'notCounted', valueKcal: 1450 },
];

const everyKind: WeekBar[] = [
  { label: 'M', kind: 'logged', valueKcal: 1620 },
  { label: 'T', kind: 'over', valueKcal: 2150 },
  { label: 'W', kind: 'notCounted', valueKcal: 1300 },
  { label: 'T', kind: 'paused', valueKcal: 1500 },
  { label: 'F', kind: 'today', valueKcal: TARGET, fillKcal: EATEN_TODAY },
  { label: 'S', kind: 'makan', valueKcal: MAKAN_ROOM },
  { label: 'S', kind: 'planned', valueKcal: TARGET },
];

const weekAria = `This week: Monday to Thursday under target, today ${fmtInt(EATEN_TODAY)} of ${fmtInt(TARGET)}, Saturday makan day with ${fmtInt(MAKAN_ROOM)} room`;

const weights = [78.6, 78.3, 78.5, 78.1, 78.2, 78.0, 79.0, 78.6, 78.2, 78.1, 77.9, 78.0, 77.7, 77.8];

/** Daily readings paired with the engine's trend (the same smoothing the Weight screen uses). */
function withTrend(values: number[]): WeightPoint[] {
  const trend = emaTrend(values);
  return values.map((kg, i) => ({ kg, trendKg: trend[i] ?? kg }));
}

const weightPoints = withTrend(weights);
/** The α = 0.25 EMA of this sample: 77.99, shown as 78.0 kg (the design's copy rounds it to 77.9). */
const latestTrend = weightPoints[weightPoints.length - 1]?.trendKg ?? 0;

/** [position %, dot size px, late?] per meal; one row per day, from the prototype's sample week. */
type DotSpec = [pct: number, sizePx: number, late?: boolean];
const timingSpec: [windowStartPct: number, windowLenPct: number, dots: DotSpec[]][] = [
  [16, 50, [[20, 8], [38, 10], [60, 9]]],
  [14, 55, [[18, 9], [40, 8], [62, 10]]],
  [18, 48, [[22, 7], [45, 10], [58, 8]]],
  [22, 44, [[26, 8], [50, 11]]],
  [19, 52, [[23, 7], [38, 9], [66, 10, true]]],
  [25, 58, [[30, 10], [55, 12], [78, 9, true]]],
  [20, 46, [[24, 8], [46, 10], [60, 9]]],
];

const timingRows: TimingGridRow[] = timingSpec.map(([windowStartPct, windowLenPct, dots], i) => ({
  label: 'MTWTFSS'.charAt(i),
  windowStartPct,
  windowLenPct,
  dots: dots.map(([pct, sizePx, late]) => ({ pct, sizePx, late })),
}));

/* ---------- Layout helpers (gallery only) ---------- */

const groupStyle: CSSProperties = { paddingBottom: 8 };
const specimenStyle: CSSProperties = { margin: '0 0 18px' };
const captionStyle: CSSProperties = { padding: '6px 20px 0', margin: 0 };
const insetStyle: CSSProperties = { padding: '0 16px' };
const rowStyle: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };

/** A transformed box becomes the containing block for position: fixed, so nav and toasts render in place. */
const frameStyle = (height: number): CSSProperties => ({
  position: 'relative',
  height,
  transform: 'translateZ(0)',
  overflow: 'hidden',
  background: 'var(--bg)',
  border: '1px dashed var(--dash)',
  borderRadius: 'var(--r-card)',
});

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={groupStyle} aria-label={title}>
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

function Specimen({ caption, children, inset = true }: { caption: string; children: ReactNode; inset?: boolean }) {
  return (
    <figure style={specimenStyle}>
      <div style={inset ? insetStyle : undefined}>{children}</div>
      <figcaption className="t-caption muted" style={captionStyle}>
        {caption}
      </figcaption>
    </figure>
  );
}

function Frame({ height, children }: { height: number; children: ReactNode }) {
  return <div style={frameStyle(height)}>{children}</div>;
}

const noop = () => {};

/* ---------- Sections ---------- */

function BottomNavSpecimens() {
  const [active, setActive] = useState<NavTab>('today');
  const [logs, setLogs] = useState(0);
  const states: { caption: string; active: NavTab; badges?: Partial<Record<NavTab, boolean>> }[] = [
    { caption: 'C01 BottomNav / Diary active', active: 'diary' },
    { caption: 'C01 BottomNav / Insights active', active: 'insights' },
    { caption: 'C01 BottomNav / More active', active: 'more' },
    { caption: 'C01 BottomNav / Badge (check-in waiting on Today)', active: 'today', badges: { today: true } },
  ];
  return (
    <Group title="C01 BottomNav">
      <Specimen caption={`C01 BottomNav / Today active (interactive: ${active}, Log tapped ${logs}×)`}>
        <Frame height={130}>
          <BottomNav active={active} onNavigate={setActive} onLog={() => setLogs((n) => n + 1)} />
        </Frame>
      </Specimen>
      {states.map((s) => (
        <Specimen key={s.caption} caption={s.caption}>
          <Frame height={130}>
            <BottomNav active={s.active} onNavigate={noop} onLog={noop} badges={s.badges} />
          </Frame>
        </Specimen>
      ))}
    </Group>
  );
}

function TopBarSpecimens() {
  const [view, setView] = useState<'day' | 'week'>('day');
  return (
    <Group title="C02 TopBar">
      <Specimen caption="C02 TopBar / Large title with date and GoalPill (Today)" inset={false}>
        <TopBar title="Today" subtitle="Fri 16 Oct" right={<GoalPill label={`Cut · ${fmtInt(TARGET)}`} onPress={noop} />} />
      </Specimen>
      <Specimen caption="C02 TopBar / Large title with Day/Week switch (Diary)" inset={false}>
        <TopBar
          title="Diary"
          right={
            <Segmented
              label="Diary view"
              value={view}
              onChange={setView}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
              ]}
            />
          }
        />
      </Specimen>
      <Specimen caption="C02 TopBar / Large title with Day/Week switch and search (Diary, S12)" inset={false}>
        <TopBar
          title="Diary"
          onSearch={noop}
          searchLabel="Search meals"
          right={
            <Segmented
              label="Diary view"
              value={view}
              onChange={setView}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
              ]}
            />
          }
        />
      </Specimen>
      <Specimen caption="C02 TopBar / Sub-screen with overflow (Entry detail)" inset={false}>
        <SubScreenHeader title="Entry" onBack={noop} backLabel="Back to Diary" onMore={noop} moreLabel="More for this entry" />
      </Specimen>
      <Specimen caption="C02 TopBar / Large title with caption (Insights)" inset={false}>
        <TopBar title="Insights" right={<span className="t-label muted">Week 3 · day 19</span>} />
      </Specimen>
      <Specimen caption="C02 TopBar / Sub-screen with back (Weight)" inset={false}>
        <SubScreenHeader title="Weight" onBack={noop} backLabel="Back to More" />
      </Specimen>
      <Specimen caption="C02 TopBar / Sub-screen with right text (Weekly review)" inset={false}>
        <SubScreenHeader title="Your week" onBack={noop} backLabel="Back to Insights" right="Step 1 of 3" />
      </Specimen>
      <Specimen caption="C02 TopBar / Date switcher, both sides (Diary day)" inset={false}>
        <DateSwitcher prevLabel="Thu" label="Fri 16 Oct · Today" nextLabel="Sat" onPrev={noop} onNext={noop} />
      </Specimen>
      <Specimen caption="C02 TopBar / Date switcher, next disabled (Diary week)" inset={false}>
        <DateSwitcher prevLabel="Last week" label="12–18 Oct · This week" onPrev={noop} />
      </Specimen>
    </Group>
  );
}

function GoalPillSpecimens() {
  return (
    <Group title="C03 GoalPill">
      <Specimen caption="C03 GoalPill / Cut · Lean bulk · Festive · Paused">
        <div style={rowStyle}>
          <GoalPill label={`Cut · ${fmtInt(TARGET)}`} onPress={noop} />
          <GoalPill label="Lean bulk · 130g" onPress={noop} />
          <GoalPill label={`Festive · ${fmtInt(2100)}`} onPress={noop} />
          <GoalPill label="Paused until Mon" onPress={noop} />
        </div>
      </Specimen>
      <Specimen caption="C03 GoalPill / A 40-character goal name: the pill shortens, the title stays" inset={false}>
        <TopBar title="Today" subtitle="Fri 16 Oct" right={<GoalPill label={`Cut before the Raya open houses begin · ${fmtInt(TARGET)}`} onPress={noop} />} />
      </Specimen>
    </Group>
  );
}

type SheetDemo = 'budget' | 'checkin' | 'tall' | null;

function BottomSheetSpecimens() {
  const [open, setOpen] = useState<SheetDemo>(null);
  const close = () => setOpen(null);
  return (
    <Group title="C04 BottomSheet">
      <Specimen caption="C04 BottomSheet / Dismissible: scrim, Escape and handle close it">
        <Button variant="secondary" size="pill" onClick={() => setOpen('budget')}>
          Open budget sheet
        </Button>
      </Specimen>
      <Specimen caption="C04 BottomSheet / Not dismissible (check-in): only Done closes it">
        <Button variant="secondary" size="pill" onClick={() => setOpen('checkin')}>
          Open check-in sheet
        </Button>
      </Specimen>
      <Specimen caption="C04 BottomSheet / Full height: content scrolls inside (max 92%)">
        <Button variant="secondary" size="pill" onClick={() => setOpen('tall')}>
          Open tall sheet
        </Button>
      </Specimen>

      <BottomSheet open={open === 'budget'} onClose={close} title="This week's budget">
        <SheetTitle>This week&apos;s budget</SheetTitle>
        <Card padding="4px 16px" style={{ marginTop: 12 }}>
          {[
            ['Weekly budget', fmtInt(TARGET * 7)],
            ['Eaten so far', fmtInt(7780)],
            ['Saved from finished days', fmtSigned(SAVED)],
            ['Left this week', fmtInt(LEFT_WEEK)],
          ].map(([label, value]) => (
            <div key={label} className="t-body" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </Card>
        <div style={{ marginTop: 14 }}>
          <Button onClick={close}>Change makan day</Button>
        </div>
      </BottomSheet>

      <BottomSheet open={open === 'checkin'} onClose={close} dismissible={false} maxHeight="92%" title="Morning check-in">
        <div className="muted" style={{ padding: '0 4px', fontSize: 13 }}>
          Good morning
        </div>
        <SheetTitle>Yesterday · 2 meals · {fmtInt(1240)} kcal</SheetTitle>
        <Card padding="14px 16px" style={{ marginTop: 12 }}>
          <CheckInTimelineSample captions={CHECK_IN_CAPTIONS} />
        </Card>
        <div style={{ marginTop: 16 }}>
          <Button onClick={close}>Done</Button>
        </div>
      </BottomSheet>

      <BottomSheet open={open === 'tall'} onClose={close} maxHeight="92%" title="All entries">
        <SheetTitle>All entries</SheetTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {Array.from({ length: 16 }, (_, i) => (
            <Card key={i} padding="14px 16px" className="t-item">
              Row {i + 1}
            </Card>
          ))}
        </div>
      </BottomSheet>
    </Group>
  );
}

function ToastSpecimens() {
  const [live, setLive] = useState(false);
  const states = [
    { caption: 'C05 Toast / Saved with Undo', message: `Saved · ~${fmtInt(880)} kcal`, undo: true, tone: 'default' as const },
    { caption: 'C05 Toast / Confirmation, no action', message: 'Saving for Saturday', undo: false, tone: 'default' as const },
    { caption: 'C05 Toast / Offline save', message: 'Saved offline, will sync', undo: true, tone: 'offline' as const },
    { caption: 'C05 Toast / Error with retry', message: "Couldn't save. Nothing was lost.", undo: true, tone: 'error' as const },
  ];
  return (
    <Group title="C05 Toast">
      {states.map((s) => (
        <Specimen key={s.caption} caption={s.caption}>
          <Frame height={170}>
            <Toast
              message={s.message}
              tone={s.tone}
              durationMs={null}
              onDismiss={noop}
              onUndo={s.undo ? noop : undefined}
              actionLabel={s.tone === 'error' ? 'Try again' : 'Undo'}
            />
            <BottomNav active="today" onNavigate={noop} onLog={noop} />
          </Frame>
        </Specimen>
      ))}
      <Specimen caption="C05 Toast / Auto-dismiss after 3.5s (live, over the page)">
        <Button variant="secondary" size="pill" onClick={() => setLive(true)}>
          Show a live toast
        </Button>
      </Specimen>
      {live ? <Toast message="Yesterday confirmed" onUndo={noop} onDismiss={() => setLive(false)} /> : null}
    </Group>
  );
}

function BannerSpecimens() {
  return (
    <Group title="C06 Banner">
      <Specimen caption="C06 Banner / Check-in waiting (amber, tappable)">
        <Banner tone="amber" actionLabel="Check" onPress={noop}>
          <b>Yesterday looks incomplete.</b> 2 meals, {fmtInt(1240)} kcal.
        </Banner>
      </Specimen>
      <Specimen caption="C06 Banner / Early read (accent)">
        <Banner tone="accent" icon={<Info size={16} strokeWidth={2} />}>
          <b>Early read.</b> Based on 9 days. Timing patterns unlock in 5 days.
        </Banner>
      </Specimen>
      <Specimen caption="C06 Banner / Viewing under another goal (accent, tappable)">
        <Banner tone="accent" actionLabel="Switch back" onPress={noop}>
          Viewing last month under Lean bulk. Your meals haven&apos;t changed.
        </Banner>
      </Specimen>
      <Specimen caption="C06 Banner / Offline (neutral)">
        <Banner tone="neutral" icon={<CloudOff size={16} strokeWidth={2} />}>
          <b>You&apos;re offline.</b> Logging still works.
        </Banner>
      </Specimen>
      <Specimen caption="C06 Banner / Sync waiting (neutral)">
        <Banner tone="neutral" icon={<CloudUpload size={16} strokeWidth={2} />}>
          3 entries waiting to sync.
        </Banner>
      </Specimen>
      <Specimen caption="C06 Banner / AI unavailable (neutral)">
        <Banner tone="neutral" icon={<Sparkles size={16} strokeWidth={2} />}>
          Estimates use your library for now. AI is unavailable.
        </Banner>
      </Specimen>
    </Group>
  );
}

const heroBase: HeroCardProps = {
  label: 'Left today',
  value: fmtInt(TARGET - EATEN_TODAY),
  savedLabel: fmtSigned(SAVED),
  leftWeekLabel: fmtInt(LEFT_WEEK),
  bars: { bars: thisWeek, targetKcal: TARGET, height: 64, ariaLabel: weekAria },
  captionLeft: `${fmtInt(EATEN_TODAY)} eaten · window closes ${fmtClock(22 * 60 + 40)}`,
  captionRight: `Sat: ${fmtInt(MAKAN_ROOM)} room`,
  onPress: noop,
  ariaLabel: `${fmtInt(TARGET - EATEN_TODAY)} kcal left today. Saved this week ${fmtSigned(SAVED)}. Left this week ${fmtInt(LEFT_WEEK)}. Opens the budget breakdown.`,
};

const heroStates: { caption: string; props: HeroCardProps }[] = [
  { caption: 'C07 HeroCard / Under', props: heroBase },
  {
    caption: 'C07 HeroCard / Near (10% or less left)',
    props: {
      ...heroBase,
      value: fmtInt(150),
      valueTone: 'near',
      note: "Close to today's budget",
      ariaLabel: `150 kcal left today, close to today's budget. Saved this week ${fmtSigned(SAVED)}. Opens the budget breakdown.`,
    },
  },
  {
    caption: 'C07 HeroCard / Over (covered by savings)',
    props: {
      ...heroBase,
      label: 'Over today',
      value: fmtSigned(OVER_EATEN - TARGET),
      valueTone: 'over',
      note: `Covered by your ${fmtSigned(SAVED)} saved`,
      leftWeekLabel: fmtInt(TARGET * 7 - 6550 - OVER_EATEN),
      bars: { ...heroBase.bars, bars: overWeek },
      captionLeft: `${fmtInt(OVER_EATEN)} eaten · window closes ${fmtClock(22 * 60 + 40)}`,
      captionRight: `Sat: ${fmtInt(OVER_ROOM)} room`,
      ariaLabel: `${fmtInt(OVER_EATEN - TARGET)} kcal over today, covered by your ${fmtSigned(SAVED)} saved. Opens the budget breakdown.`,
    },
  },
  {
    caption: 'C07 HeroCard / Lean bulk (protein left)',
    props: { ...heroBase, label: 'Protein left', value: '88g', ariaLabel: '88g protein left today. Opens the budget breakdown.' },
  },
  {
    caption: 'C07 HeroCard / Festive maintain (days in range)',
    props: { ...heroBase, label: 'Days in range', value: '5 of 7', ariaLabel: '5 of 7 days in range. Opens the budget breakdown.' },
  },
  {
    caption: 'C07 HeroCard / Pause (budget off)',
    props: {
      ...heroBase,
      label: 'Budget off',
      value: '—',
      valueTone: 'muted',
      note: 'Logging is optional this week',
      savedLabel: '—',
      savedTone: 'neutral',
      leftWeekLabel: '—',
      bars: { bars: pausedWeek, targetKcal: null, height: 64, ariaLabel: 'Paused week: logging is optional' },
      captionLeft: `${fmtInt(EATEN_TODAY)} eaten`,
      captionRight: undefined,
      ariaLabel: 'Budget off. Logging is optional this week. Opens the budget breakdown.',
    },
  },
];

function HeroSpecimens() {
  return (
    <Group title="C07 HeroCard">
      {heroStates.map((s) => (
        <Specimen key={s.caption} caption={s.caption}>
          <HeroCard {...s.props} />
        </Specimen>
      ))}
    </Group>
  );
}

function MacroSpecimens() {
  const today = [
    { label: 'Protein', value: 42, target: 110, macro: 'protein' as const },
    { label: 'Carbs', value: 145, target: 180, macro: 'carbs' as const },
    { label: 'Fat', value: 52, target: 60, macro: 'fat' as const },
  ];
  return (
    <Group title="C08 MacroBar">
      <Specimen caption="C08 MacroBar / Behind (protein) · On track (carbs, fat)">
        <MacroRow>
          {today.map((m) => (
            <MacroBar key={m.label} {...m} behind={isBehind(m.value, m.target)} />
          ))}
        </MacroRow>
      </Specimen>
      <Specimen caption="C08 MacroBar / Reached (protein, carbs) · On track (fat)">
        <MacroRow>
          <MacroBar label="Protein" value={112} target={110} macro="protein" reached />
          <MacroBar label="Carbs" value={180} target={180} macro="carbs" reached />
          <MacroBar label="Fat" value={58} target={60} macro="fat" />
        </MacroRow>
      </Specimen>
    </Group>
  );
}

function MetricSpecimens() {
  return (
    <Group title="C09 MetricTile">
      <Specimen caption="C09 MetricTile / Over · Good · Neutral, with sub-lines (Insights)">
        <MetricRow>
          <MetricTile label="Last week" value={fmtSigned(350)} tone="over" sub="over plan" />
          <MetricTile label="Trend" value={fmtKgDelta(-0.4)} tone="good" sub={`${fmtKg(latestTrend)} now`} />
          <MetricTile label="Complete" value="6 of 7" sub="days logged" />
        </MetricRow>
      </Specimen>
      <Specimen caption="C09 MetricTile / Neutral without sub · Good · Neutral (Weight)">
        <MetricRow>
          <MetricTile label="Trend" value={fmtKg(latestTrend)} />
          <MetricTile label="This week" value={fmtKgDelta(-0.4)} tone="good" />
          <MetricTile label="Plan" value="−0.5" sub="kg a week" />
        </MetricRow>
      </Specimen>
    </Group>
  );
}

function WeekBarsSpecimens() {
  const cards: { caption: string; bars: WeekBar[]; target: number | null; height: number; aria: string }[] = [
    { caption: 'C10 WeekBars / Diary week, this week (96px)', bars: thisWeek, target: TARGET, height: 96, aria: weekAria },
    {
      caption: 'C10 WeekBars / Weekly review, last week: over Sat, Sun not counted (72px)',
      bars: lastWeek,
      target: TARGET,
      height: 72,
      aria: 'Last week: 12,950 of 12,600, Saturday over, Sunday not counted',
    },
    {
      caption: 'C10 WeekBars / Every kind: logged, over, not counted, paused, today, makan, planned',
      bars: everyKind,
      target: TARGET,
      height: 96,
      aria: 'Every bar state',
    },
    {
      caption: 'C10 WeekBars / Today over target (fill turns amber)',
      bars: overWeek,
      target: TARGET,
      height: 64,
      aria: `Today ${fmtInt(OVER_EATEN)}, over the ${fmtInt(TARGET)} target`,
    },
    { caption: 'C10 WeekBars / Paused week, no target line', bars: pausedWeek, target: null, height: 64, aria: 'Paused week' },
  ];
  return (
    <Group title="C10 WeekBars">
      {cards.map((c) => (
        <Specimen key={c.caption} caption={c.caption}>
          <Card radius="lg" padding="16px 18px">
            <WeekBars bars={c.bars} targetKcal={c.target} height={c.height} ariaLabel={c.aria} />
          </Card>
        </Specimen>
      ))}
    </Group>
  );
}

function WeightSpecimens() {
  const [range, setRange] = useState<WeightRange>('14d');
  const aria = `Weight trend ${fmtKg(latestTrend)}, about ${fmtKgDelta(-0.5)} in 2 weeks`;
  return (
    <Group title="C11 WeightTrendChart">
      <Specimen caption={`C11 WeightTrendChart / With annotation (interactive range: ${range})`}>
        <WeightTrendChart
          points={weightPoints}
          annotation={{ index: 6, text: 'Monday jump: salt and water' }}
          range={range}
          onRangeChange={setRange}
          startLabel="3 Oct"
          endLabel="today"
          ariaLabel={aria}
        />
      </Specimen>
      <Specimen caption="C11 WeightTrendChart / 30d, no annotation">
        <WeightTrendChart points={weightPoints} range="30d" onRangeChange={noop} startLabel="17 Sep" endLabel="today" ariaLabel={aria} />
      </Specimen>
      <Specimen caption="C11 WeightTrendChart / First weigh-in (no trend yet)">
        <WeightTrendChart
          points={withTrend([78.6])}
          range="14d"
          onRangeChange={noop}
          startLabel="16 Oct"
          endLabel="today"
          ariaLabel="One weigh-in so far"
        />
      </Specimen>
    </Group>
  );
}

function TimelineSpecimens() {
  const breakfast = { pct: pctOfDay(10, 40), kcal: 560, tone: 'late' as const };
  const lunch = { pct: pctOfDay(14, 15), kcal: 670, tone: 'onTime' as const };
  const dinner = { pct: pctOfDay(19, 10), kcal: 880, tone: 'onTime' as const };
  const dayWindow = {
    windowStartPct: pctOfDay(10, 40),
    windowEndPct: pctOfDay(22, 40),
    header: { left: `Window opened ${fmtClock(10 * 60 + 40)}`, right: `closes ${fmtClock(22 * 60 + 40)}` },
  };
  return (
    <Group title="C12 DayTimeline">
      <Specimen caption="C12 DayTimeline / Diary day in progress (late breakfast, now marker)">
        <Card padding="12px 16px">
          <DayTimeline
            {...dayWindow}
            dots={[breakfast, lunch]}
            nowPct={pctOfDay(19, 10)}
            captions={['5am', 'now', '5am']}
            ariaLabel="Window 10:40am to 10:40pm. Breakfast 10:40am, late for you. Lunch 2:15pm, on time. Now 7:10pm."
          />
        </Card>
      </Specimen>
      <Specimen caption="C12 DayTimeline / Dinner logged (dot sized by kcal)">
        <Card padding="12px 16px">
          <DayTimeline
            {...dayWindow}
            dots={[breakfast, lunch, dinner]}
            nowPct={pctOfDay(19, 12)}
            captions={['5am', 'now', '5am']}
            ariaLabel="Window 10:40am to 10:40pm. Three meals, dinner at 7:10pm."
          />
        </Card>
      </Specimen>
      <Specimen caption="C12 DayTimeline / Check-in gap (wake and sleep captions)">
        <Card padding="14px 16px">
          <CheckInTimelineSample captions={CHECK_IN_CAPTIONS} />
        </Card>
      </Specimen>
      <Specimen caption="C12 DayTimeline / Empty day (now marker only)">
        <Card padding="12px 16px">
          <DayTimeline dots={[]} nowPct={pctOfDay(8, 5)} captions={['5am', 'now', '5am']} ariaLabel="Nothing logged yet today" />
        </Card>
      </Specimen>
    </Group>
  );
}

function TimingSpecimens() {
  const axis = ['5am', 'noon', '6pm', 'midnight'];
  return (
    <Group title="C13 TimingGrid">
      <Specimen caption="C13 TimingGrid / Early read (late dots amber)">
        <TimingGrid
          rows={timingRows}
          headerLeft="Average window 10.4 h"
          headerRight="Early read · 9 days"
          axisLabels={axis}
          ariaLabel="Eating windows this week, average 10.4 hours. Late dinners on Friday and Saturday."
        />
      </Specimen>
      <Specimen caption="C13 TimingGrid / Established read">
        <TimingGrid rows={timingRows} headerLeft="Average window 10.4 h" headerRight="Based on 28 days" axisLabels={axis} />
      </Specimen>
    </Group>
  );
}

function CategorySpecimens() {
  return (
    <Group title="C14 CategoryBar">
      <Specimen caption="C14 CategoryBar / Default rows · Highlighted (Drinks)">
        <CategoryList
          label="Where it came from"
          items={[
            { name: 'Rice dishes', pct: 38 },
            { name: 'Home cooking', pct: 18 },
            { name: 'Drinks', pct: 17, highlighted: true },
            { name: 'Noodles', pct: 14 },
            { name: 'Snacks and kuih', pct: 13 },
          ]}
        />
      </Specimen>
    </Group>
  );
}

function UnlockSpecimens() {
  return (
    <Group title="C15 UnlockProgress">
      <Specimen caption="C15 UnlockProgress / Locked (9 of 14 · 9 of 21)">
        <UnlockList
          items={[
            { label: 'Timing patterns', have: 9, need: 14 },
            { label: 'Your real maintenance', have: 9, need: 21 },
          ]}
        />
      </Specimen>
      <Specimen caption="C15 UnlockProgress / Unlocked">
        <UnlockList items={[{ label: 'Timing patterns', have: 14, need: 14 }]} />
      </Specimen>
    </Group>
  );
}

/** Structure, numbers and charts: C01–C15 in every listed state. */
export function StructureGallery() {
  return (
    <div>
      <BottomNavSpecimens />
      <TopBarSpecimens />
      <GoalPillSpecimens />
      <BottomSheetSpecimens />
      <ToastSpecimens />
      <BannerSpecimens />
      <HeroSpecimens />
      <MacroSpecimens />
      <MetricSpecimens />
      <WeekBarsSpecimens />
      <WeightSpecimens />
      <TimelineSpecimens />
      <TimingSpecimens />
      <CategorySpecimens />
      <UnlockSpecimens />
    </div>
  );
}
