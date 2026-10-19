import { useState, type CSSProperties, type ReactNode } from 'react';
import { LearnedDefaultList, LearnedDefaultRow } from '@/components/LearnedDefaultRow/LearnedDefaultRow';
import { PlaceCard, PlaceTypePill } from '@/components/PlaceCard/PlaceCard';
import { UsualOrderList, UsualOrderRow } from '@/components/UsualOrderRow/UsualOrderRow';
import type { PlaceType } from '@/domain/types';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md §9.4, §9.5)
// ---------------------------------------------------------------------------

const noop = () => {};
const PLACE_TYPES: PlaceType[] = ['mamak', 'economyRice', 'kopitiam', 'hawker', 'home', 'other'];

// ---------------------------------------------------------------------------
// Gallery scaffolding (layout only; colours come from tokens)
// ---------------------------------------------------------------------------

const css = {
  section: { padding: '8px 0 24px' } satisfies CSSProperties,
  sectionTitle: { margin: 0, padding: '24px 20px 4px', fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  groupTitle: { margin: 0, padding: '18px 20px 6px', fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  state: { padding: '6px 16px 10px' } satisfies CSSProperties,
  caption: { display: 'block', padding: '0 4px 6px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } satisfies CSSProperties,
  log: { margin: '8px 0 0', padding: '0 4px', fontSize: 12, color: 'var(--muted)' } satisfies CSSProperties,
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

function PlaceCardStates() {
  const [log, setLog] = useState('Tap a card to open the Place.');
  const open = (name: string) => () => setLog(`Opened: ${name}`);
  return (
    <Group title="C34 PlaceCard">
      <State label="C34 PlaceCard / Mamak · regular, higher than elsewhere">
        <PlaceCard
          name="Nasi kandar near home"
          type="mamak"
          visitsLabel="14 visits"
          avgLabel="~920"
          elsewhereLabel="~640"
          spendLabel="RM 58.00 this week"
          onPress={open('Nasi kandar near home')}
        />
      </State>
      <State label="C34 PlaceCard / Economy rice">
        <PlaceCard
          name="Kedai near home"
          type="economyRice"
          visitsLabel="9 visits"
          avgLabel="~640"
          elsewhereLabel="~520"
          spendLabel="RM 27.00 this week"
          onPress={open('Kedai near home')}
        />
      </State>
      <State label="C34 PlaceCard / Hawker · new, still learning">
        <PlaceCard
          name="Medan selera nearby"
          type="hawker"
          visitsLabel="2 visits"
          avgLabel="~850"
          elsewhereLabel="~520"
          spendLabel="RM 11.00 this week"
          learning
          onPress={open('Medan selera nearby')}
        />
      </State>
      <State label="C34 PlaceCard / Home · no prices">
        <PlaceCard name="Home" type="home" visitsLabel="24 visits" avgLabel="~420" elsewhereLabel="~600" onPress={open('Home')} />
      </State>
      <State label="C34 PlaceCard / Kopitiam · no visits yet">
        <PlaceCard name="Kopitiam Ah Seng" type="kopitiam" visitsLabel="No visits" learning onPress={open('Kopitiam Ah Seng')} />
        <p style={css.log} aria-live="polite">
          {log}
        </p>
      </State>
      <State label="C34 PlaceTypePill / Every type">
        <div style={css.row}>
          {PLACE_TYPES.map((type) => (
            <PlaceTypePill key={type} type={type} />
          ))}
        </div>
      </State>
    </Group>
  );
}

function UsualOrderStates() {
  const [logged, setLogged] = useState(false);
  return (
    <Group title="C35 UsualOrderRow">
      <State label="C35 UsualOrderRow / Log · Logged today, Log again (tap Log)">
        <UsualOrderList label="Your usual orders">
          <UsualOrderRow name="Nasi kandar ayam goreng" detail="Kuah campur · 9 times · ~950 kcal" logged={logged} onLog={() => setLogged(true)} />
          <UsualOrderRow name="Roti telur + dhal" detail="4 times · ~420 kcal" onLog={noop} />
          <UsualOrderRow name="Teh o ais kurang" detail="12 times · ~60 kcal" logged onLog={noop} />
        </UsualOrderList>
      </State>
      <State label="C35 UsualOrderRow / Pot serving (Log 1) · saving">
        <UsualOrderList label="Pots at home">
          <UsualOrderRow name="Kari ayam pot" detail="3 of 8 left · ~500 a serving · clears Sun" logLabel="Log 1" actionLabel="Log 1 serving of Kari ayam" onLog={noop} />
          <UsualOrderRow name="Sup sayur pot" detail="5 of 6 left · ~90 a serving · clears tomorrow" logLabel="Log 1" actionLabel="Log 1 serving of Sup sayur" busy onLog={noop} />
        </UsualOrderList>
      </State>
    </Group>
  );
}

function LearnedDefaultStates() {
  const [rows, setRows] = useState([
    { key: 'rice', label: 'Rice (nasi kandar)', value: 'Mamak big, +30%' },
    { key: 'kuah', label: 'Kuah campur', value: 'Banjir, +80%' },
  ]);
  const [log, setLog] = useState('Change opens the chips; Remove shows an undo toast on the screen.');
  return (
    <Group title="C36 LearnedDefaultRow">
      <State label="C36 LearnedDefaultRow / Portion and kuah (Change · Remove)">
        <LearnedDefaultList label="What you've taught it">
          {rows.map((row) => (
            <LearnedDefaultRow
              key={row.key}
              label={row.label}
              value={row.value}
              onChange={() => setLog(`Change: ${row.label}`)}
              onRemove={() => {
                setRows((current) => current.filter((r) => r.key !== row.key));
                setLog(`Removed: ${row.label} · Undo`);
              }}
            />
          ))}
        </LearnedDefaultList>
        <p style={css.log} aria-live="polite">
          {log}
        </p>
      </State>
      <State label="C36 LearnedDefaultRow / Your version, no chips (Remove only)">
        <LearnedDefaultList label="Saved here">
          <LearnedDefaultRow label="Kari ayam, home style" value="Your version · ~420" onRemove={noop} />
        </LearnedDefaultList>
      </State>
    </Group>
  );
}

/** C34–C36 in every state, with the design's sample Places (design_handoff.md §9.4). */
export function PlacesGallery() {
  return (
    <section style={css.section} aria-labelledby="places-gallery-title">
      <h2 id="places-gallery-title" style={css.sectionTitle}>
        Places
      </h2>
      <PlaceCardStates />
      <UsualOrderStates />
      <LearnedDefaultStates />
    </section>
  );
}
