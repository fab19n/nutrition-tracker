import { useState, type CSSProperties, type ReactNode } from 'react';
import { Camera, CookingPot, Repeat, ScanBarcode, Utensils } from 'lucide-react';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { LogInput } from '@/components/LogInput/LogInput';
import { MatchList, type MatchRow } from '@/components/MatchList/MatchList';
import { QuickActionRow, type QuickAction } from '@/components/QuickActionRow/QuickActionRow';
import { ContextChipRow, MealSlotChip, PlaceChip, TimeChip } from '@/components/ContextChips/ContextChips';
import { PlacePicker, type PlaceOption } from '@/components/PlacePicker/PlacePicker';
import { TimePicker, type TimeOption } from '@/components/TimePicker/TimePicker';
import { SlotPicker } from '@/components/SlotPicker/SlotPicker';
import { ReviewItemRow } from '@/components/ReviewItemRow/ReviewItemRow';
import { PortionChips } from '@/components/PortionChips/PortionChips';
import { RangeTotal } from '@/components/RangeTotal/RangeTotal';
import { SourceTag } from '@/components/SourceTag/SourceTag';
import { FollowUpQuestion } from '@/components/FollowUpQuestion/FollowUpQuestion';
import { FinishedPicker } from '@/components/FinishedPicker/FinishedPicker';
import { DishGrid, DishTile, nextDishCount, type DishCount } from '@/components/DishTile/DishTile';
import { CorrectionScopePrompt, ScopePicker, type CorrectionScope } from '@/components/CorrectionScopePrompt/CorrectionScopePrompt';
import { ItemSearch, type ItemSearchResult } from '@/components/ItemSearch/ItemSearch';
import { AddItemRow } from '@/components/AddItemRow/AddItemRow';
import { fmtApprox, fmtKcal, fmtRange, roundTo10 } from '@/domain/format';
import { itemMacros, itemsRange, mealMacros, selectVariant } from '@/domain/meal';
import type { Finished, Macros, MealItem, MealSlot, SourceTag as SourceKind, Variant } from '@/domain/types';

// ---------------------------------------------------------------------------
// Sample data (design_handoff.md §9: Friday 16 Oct, 7:10pm, 1,230 eaten, 570 left, +650 saved)
// ---------------------------------------------------------------------------

const TODAY = { eatenKcal: 1230, leftKcal: 570, savedKcal: 650 };

const noop = () => {};

function macros(kcal: number, proteinG = 0, carbsG = 0, fatG = 0): Macros {
  return { kcal, proteinG, carbsG, fatG };
}

function variants(id: string, list: [label: string, kcal: number][]): Variant[] {
  return list.map(([label, kcal], i) => ({ id: `${id}-${i}`, label, macros: macros(kcal) }));
}

function item(id: string, name: string, source: SourceKind, chips: Variant[], selected: number, extra: Partial<MealItem> = {}): MealItem {
  const chosen = chips[selected] ?? chips[0];
  return {
    id,
    name,
    variants: chips.length > 1 ? chips : undefined,
    selectedVariant: chips.length > 1 ? selected : undefined,
    unitMacros: chosen ? { ...chosen.macros } : macros(0),
    quantity: 1,
    uncertainty: 0.15,
    source,
    ...extra,
  };
}

const RICE = variants('rice', [['Small', 250], ['Normal', 330], ['Mamak big', 430]]);
const AYAM = variants('ayam', [['1 piece', 300], ['2 pieces', 600]]);
const KUAH = variants('kuah', [['Sikit', 60], ['Normal', 120], ['Banjir', 220]]);
const TEH_O = variants('teh', [['Kosong', 5], ['Kurang', 60], ['Normal', 110]]);
const KUBIS = variants('kubis', [['1 scoop', 70]]);

/** The S11 text-flow sample: total 880, likely 750–1,010. */
const REVIEW_ITEMS: MealItem[] = [
  item('rice', 'Rice', 'catalogue', RICE, 1),
  item('ayam', 'Ayam goreng', 'myfcd', AYAM, 0),
  item('kubis', 'Kubis · 1 scoop', 'catalogue', KUBIS, 0),
  item('kuah', 'Kuah campur', 'aiGuess', KUAH, 1, { question: 'Is there kuah under the rice?' }),
  item('teh', 'Teh o ais', 'yourCorrection', TEH_O, 1),
];

const EDITED_AYAM = selectVariant(item('ayam-edited', 'Ayam goreng', 'myfcd', AYAM, 0), 1);
const PENDING_ITEM = item('sambal', 'Sambal sotong', 'aiGuess', [], 0, { pendingEstimate: true });
const PLATE_DOUBLE = item('masak-merah', 'Ayam masak merah', 'catalogue', variants('amm', [['A piece', 250]]), 0, { quantity: 2 });

const TEH_TARIK = variants('tt', [['Kurang manis', 140], ['Normal', 200]]);

const kcalLabel = (i: MealItem) => fmtApprox(roundTo10(itemMacros(i).kcal));

const PLACES: PlaceOption[] = [
  { id: 'nk', name: 'Nasi kandar near home', type: 'mamak', nearby: true },
  { id: 'kedai', name: 'Kedai near home', type: 'economyRice' },
  { id: 'medan', name: 'Medan selera nearby', type: 'hawker' },
  { id: 'home', name: 'Home', type: 'home' },
];

const TIME_OPTIONS: TimeOption[] = [
  { id: 'now', label: 'Now' },
  { id: '30m', label: '30 min ago' },
  { id: '1h', label: '1 h ago' },
];

const MATCHES: MatchRow[] = [
  { id: 'usual-nk', name: 'Nasi kandar ayam goreng, kuah campur', detail: 'your usual here', kcalLabel: fmtApprox(950), onPick: noop },
  { id: 'teh-o-kurang', name: 'Teh o ais kurang', detail: 'your correction', kcalLabel: fmtApprox(60), onPick: noop },
];

const LIBRARY: ItemSearchResult[] = [
  { id: 'teh-tarik', name: 'Teh tarik', detail: 'Catalogue', kcalLabel: fmtApprox(200) },
  { id: 'teh-o-ais', name: 'Teh o ais', detail: 'your correction', kcalLabel: fmtApprox(60) },
  { id: 'telur-dadar', name: 'Telur dadar', detail: 'a piece', kcalLabel: fmtApprox(180) },
  { id: 'roti-canai', name: 'Roti canai', detail: 'MyFCD', kcalLabel: fmtApprox(300) },
  { id: 'ayam-goreng', name: 'Ayam goreng', detail: 'MyFCD', kcalLabel: fmtApprox(300) },
];

interface Dish {
  name: string;
  kcal: number;
  unit: string;
  often?: boolean;
}

const PROTEIN_DISHES: Dish[] = [
  { name: 'Ayam goreng', kcal: 280, unit: 'a piece' },
  { name: 'Ayam masak merah', kcal: 250, unit: 'a piece', often: true },
  { name: 'Ikan goreng', kcal: 200, unit: 'a piece' },
  { name: 'Telur dadar', kcal: 180, unit: 'a piece' },
];

const VEG_DISHES: Dish[] = [
  { name: 'Kangkung belacan', kcal: 90, unit: 'a scoop', often: true },
  { name: 'Kubis goreng', kcal: 70, unit: 'a scoop', often: true },
  { name: 'Terung sambal', kcal: 120, unit: 'a scoop' },
  { name: 'Taugeh', kcal: 60, unit: 'a scoop' },
];

const PORTION_GROUPS: { label: string; chips: Variant[]; selected: number }[] = [
  { label: 'Rice', chips: RICE, selected: 1 },
  { label: 'Kuah', chips: KUAH, selected: 1 },
  { label: 'Sugar', chips: TEH_O, selected: 1 },
  { label: 'Pieces', chips: AYAM, selected: 0 },
  { label: 'Plate rice', chips: variants('scoop', [['Half', 100], ['1 scoop', 200], ['1.5 scoops', 300]]), selected: 1 },
  { label: 'Kuah on rice', chips: variants('kuah-plate', [['None', 0], ['Some', 60], ['Banjir', 140]]), selected: 1 },
  { label: 'Home dish', chips: variants('senduk', [['1 senduk', 180], ['2 senduk', 360]]), selected: 0 },
];

const quickActions = (extra: Partial<Record<'photoDisabled' | 'barcode', boolean>> = {}): QuickAction[] => {
  const base: QuickAction[] = [
    { id: 'photo', label: 'Photo', icon: <Camera size={20} strokeWidth={2} />, onPress: noop, disabled: extra.photoDisabled },
    { id: 'plate', label: 'Plate', icon: <Utensils size={20} strokeWidth={2} />, onPress: noop },
    { id: 'usuals', label: 'Usuals', icon: <Repeat size={20} strokeWidth={2} />, onPress: noop },
    { id: 'pot', label: 'Pot', icon: <CookingPot size={20} strokeWidth={2} />, onPress: noop },
  ];
  if (extra.barcode) base.push({ id: 'barcode', label: 'Barcode', icon: <ScanBarcode size={20} strokeWidth={2} />, onPress: noop });
  return base;
};

// ---------------------------------------------------------------------------
// Layout helpers (dev page only; same conventions as the other gallery sections)
// ---------------------------------------------------------------------------

const groupStyle: CSSProperties = { paddingBottom: 8 };
const specimenStyle: CSSProperties = { margin: '0 0 18px' };
const captionStyle: CSSProperties = { padding: '6px 20px 0', margin: 0 };
const insetStyle: CSSProperties = { padding: '0 16px' };
const stackStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' };

/** A transformed box is the containing block for position: fixed, so the floating footer renders in place. */
const frameStyle: CSSProperties = {
  position: 'relative',
  height: 180,
  transform: 'translateZ(0)',
  overflow: 'hidden',
  background: 'var(--bg)',
  border: '1px dashed var(--dash)',
  borderRadius: 'var(--r-card)',
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={groupStyle} aria-label={title}>
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

function Specimen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure style={specimenStyle}>
      <div style={insetStyle}>{children}</div>
      <figcaption className="t-caption muted" style={captionStyle}>
        {caption}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Live wrappers so each state can also be tapped through
// ---------------------------------------------------------------------------

function LiveLogInput({ initial = '', offline, sending }: { initial?: string; offline?: boolean; sending?: boolean }) {
  const [text, setText] = useState(initial);
  const typing = text.trim().length > 0;
  const hint = offline
    ? "Estimate runs once you're online"
    : typing
      ? 'Matches from your library · no AI yet'
      : 'Type it like a message';
  return (
    <div style={stackStyle}>
      <LogInput value={text} onChange={setText} onSubmit={noop} onCamera={noop} hint={hint} offline={offline} sending={sending} />
      {typing && !sending ? <MatchList rows={MATCHES} /> : null}
    </div>
  );
}

function LivePlacePicker({ places, initialQuery, selected }: { places: PlaceOption[]; initialQuery?: string; selected?: string }) {
  const [selectedId, setSelectedId] = useState<string | undefined>(selected);
  return (
    <PlacePicker
      places={places}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onCreate={noop}
      onClear={() => setSelectedId(undefined)}
      initialQuery={initialQuery}
    />
  );
}

function LiveTimePicker({ initialId, initialCustom, hint }: { initialId?: string; initialCustom?: string; hint?: string }) {
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [custom, setCustom] = useState<string | undefined>(initialCustom);
  return (
    <TimePicker
      options={TIME_OPTIONS}
      selectedId={selectedId}
      onSelect={(id) => {
        setSelectedId(id);
        setCustom(undefined);
      }}
      customValue={custom}
      onCustom={(v) => {
        setCustom(v);
        setSelectedId(undefined);
      }}
      afterMidnightHint={custom && custom < '05:00' ? 'Counts toward Thu' : hint}
    />
  );
}

function LiveSlotPicker() {
  const [slot, setSlot] = useState<MealSlot>('dinner');
  return <SlotPicker value={slot} onChange={setSlot} />;
}

function LiveRow({ initial }: { initial: MealItem }) {
  const [it, setIt] = useState(initial);
  return (
    <ReviewItemRow
      item={it}
      kcalLabel={kcalLabel(it)}
      onSelectVariant={(i) => setIt((cur) => selectVariant(cur, i))}
      onSwap={noop}
      onRemove={noop}
    />
  );
}

function LivePortionChips({ label, chips, selected }: { label: string; chips: Variant[]; selected: number }) {
  const [index, setIndex] = useState(selected);
  return <PortionChips label={label} variants={chips} selectedIndex={index} onSelect={setIndex} />;
}

/** S11 in miniature: chips, remove, Finished and the footer all recompute together. */
function LiveReview() {
  const [items, setItems] = useState(REVIEW_ITEMS);
  const [added, setAdded] = useState(0);
  const [finished, setFinished] = useState<Finished>('all');
  const addTehTarik = () => {
    setItems((list) => [...list, item(`teh-tarik-${added}`, 'Teh tarik', 'catalogue', TEH_TARIK, 1)]);
    setAdded((n) => n + 1);
  };
  const total = mealMacros({ items, finished }).kcal;
  return (
    <div style={stackStyle}>
      {items.map((it) => (
        <ReviewItemRow
          key={it.id}
          item={it}
          kcalLabel={kcalLabel(it)}
          onSelectVariant={(i) => setItems((list) => list.map((x) => (x.id === it.id ? selectVariant(x, i) : x)))}
          onSwap={noop}
          onRemove={() => setItems((list) => list.filter((x) => x.id !== it.id))}
        />
      ))}
      <AddItemRow onAdd={addTehTarik} right={<FinishedPicker value={finished} onChange={setFinished} />} />
      <RangeTotal
        placement="inline"
        totalKcalLabel={fmtKcal(roundTo10(total))}
        rangeLabel={fmtRange(itemsRange(items, finished))}
        actionLabel="Save"
        onAction={noop}
        disabled={items.length === 0}
        after={{ eatenTodayKcal: TODAY.eatenKcal, mealKcal: roundTo10(total), leftTodayKcal: TODAY.leftKcal, savedKcal: TODAY.savedKcal }}
      />
    </div>
  );
}

function LiveFollowUp({ initial }: { initial?: number }) {
  const [answer, setAnswer] = useState<number | undefined>(initial);
  return (
    <FollowUpQuestion
      question="Is there kuah under the rice?"
      options={['Sikit', 'Normal', 'Banjir']}
      selectedIndex={answer}
      onAnswer={setAnswer}
      onSkip={() => setAnswer(undefined)}
    />
  );
}

function LiveFinished({ initial, expanded }: { initial: Finished; expanded?: boolean }) {
  const [value, setValue] = useState<Finished>(initial);
  return <FinishedPicker value={value} onChange={setValue} defaultExpanded={expanded} />;
}

function LiveDishTile({ dish, initial }: { dish: Dish; initial: DishCount }) {
  const [count, setCount] = useState<DishCount>(initial);
  return (
    <DishTile
      name={dish.name}
      kcalLabel={fmtApprox(dish.kcal)}
      unit={dish.unit}
      count={count}
      often={dish.often}
      onTap={() => setCount(nextDishCount)}
    />
  );
}

function LiveDishGrid({ label, dishes, initial }: { label: string; dishes: Dish[]; initial: Record<string, DishCount> }) {
  return (
    <DishGrid label={label}>
      {dishes.map((d) => (
        <LiveDishTile key={d.name} dish={d} initial={initial[d.name] ?? 0} />
      ))}
    </DishGrid>
  );
}

function LiveScopePicker({ initial }: { initial: CorrectionScope }) {
  const [scope, setScope] = useState<CorrectionScope>(initial);
  return <ScopePicker value={scope} onChange={setScope} />;
}

function LiveItemSearch({ initialQuery, custom = true }: { initialQuery: string; custom?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const q = query.trim().toLowerCase();
  const results = q ? LIBRARY.filter((r) => r.name.toLowerCase().includes(q)) : LIBRARY.slice(0, 3);
  return <ItemSearch query={query} onQuery={setQuery} results={results} onPick={noop} onCustom={custom ? noop : undefined} />;
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

/** /dev gallery section: logging and food components C16–C28 in every listed state. */
export function LoggingGallery() {
  return (
    <>
      <Group title="C16 LogInput">
        <Specimen caption="C16 LogInput / Empty (type to see matches)">
          <LiveLogInput />
        </Specimen>
        <Specimen caption="C16 LogInput / Typing, with MatchList">
          <LiveLogInput initial="nasi kandar ayam goreng, kubis, kuah campur, teh o ais" />
        </Specimen>
        <Specimen caption="C16 LogInput / Sending">
          <LiveLogInput initial="nasi kandar ayam goreng, kubis, kuah campur, teh o ais" sending />
        </Specimen>
        <Specimen caption="C16 LogInput / Offline">
          <LiveLogInput initial="roti telur + dhal" offline />
        </Specimen>
      </Group>

      <Group title="C17 QuickActionRow">
        <Specimen caption="C17 QuickActionRow / Default">
          <QuickActionRow actions={quickActions()} />
        </Specimen>
        <Specimen caption="C17 QuickActionRow / Photo unavailable">
          <QuickActionRow actions={quickActions({ photoDisabled: true })} />
        </Specimen>
        <Specimen caption="C17 QuickActionRow / Five actions (barcode, later)">
          <QuickActionRow actions={quickActions({ barcode: true })} />
        </Specimen>
      </Group>

      <Group title="C18–C20 Context chips">
        <Specimen caption="C18 PlaceChip / Auto-selected (Nearby) · Chosen · New · None">
          <div style={rowStyle}>
            <PlaceChip name="Nasi kandar near home" nearby onPress={noop} />
            <PlaceChip name="Kedai near home" onPress={noop} />
            <PlaceChip name="Medan selera nearby" isNew onPress={noop} />
            <PlaceChip onPress={noop} />
          </div>
        </Specimen>
        <Specimen caption="C19 TimeChip / Now · Earlier · After midnight">
          <div style={rowStyle}>
            <TimeChip label="Now" onPress={noop} />
            <TimeChip label="30 min ago" onPress={noop} />
            <TimeChip label="12:40am · counts toward Thu" onPress={noop} />
          </div>
        </Specimen>
        <Specimen caption="C20 MealSlotChip / Dinner · Supper">
          <div style={rowStyle}>
            <MealSlotChip slot="dinner" onPress={noop} />
            <MealSlotChip slot="supper" onPress={noop} />
          </div>
        </Specimen>
        <Specimen caption="C18–C20 ContextChipRow / Log sheet">
          <ContextChipRow>
            <PlaceChip name="Nasi kandar near home" nearby onPress={noop} />
            <TimeChip label="Now" onPress={noop} />
            <MealSlotChip slot="dinner" onPress={noop} />
          </ContextChipRow>
        </Specimen>
      </Group>

      <Group title="C18 PlacePicker">
        <Specimen caption="C18 PlacePicker / Nearby and recent, one chosen (type to search)">
          <LivePlacePicker places={PLACES} selected="nk" />
        </Specimen>
        <Specimen caption="C18 PlacePicker / New place (Create)">
          <LivePlacePicker places={PLACES.filter((p) => p.id !== 'medan')} initialQuery="Medan selera nearby" />
        </Specimen>
        <Specimen caption="C18 PlacePicker / No places yet">
          <LivePlacePicker places={[]} />
        </Specimen>
      </Group>

      <Group title="C19 TimePicker">
        <Specimen caption="C19 TimePicker / Now">
          <LiveTimePicker initialId="now" />
        </Specimen>
        <Specimen caption="C19 TimePicker / Custom time after midnight">
          <LiveTimePicker initialCustom="00:40" />
        </Specimen>
      </Group>

      <Group title="C20 SlotPicker">
        <Specimen caption="C20 SlotPicker / Dinner suggested">
          <LiveSlotPicker />
        </Specimen>
      </Group>

      <Group title="C21 ReviewItemRow">
        <Specimen caption="C21 ReviewItemRow / Confident (Catalogue)">
          <LiveRow initial={item('rice-solo', 'Rice', 'catalogue', RICE, 1)} />
        </Specimen>
        <Specimen caption="C21 ReviewItemRow / Fixed item, no chips">
          <LiveRow initial={item('kubis-solo', 'Kubis · 1 scoop', 'catalogue', KUBIS, 0)} />
        </Specimen>
        <Specimen caption="C21 ReviewItemRow / Uncertain (wider range, softer)">
          <LiveRow initial={item('kuah-wide', 'Kuah campur', 'catalogue', KUAH, 1, { uncertainty: 0.35 })} />
        </Specimen>
        <Specimen caption="C21 ReviewItemRow / AI guess with question">
          <LiveRow initial={item('kuah-solo', 'Kuah campur', 'aiGuess', KUAH, 1, { question: 'Is there kuah under the rice?' })} />
        </Specimen>
        <Specimen caption="C21 ReviewItemRow / Your correction">
          <LiveRow initial={item('teh-solo', 'Teh o ais', 'yourCorrection', TEH_O, 1)} />
        </Specimen>
        <Specimen caption="C21 ReviewItemRow / Edited (1 piece → 2 pieces)">
          <LiveRow initial={EDITED_AYAM} />
        </Specimen>
        <Specimen caption="C21 ReviewItemRow / Plate dish ×2">
          <ReviewItemRow item={PLATE_DOUBLE} kcalLabel={kcalLabel(PLATE_DOUBLE)} onRemove={noop} />
        </Specimen>
        <Specimen caption="C21 ReviewItemRow / Waiting for AI (offline)">
          <ReviewItemRow item={PENDING_ITEM} kcalLabel="" onRemove={noop} onSwap={noop} />
        </Specimen>
        <Specimen caption="C21 AddItemRow / Alone · with FinishedPicker">
          <div style={stackStyle}>
            <AddItemRow onAdd={noop} />
            <AddItemRow onAdd={noop} right={<LiveFinished initial="all" />} />
          </div>
        </Specimen>
        <Specimen caption="C21 ItemSearch / Add item (recent)">
          <LiveItemSearch initialQuery="" />
        </Specimen>
        <Specimen caption="C21 ItemSearch / Results">
          <LiveItemSearch initialQuery="teh" />
        </Specimen>
        <Specimen caption="C21 ItemSearch / No match, add as typed">
          <LiveItemSearch initialQuery="roti tisu" />
        </Specimen>
      </Group>

      <Group title="C22 PortionChips">
        <Specimen caption="C22 PortionChips / Every group (Normal, Kurang, 1 piece … selected)">
          <div style={stackStyle}>
            {PORTION_GROUPS.map((g) => (
              <LivePortionChips key={g.label} label={g.label} chips={g.chips} selected={g.selected} />
            ))}
          </div>
        </Specimen>
      </Group>

      <Group title="C23 RangeTotal">
        <Specimen caption="C23 RangeTotal / Review, within budget">
          <RangeTotal
            placement="inline"
            totalKcalLabel={fmtKcal(450)}
            rangeLabel={fmtRange({ low: 380, high: 520 })}
            actionLabel="Save"
            onAction={noop}
            after={{ eatenTodayKcal: TODAY.eatenKcal, mealKcal: 450, leftTodayKcal: TODAY.leftKcal, savedKcal: TODAY.savedKcal }}
          />
        </Specimen>
        <Specimen caption="C23 RangeTotal / Review, over and covered by savings">
          <RangeTotal
            placement="inline"
            totalKcalLabel={fmtKcal(880)}
            rangeLabel={fmtRange({ low: 750, high: 1010 })}
            actionLabel="Save"
            onAction={noop}
            after={{ eatenTodayKcal: TODAY.eatenKcal, mealKcal: 880, leftTodayKcal: TODAY.leftKcal, savedKcal: TODAY.savedKcal }}
          />
        </Specimen>
        <Specimen caption="C23 RangeTotal / Review, over and not covered">
          <RangeTotal
            placement="inline"
            totalKcalLabel={fmtKcal(880)}
            rangeLabel={fmtRange({ low: 750, high: 1010 })}
            actionLabel="Save"
            onAction={noop}
            after={{ eatenTodayKcal: TODAY.eatenKcal, mealKcal: 880, leftTodayKcal: TODAY.leftKcal, savedKcal: 200 }}
          />
        </Specimen>
        <Specimen caption="C23 RangeTotal / Plate (Review action, no after line)">
          <RangeTotal
            placement="inline"
            totalKcalLabel={fmtKcal(670)}
            rangeLabel={fmtRange({ low: 570, high: 770 })}
            actionLabel="Review"
            onAction={noop}
          />
        </Specimen>
        <Specimen caption="C23 RangeTotal / Disabled">
          <RangeTotal
            placement="inline"
            totalKcalLabel={fmtKcal(880)}
            rangeLabel={fmtRange({ low: 750, high: 1010 })}
            actionLabel="Save"
            onAction={noop}
            disabled
          />
        </Specimen>
        <Specimen caption="C23 RangeTotal / Floating (left/right 10, bottom 22 + safe area)">
          <div style={frameStyle}>
            <RangeTotal totalKcalLabel={fmtKcal(670)} rangeLabel={fmtRange({ low: 570, high: 770 })} actionLabel="Review" onAction={noop} />
          </div>
        </Specimen>
      </Group>

      <Group title="C24 SourceTag">
        <Specimen caption="C24 SourceTag / Your correction · Catalogue · MyFCD · SG FoodID · USDA · AI guess">
          <div style={rowStyle}>
            {(['yourCorrection', 'catalogue', 'myfcd', 'sgfoodid', 'usda', 'aiGuess'] as const).map((s) => (
              <SourceTag key={s} source={s} />
            ))}
          </div>
        </Specimen>
      </Group>

      <Group title="C25 FollowUpQuestion">
        <Specimen caption="C25 FollowUpQuestion / Open">
          <LiveFollowUp />
        </Specimen>
        <Specimen caption="C25 FollowUpQuestion / Answered">
          <LiveFollowUp initial={2} />
        </Specimen>
      </Group>

      <Group title="C26 FinishedPicker">
        <Specimen caption="C26 FinishedPicker / Collapsed · Expanded · Chosen (half)">
          <div style={{ ...stackStyle, alignItems: 'flex-end' }}>
            <LiveFinished initial="all" />
            <LiveFinished initial="all" expanded />
            <LiveFinished initial="half" />
          </div>
        </Specimen>
      </Group>

      <Group title="C27 DishTile">
        <Specimen caption="C27 DishTile / Off · ×1 · ×2 · Picked often (tap to cycle)">
          <DishGrid label="Dish states">
            <LiveDishTile dish={{ name: 'Ayam goreng', kcal: 280, unit: 'a piece' }} initial={0} />
            <LiveDishTile dish={{ name: 'Ayam masak merah', kcal: 250, unit: 'a piece' }} initial={1} />
            <LiveDishTile dish={{ name: 'Telur dadar', kcal: 180, unit: 'a piece' }} initial={2} />
            <LiveDishTile dish={{ name: 'Kangkung belacan', kcal: 90, unit: 'a scoop', often: true }} initial={0} />
          </DishGrid>
        </Specimen>
        <Specimen caption="C27 DishGrid / Plate builder groups (S24 sample)">
          <div style={stackStyle}>
            <span className="t-section">Protein</span>
            <LiveDishGrid label="Protein" dishes={PROTEIN_DISHES} initial={{ 'Ayam masak merah': 1 }} />
            <span className="t-section">Vegetables</span>
            <LiveDishGrid label="Vegetables" dishes={VEG_DISHES} initial={{ 'Kangkung belacan': 1, 'Kubis goreng': 1 }} />
          </div>
        </Specimen>
      </Group>

      <Group title="C28 CorrectionScopePrompt">
        <Specimen caption="C28 CorrectionScopePrompt / Asked after a repeat fix">
          <CorrectionScopePrompt
            message="You've corrected the rice portion here twice. Make big rice the default?"
            onYes={noop}
            onJustThisTime={noop}
          />
        </Specimen>
        <Specimen caption="C28 ScopePicker / This time">
          <LiveScopePicker initial="once" />
        </Specimen>
        <Specimen caption="C28 ScopePicker / Always at this Place">
          <LiveScopePicker initial="place" />
        </Specimen>
      </Group>

      <Group title="S11 Review sample (live)">
        <Specimen caption="C21–C26 together: change chips, remove, + Add item adds a teh tarik, Finished scales the total">
          <LiveReview />
        </Specimen>
      </Group>
    </>
  );
}
