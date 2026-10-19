import { useState, type CSSProperties, type ReactNode } from 'react';
import { UsualCard, UsualSuggestionCard } from '@/components/UsualCard/UsualCard';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md §9.4–9.5: the demo Usuals and Places)
// ---------------------------------------------------------------------------

const noop = () => {};

interface SampleUsual {
  name: string;
  itemsLabel: string;
  kcalLabel: string;
  placeName?: string;
  useCount: number;
}

const ROTI: SampleUsual = {
  name: 'Roti canai + teh tarik',
  itemsLabel: 'Roti canai + dhal · Teh tarik',
  kcalLabel: '~560 kcal',
  placeName: 'Nasi kandar near home',
  useCount: 6,
};
// One item named like the Usual: the screen passes an empty items line, so the name isn't said twice.
const BREAD: SampleUsual = { name: 'Bread, kaya, kopi', itemsLabel: '', kcalLabel: '~380 kcal', placeName: 'Home', useCount: 5 };
const NASI_LEMAK: SampleUsual = { name: 'Nasi lemak bungkus', itemsLabel: '', kcalLabel: '~490 kcal', useCount: 4 };
const TEH_O: SampleUsual = { name: 'Teh o ais kurang', itemsLabel: '', kcalLabel: '~60 kcal', useCount: 3 };
const NEW_ONE: SampleUsual = { name: 'Mee goreng mamak', itemsLabel: 'Mee goreng mamak small', kcalLabel: '~650 kcal', useCount: 0 };
const LONG: SampleUsual = {
  name: 'Nasi kandar ayam goreng, kuah campur banjir, telur mata',
  itemsLabel: 'Nasi kandar rice mamak big · Ayam goreng · Kuah campur banjir · Telur mata · Teh o ais kurang',
  kcalLabel: '~1,190 kcal',
  placeName: 'Nasi kandar near home',
  useCount: 12,
};

// ---------------------------------------------------------------------------
// Gallery scaffolding (layout only; colours come from tokens)
// ---------------------------------------------------------------------------

const css = {
  section: { padding: '8px 0 24px' } satisfies CSSProperties,
  sectionTitle: { margin: 0, padding: '24px 20px 4px', fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  groupTitle: { margin: 0, padding: '18px 20px 6px', fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  state: { padding: '6px 16px 10px' } satisfies CSSProperties,
  caption: { display: 'block', padding: '0 4px 6px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  stack: { display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 } satisfies CSSProperties,
  note: { margin: '6px 4px 0', fontSize: 12, color: 'var(--muted)' } satisfies CSSProperties,
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
// Live wrappers so the menu's moves, delete and Log can be tapped through
// ---------------------------------------------------------------------------

/** The demo list, reorderable from each card's menu (Move up / Move down / Delete). */
function LiveUsualList() {
  const [list, setList] = useState<SampleUsual[]>([ROTI, BREAD, NASI_LEMAK, TEH_O]);
  const [note, setNote] = useState('Open a card menu to move or delete it.');
  const move = (from: number, to: number) =>
    setList((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  return (
    <>
      <ul style={css.stack}>
        {list.map((usual, index) => (
          <li key={usual.name}>
            <UsualCard
              {...usual}
              onLog={() => setNote(`Log ${usual.name} → review screen`)}
              onEdit={() => setNote(`Edit ${usual.name} → editor sheet`)}
              {...(index > 0 ? { onMoveUp: () => move(index, index - 1) } : {})}
              {...(index < list.length - 1 ? { onMoveDown: () => move(index, index + 1) } : {})}
              onDelete={() => {
                setList((current) => current.filter((u) => u.name !== usual.name));
                setNote(`Deleted ${usual.name} (the screen shows an Undo toast)`);
              }}
            />
          </li>
        ))}
      </ul>
      <p style={css.note} aria-live="polite">
        {note}
      </p>
    </>
  );
}

function LiveSuggestion() {
  const [answer, setAnswer] = useState<'saved' | 'dismissed' | null>(null);
  if (answer) {
    return (
      <p style={css.note}>
        {answer === 'saved' ? 'Saved as a Usual' : 'Suggestion hidden'} ·{' '}
        <button type="button" onClick={() => setAnswer(null)} style={{ color: 'var(--accent-text)', fontWeight: 600 }}>
          Show again
        </button>
      </p>
    );
  }
  return (
    <UsualSuggestionCard
      name="Bread, kaya, kopi"
      times={4}
      kcalLabel="~380 kcal"
      placeName="Home"
      onSave={() => setAnswer('saved')}
      onDismiss={() => setAnswer('dismissed')}
    />
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function UsualCardStates() {
  return (
    <Group title="C37 UsualCard">
      <State label="C37 UsualCard / Default (Place, used 6 times)">
        <UsualCard {...ROTI} onLog={noop} onEdit={noop} onMoveDown={noop} onDelete={noop} />
      </State>
      <State label="C37 UsualCard / No Place, one item (no items line; menu: Edit, Move up, Move down, Delete)">
        <UsualCard {...NASI_LEMAK} onLog={noop} onEdit={noop} onMoveUp={noop} onMoveDown={noop} onDelete={noop} />
      </State>
      <State label="C37 UsualCard / Last in the list (no Move down)">
        <UsualCard {...TEH_O} onLog={noop} onEdit={noop} onMoveUp={noop} onDelete={noop} />
      </State>
      <State label="C37 UsualCard / New, not used yet">
        <UsualCard {...NEW_ONE} onLog={noop} onEdit={noop} onMoveUp={noop} onDelete={noop} />
      </State>
      <State label="C37 UsualCard / Long name and items (wraps)">
        <UsualCard {...LONG} onLog={noop} onEdit={noop} onMoveUp={noop} onMoveDown={noop} onDelete={noop} />
      </State>
      <State label="C37 UsualCard / Log starting (busy)">
        <UsualCard {...BREAD} busy onLog={noop} onEdit={noop} onMoveUp={noop} onMoveDown={noop} onDelete={noop} />
      </State>
      <State label="C37 UsualCard / List with keyboard reordering (live)">
        <LiveUsualList />
      </State>
    </Group>
  );
}

function SuggestionStates() {
  return (
    <Group title="C37 UsualCard (suggested)">
      <State label="C37 UsualSuggestionCard / Suggested (Save or Not now, live)">
        <LiveSuggestion />
      </State>
      <State label="C37 UsualSuggestionCard / Saving (busy)">
        <UsualSuggestionCard
          name="Nasi kandar ayam goreng"
          times={9}
          kcalLabel="~950 kcal"
          placeName="Nasi kandar near home"
          busy
          onSave={noop}
          onDismiss={noop}
        />
      </State>
      <State label="C37 UsualSuggestionCard / No Place">
        <UsualSuggestionCard name="Mee goreng mamak" times={3} kcalLabel="~830 kcal" onSave={noop} onDismiss={noop} />
      </State>
    </Group>
  );
}

export function UsualsGallery() {
  return (
    <section style={css.section} aria-labelledby="usuals-gallery-title">
      <h2 id="usuals-gallery-title" style={css.sectionTitle}>
        Usuals
      </h2>
      <UsualCardStates />
      <SuggestionStates />
    </section>
  );
}
