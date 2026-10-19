import { useState, type CSSProperties, type ReactNode } from 'react';
import { IngredientRow } from '@/components/IngredientRow/IngredientRow';
import { PotCard } from '@/components/PotCard/PotCard';
import type { PotIngredient } from '@/domain/types';
import { OIL_TBSP_CHOICES, kcalPerServing, oilIngredient, oilTbsp, splitRecipe, withIngredientKcal } from '@/estimate/recipe';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md §9.5): the kari ayam pot, cooked Wednesday, 3 of 8 left,
// ~500 kcal a serving, clears Sunday. Ingredients come from the real splitter.
// ---------------------------------------------------------------------------

const RECIPE = '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang';
const KARI_AYAM = splitRecipe(RECIPE, { makeId: (i) => `gallery-${i}` });
const PER_SERVING = kcalPerServing(KARI_AYAM, 8);

function sample(name: string): PotIngredient {
  const found = KARI_AYAM.find((i) => i.name === name);
  if (!found) throw new Error(`Gallery sample has no ${name}`);
  return found;
}

const AYAM = sample('Ayam');
const KENTANG = sample('Kentang');
const OIL = sample('Cooking oil');
const REMPAH = sample('Rempah and bawang');
const [BERAS] = splitRecipe('2 cawan beras', { makeId: () => 'gallery-beras' });
const KENTANG_EDITED: PotIngredient = withIngredientKcal({ ...KENTANG, amount: '4 biji' }, 460);
const OIL_THREE: PotIngredient = { ...oilIngredient(3, 'gallery-oil-3') };

const noop = () => {};

// ---------------------------------------------------------------------------
// Gallery scaffolding (layout only; colours come from tokens)
// ---------------------------------------------------------------------------

const css = {
  section: { padding: '8px 0 24px' } satisfies CSSProperties,
  sectionTitle: { margin: 0, padding: '24px 20px 4px', fontSize: 20, fontWeight: 700 } satisfies CSSProperties,
  groupTitle: { margin: 0, padding: '18px 20px 6px', fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  state: { padding: '6px 16px 10px' } satisfies CSSProperties,
  caption: { display: 'block', padding: '0 4px 6px', fontSize: 11, fontWeight: 600, color: 'var(--muted)' } satisfies CSSProperties,
  stack: { display: 'flex', flexDirection: 'column', gap: 8 } satisfies CSSProperties,
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

function PotCardStates() {
  const [left, setLeft] = useState(3);
  const [opened, setOpened] = useState(0);
  const card = { name: 'Kari ayam', servings: 8, kcalPerServing: PER_SERVING };
  return (
    <Group title="C38 PotCard">
      <State label={`C38 PotCard / Clears Sunday (interactive: ${left} left, opened ${opened}×)`}>
        <PotCard
          {...card}
          servingsLeft={left}
          state={left > 0 ? 'active' : 'cleared'}
          clearsText={left > 0 ? 'Clears Sunday' : 'Cleared'}
          onLog={() => setLeft((n) => Math.max(0, n - 1))}
          onOpen={() => setOpened((n) => n + 1)}
        />
      </State>
      <State label="C38 PotCard / Clears today">
        <PotCard {...card} servingsLeft={2} state="clearsToday" clearsText="Clears today" onLog={noop} onOpen={noop} />
      </State>
      <State label="C38 PotCard / Half a serving left">
        <PotCard {...card} servingsLeft={0.5} state="clearsToday" clearsText="Clears today" onLog={noop} onOpen={noop} />
      </State>
      <State label="C38 PotCard / Saving a serving (busy)">
        <PotCard {...card} servingsLeft={3} state="active" clearsText="Clears Sunday" onLog={noop} onOpen={noop} busy />
      </State>
      <State label="C38 PotCard / Cleared (all eaten)">
        <PotCard {...card} servingsLeft={0} state="cleared" clearsText="Cleared" onLog={noop} onOpen={noop} />
      </State>
      <State label="C38 PotCard / Cleared (past 4 days, servings left)">
        <PotCard {...card} servingsLeft={2} state="cleared" clearsText="Cleared" onOpen={noop} />
      </State>
      <State label="C38 PotCard / Big pot (16 servings, meter in proportion)">
        <PotCard name="Bubur ayam" servings={16} servingsLeft={11} kcalPerServing={310} state="active" clearsText="Clears tomorrow" onLog={noop} onOpen={noop} />
      </State>
    </Group>
  );
}

function IngredientRowStates() {
  const [oil, setOil] = useState<PotIngredient>(OIL);
  const [ayam, setAyam] = useState<PotIngredient>(AYAM);
  return (
    <Group title="C39 IngredientRow">
      <State label="C39 IngredientRow / Catalogue (interactive: edit or remove)">
        <IngredientRow
          ingredient={ayam}
          onSave={(edit) => setAyam(edit.kcal !== undefined ? withIngredientKcal({ ...ayam, name: edit.name, amount: edit.amount }, edit.kcal) : { ...ayam, name: edit.name, amount: edit.amount })}
          onRemove={noop}
        />
      </State>
      <State label="C39 IngredientRow / Merged rempah and bawang">
        <IngredientRow ingredient={REMPAH} onSave={noop} onRemove={noop} />
      </State>
      <State label="C39 IngredientRow / Oil with spoon chips (interactive)">
        <IngredientRow
          ingredient={oil}
          onSave={noop}
          onRemove={noop}
          oil={{ choices: OIL_TBSP_CHOICES, selected: oilTbsp(oil), onSelect: (tbsp) => setOil(oilIngredient(tbsp, OIL.id)) }}
        />
      </State>
      <State label="C39 IngredientRow / Oil off the chips (3 tbsp)">
        <IngredientRow ingredient={OIL_THREE} onSave={noop} onRemove={noop} oil={{ choices: OIL_TBSP_CHOICES, selected: oilTbsp(OIL_THREE), onSelect: noop }} />
      </State>
      {BERAS ? (
        <State label="C39 IngredientRow / Unknown ingredient (AI guess)">
          <IngredientRow ingredient={BERAS} onSave={noop} onRemove={noop} />
        </State>
      ) : null}
      <State label="C39 IngredientRow / Edited amount (your correction)">
        <IngredientRow ingredient={KENTANG_EDITED} onSave={noop} onRemove={noop} />
      </State>
      <State label="C39 IngredientRow / Editing">
        <IngredientRow ingredient={KENTANG} defaultEditing focusOnOpen={false} onSave={noop} onRemove={noop} />
      </State>
      <State label="C39 IngredientRow / Read-only (Pot detail)">
        <div style={css.stack}>
          {KARI_AYAM.map((ingredient) => (
            <IngredientRow key={ingredient.id} ingredient={ingredient} readOnly />
          ))}
        </div>
      </State>
    </Group>
  );
}

/** /dev section: Pots components (C38–C39) in every state, with the demo's kari ayam pot. */
export function PotsGallery() {
  return (
    <section style={css.section} aria-labelledby="pots-gallery-title">
      <h2 id="pots-gallery-title" style={css.sectionTitle}>
        Pots
      </h2>
      <PotCardStates />
      <IngredientRowStates />
    </section>
  );
}
