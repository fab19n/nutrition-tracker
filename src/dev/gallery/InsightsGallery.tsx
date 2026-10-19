import { useState, type CSSProperties, type ReactNode } from 'react';
import { EvidenceList, type EvidenceItem } from '@/components/EvidenceList/EvidenceList';
import { InsightCard } from '@/components/InsightCard/InsightCard';
import { RecurringList } from '@/components/RecurringRow/RecurringRow';
import { SuggestionCard, SurpriseCard } from '@/components/SuggestionCard/SuggestionCard';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md §9.7, §9.8)
// ---------------------------------------------------------------------------

const noop = () => {};

const DRINKS = {
  headline: 'Drinks were 17% of your calories',
  evidence: 'Teh tarik 8 times, milo ais 3 times, ~2,200 kcal.',
  linkLabel: 'See 11 drinks',
  tryText: 'kurang manis for half of them, about 300 kcal a week less',
  meta: 'Based on 7 days',
};

const NASI_KANDAR = {
  headline: 'Nasi kandar nights cost the most',
  evidence: '4 visits, ~950 kcal each vs 640 elsewhere.',
  linkLabel: 'See 4 visits',
  tryText: 'half rice there, or kuah sikit',
  meta: 'Based on 4 visits',
};

const LONG_DAYS = {
  headline: 'Long eating days ran higher',
  evidence: 'Days over 13 hours averaged +350 kcal.',
  linkLabel: 'See 3 days',
  tryText: 'an earlier first meal on WFH days',
  meta: 'Early read · based on 9 days',
};

const EVIDENCE_ITEMS: EvidenceItem[] = [
  { id: 'e1', dayLabel: 'Mon 5 Oct', slotLabel: 'Breakfast', timeLabel: '9:30am', name: 'Teh tarik · Kurang', kcalLabel: '~140' },
  { id: 'e2', dayLabel: 'Tue 6 Oct', slotLabel: 'Breakfast', timeLabel: '8:40am', name: 'Teh tarik · Normal', kcalLabel: '~200' },
  { id: 'e3', dayLabel: 'Sat 10 Oct', slotLabel: 'Breakfast', timeLabel: '10:30am', name: 'Milo ais · Normal', kcalLabel: '~250' },
  { id: 'e4', dayLabel: 'Sat 10 Oct', slotLabel: 'Dinner', timeLabel: '7:45pm', placeName: 'Medan selera nearby', name: 'Milo ais · Normal', kcalLabel: '~250' },
];

const EVIDENCE_BARS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => ({ label, kcal: [140, 200, 140, 200, 140, 700, 650][i] ?? 0 }));

// ---------------------------------------------------------------------------
// Gallery scaffolding (layout only; colours come from tokens)
// ---------------------------------------------------------------------------

const css = {
  section: { padding: '8px 0 24px' } satisfies CSSProperties,
  sectionTitle: { margin: 0, padding: '24px 20px 4px', fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  groupTitle: { margin: 0, padding: '18px 20px 6px', fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  state: { padding: '6px 16px 10px' } satisfies CSSProperties,
  caption: { display: 'block', padding: '0 4px 6px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  stack: { display: 'flex', flexDirection: 'column', gap: 10 } satisfies CSSProperties,
  sheet: { background: 'var(--bg)', borderRadius: 'var(--r-sheet) var(--r-sheet) 0 0', padding: '10px 16px 24px', boxShadow: 'inset 0 0 0 1px var(--line)' } satisfies CSSProperties,
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 style={css.groupTitle}>{title}</h3>
      {children}
    </div>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={css.state}>
      <span style={css.caption}>{label}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SuggestionStates() {
  const [logged, setLogged] = useState(false);
  return (
    <Group title="C40 SuggestionCard">
      <State label="C40 SuggestionCard / Your usual · fits (tap Log this for the logged state)">
        <SuggestionCard
          role="usual"
          name="Ayam bakar, half rice, ulam"
          reason="You had this 6 times this month"
          kcalLabel="~540 kcal"
          proteinLabel="38g protein"
          placeName="Medan selera nearby"
          fit="fits"
          logged={logged}
          onLog={() => setLogged(true)}
        />
      </State>
      <State label="C40 SuggestionCard / Lighter swap · tight fit">
        <SuggestionCard
          role="lighterSwap"
          name="Mee sup ayam instead of mee goreng"
          reason="Your Friday favourite, about 400 kcal lighter"
          kcalLabel="~430 kcal"
          proteinLabel="26g protein"
          placeName="Nasi kandar near home"
          fit="tightFit"
          onLog={noop}
        />
      </State>
      <State label="C40 SuggestionCard / Something different + Surprise me">
        <div style={css.stack}>
          <SuggestionCard
            role="different"
            name="3-egg omelette, sayur, small rice"
            reason="Not had in 12 days. Easy to make at home"
            kcalLabel="~510 kcal"
            proteinLabel="27g protein"
            placeName="Home"
            fit="fits"
            onLog={noop}
          />
          <SurpriseCard onPress={noop} />
        </div>
      </State>
    </Group>
  );
}

function InsightStates() {
  const [useful, setUseful] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  return (
    <Group title="C41 InsightCard">
      <State label="C41 InsightCard / New (Useful toggles, Not for me collapses)">
        <InsightCard
          {...DRINKS}
          onLink={noop}
          useful={useful}
          onUseful={() => setUseful((u) => !u)}
          dismissed={dismissed}
          onNotForMe={() => setDismissed(true)}
          onUndo={() => setDismissed(false)}
        />
      </State>
      <State label="C41 InsightCard / Marked useful">
        <InsightCard {...NASI_KANDAR} onLink={noop} useful onUseful={noop} onNotForMe={noop} />
      </State>
      <State label="C41 InsightCard / Early read">
        <InsightCard {...LONG_DAYS} onLink={noop} onUseful={noop} onNotForMe={noop} />
      </State>
      <State label="C41 InsightCard / Dismissed">
        <InsightCard {...LONG_DAYS} dismissed onUndo={noop} />
      </State>
      <State label="C41 InsightCard / Weekly review (no footer)">
        <InsightCard {...DRINKS} footer={false} meta={undefined} />
      </State>
    </Group>
  );
}

function EvidenceStates() {
  return (
    <Group title="C42 EvidenceList">
      <State label="C42 EvidenceList / Drinks this week, in a sheet">
        <div style={css.sheet}>
          <EvidenceList summary="11 drinks last week · ~2,170 kcal" bars={EVIDENCE_BARS} barsLabel="Drinks by day, most on Saturday" items={EVIDENCE_ITEMS} onOpen={noop} />
        </div>
      </State>
      <State label="C42 EvidenceList / Empty">
        <EvidenceList summary="Nothing logged behind this yet" items={[]} />
      </State>
    </Group>
  );
}

function RecurringStates() {
  return (
    <Group title="C43 RecurringRow">
      <State label="C43 RecurringRow / Recurring calories">
        <RecurringList
          label="Recurring calories"
          items={[
            { name: 'Teh tarik', frequencyLabel: '~8 a week', kcalLabel: '≈ 1,450' },
            { name: 'Roti canai', frequencyLabel: '~3 a week', kcalLabel: '≈ 900' },
            { name: 'Evening biscuits', frequencyLabel: '~5 a week', kcalLabel: '≈ 750' },
          ]}
        />
      </State>
    </Group>
  );
}

/** /dev section: suggestions and insights (C40–C43) in every state. */
export function InsightsGallery() {
  return (
    <section style={css.section} aria-labelledby="insights-gallery-title">
      <h2 id="insights-gallery-title" style={css.sectionTitle}>
        Suggestions and insights
      </h2>
      <SuggestionStates />
      <InsightStates />
      <EvidenceStates />
      <RecurringStates />
    </section>
  );
}
