# Kira Makan — Architecture and Build Contract

This is the working contract for building the app. Read it before touching code.

## 1. Sources of truth

| Question | Read |
|---|---|
| How it looks (tokens, sizes, radii, states) | `design/README.md` (final, high-fidelity) |
| Exact layout, copy and interaction of designed screens | `design/Kira Makan.dc.html` (template + `class Component` state logic at the bottom) |
| Every component (C01–C61) and screen (S01–S48), with all states | `design_handoff.md` |
| Behaviour, maths, data rules | `personal_food_tracker_product_plan.md` (v2) |

If they disagree: **design/README.md wins for visuals; the plan wins for behaviour**, except for the decisions in §10 of this file.

Treat `design/*.html` and `design/support.js` as reference documents only. Never import or execute them.

## 2. Stack

- React 19 + TypeScript 7 (strict, `noUncheckedIndexedAccess`), Vite 8, `vite-plugin-pwa`.
- Routing: `react-router` v8 (`createBrowserRouter`, `RouterProvider`, `Outlet`, `useNavigate`, `useSearchParams`).
- Local-first storage: Dexie 4 (IndexedDB) + `dexie-react-hooks` (`useLiveQuery`). Supabase sync comes later behind the same repository functions.
- UI state: Zustand 5 (`src/state/ui.ts`).
- Icons: `lucide-react` (outline family; `strokeWidth={2}`; 20px default, 16px in chips, 12px in tags). The design's unicode glyphs (⌖ ◔ ● ★ ◎ ▣ ↻ ◍ ‹ ›) are placeholders: replace with Lucide equivalents (MapPin, Clock, CircleCheck/Circle, Star, CircleDot/Utensils, Camera, Repeat, CookingPot, ChevronLeft/Right).
- Font: `@fontsource-variable/bricolage-grotesque` (already imported in `src/styles/global.css`).
- Tests: Vitest 5 + jsdom + Testing Library + `fake-indexeddb` (auto-loaded in `src/test/setup.ts`). Test files: `src/**/*.test.ts(x)`.
- Path alias: `@/` → `src/`.

Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run dev`.

## 3. Directory layout and ownership

```
src/
  app/            App, router, AppShell (phone column, safe areas, nav, sheet host, toast host)
  components/
    ui/           Primitives: Button, Card, Chip/ChipGroup, Pill, Toggle, Segmented, SectionHeading  (done — reuse, don't fork)
    <Name>/       One folder per design component: <Name>.tsx + <Name>.module.css (+ <Name>.test.tsx when it has logic)
  data/           Starter catalogue + portion dictionary (static TS data)
  db/             Dexie schema, repositories, actions, live-query hooks, seeds (demo + defaults), export
  domain/         Pure engine: types (done), clock, day, format, meal, targets, budget, trend, maintenance,
                  timing, workout, checkin (+ later insights/, suggestions)
  estimate/       Estimation service: types, local (catalogue) estimator, AI client stub
  screens/        One folder per screen, default export, named <Name>Screen.tsx
  state/          Zustand UI store (toast, sheets, review draft, log draft)
  styles/         tokens.css, global.css (typography utility classes .t-hero … .t-tag)
  dev/            Component gallery (/dev) for visual QA
```

**File ownership is strict during parallel work.** Only create or edit files in the paths your task names. If you need something from another area that doesn't exist yet, code against the contract in this file and leave a `// CONTRACT:` comment; do not create it yourself.

## 4. Conventions

- **Styling:** CSS Modules only (`X.module.css`). Use tokens from `src/styles/tokens.css` (`var(--card)`, `var(--r-card)`…) and typography classes from `global.css`. **No hard-coded colours.** Match `design/README.md` sizes exactly (font sizes, paddings, radii).
- **Numbers:** always tabular (inherited from `body`). Format through `src/domain/format.ts` — never hand-format.
- **Copy:** sentence case; Malaysian food words as-is; no "please", "successfully", "!"; no moralising words (see `design_handoff.md` §10). Estimates use "~" and ranges.
- **Colour + word:** every tag/state shows a word (and an icon where the design has a glyph). Over budget is amber, never red; `--danger` only for errors/destructive actions.
- **Accessibility:** tappables ≥ 44×44 (primitives already add hit areas); icon-only buttons get `aria-label`; sheets trap focus and close on Escape; charts get an `aria-label` summary; respect `prefers-reduced-motion` (handled globally for animations).
- **Components are presentational.** They take props and callbacks; they never read Dexie or Zustand directly. Screens connect data.
- **No `any`.** Export prop types. Keep components small and composable.
- **Motion:** sheets/toasts/new rows use `animation: km-up 250–300ms ease both`; skeleton uses `km-pulse 1.4s ease-in-out infinite` staggered 150ms.

## 5. Engine contracts (`src/domain`)

All functions are pure and unit-tested. Use `Intl.DateTimeFormat` for time zones (no date library). Default zone `Asia/Kuala_Lumpur`, rollover hour 5.

### 5.1 `clock.ts`
```ts
export const DEMO_NOW_ISO = '2026-10-16T11:10:00.000Z'; // Fri 16 Oct 2026, 7:10pm MYT
export function setDemoClock(enabled: boolean): void;
export function isDemoClock(): boolean;
export function now(): Date; // demo-pinned or real
```

### 5.2 `day.ts` — logical days
```ts
export const DEFAULT_TZ = 'Asia/Kuala_Lumpur';
export const DEFAULT_ROLLOVER_HOUR = 5;
export function logicalDayOf(at: Date | Instant, tz?: string, rolloverHour?: number): LogicalDay; // 2am → previous day
export function addDays(day: LogicalDay, n: number): LogicalDay;
export function daysBetween(from: LogicalDay, to: LogicalDay): number;           // to − from
export function compareDays(a: LogicalDay, b: LogicalDay): number;
export function weekStartOf(day: LogicalDay): LogicalDay;                        // Monday
export function weekDays(weekStart: LogicalDay): LogicalDay[];                   // 7 days Mon..Sun
export function weekdayIndex(day: LogicalDay): number;                           // Mon = 0 … Sun = 6
export function minutesIntoLogicalDay(at: Date | Instant, tz?: string, rolloverHour?: number): number; // 0 at rollover
export function instantAt(day: LogicalDay, hour: number, minute: number, tz?: string): Instant; // wall-clock time on that calendar date (hour may be ≥ 24 → next calendar day)
export function zonedParts(at: Date | Instant, tz?: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
```

### 5.3 `format.ts`
```ts
fmtInt(1800) → '1,800'          fmtSigned(650) → '+650'   fmtSigned(-120) → '−120' (U+2212)
fmtKcal(1800) → '1,800 kcal'     fmtApprox(560) → '~560'    fmtRange({low:750,high:1010}) → '750–1,010' (en dash)
fmtKg(77.9) → '77.9 kg'          fmtKgDelta(-0.4) → '−0.4 kg'
fmtRm(9.5) → 'RM 9.50'           fmtTime(instant, tz) → '10:40am' | '7:10pm' | '12:05am'
fmtDayShort('2026-10-16') → 'Fri 16 Oct'   fmtWeekday → 'Fri'   fmtDayLetter → 'F'   fmtDayRange(mon, sun) → '12–18 Oct'
roundTo10(n), roundTo5(n)
```

### 5.4 `meal.ts`
```ts
export const FINISHED_FACTOR: Record<Finished, number> = { all: 1, most: 0.75, half: 0.5 };
export function itemMacros(item: MealItem): Macros;                 // unitMacros × quantity
export function sumMacros(list: Macros[]): Macros;
export function mealMacros(meal: Pick<MealLog, 'items' | 'finished'>): Macros;
export function itemRange(item: MealItem): KcalRange;              // kcal × (1 ± uncertainty), rounded to 10
export function itemsRange(items: MealItem[], finished?: Finished): KcalRange; // Σ lows / Σ highs × factor, rounded to 10
export function selectVariant(item: MealItem, index: number): MealItem; // updates unitMacros, sets edited, keeps `original`
export function setQuantity(item: MealItem, quantity: number): MealItem;
export function itemFromCatalogue(c: CatalogueItem, opts?: { variant?: number; quantity?: number; source?: SourceTag; id?: string }): MealItem;
```
With the default uncertainty of 0.15, a meal's range equals best guess ±15% rounded to 10 (matches the design: 880 → 750–1,010).

### 5.5 `targets.ts`
```ts
export const ACTIVITY_FACTOR = { sedentary: 1.2, light: 1.375, active: 1.55 };
export const KCAL_PER_KG = 7700;
export function bmrMifflinStJeor(p: { sex: Sex; weightKg: number; heightCm: number; age: number }): number;
export function startingMaintenance(p: { sex; weightKg; heightCm; age; activity: ActivityLevel }): number; // rounded to 10
export function deficitForPace(paceKgPerWeek: number): number;       // pace × 7700 / 7 → 0.5 → 550
export function dailyTargetFor(goal: Pick<Goal,'template'|'paceKgPerWeek'|'surplusKcal'>, maintenanceKcal: number, dailyMinimumKcal: number): number;
//   cut: max(min, maintenance − deficit) · festive: maintenance · leanBulk: maintenance + (surplus ?? 200) · pause/custom: maintenance − deficit (never below min)
export function defaultMacroTargets(dailyKcal: number, weightKg: number, template: GoalTemplate): { proteinG: number; carbsG: number; fatG: number };
//   protein 1.4 g/kg (leanBulk 1.65), fat 30% of kcal ÷ 9, carbs = remainder ÷ 4; all rounded to 5
```

### 5.6 `budget.ts` — weekly budget (plan §7, with decision §10.1)
```ts
export interface BudgetDayInput {
  day: LogicalDay;
  targetKcal: number | null;   // null = paused (no budget that day)
  eatenKcal: number;           // includes guess entries
  workoutKcal: number;
  bonusKcal: number;
  status: DayStatusKind | null; // null = no record (a finished day with no record is treated as 'unconfirmed')
}
export type BudgetBarKind = 'logged' | 'over' | 'today' | 'planned' | 'makan' | 'notCounted' | 'paused';
export interface BudgetDay {
  day: LogicalDay; kind: BudgetBarKind; isToday: boolean; isFinished: boolean;
  status: DayStatusKind | null;
  baseKcal: number;      // target + workouts + bonus (0 when paused)
  eatenKcal: number;
  countedKcal: number;   // what the day uses from the week (finished days only; else 0)
  savedKcal: number;     // base − counted (finished days only)
  plannedKcal: number;   // allowance for today/future days after redistribution
}
export interface WeekBudget {
  weekStart: LogicalDay; today: LogicalDay; days: BudgetDay[];
  weeklyBudgetKcal: number;       // Σ base over non-paused days
  workoutsKcal: number; bonusKcal: number;
  eatenSoFarKcal: number;         // Σ eaten for finished days + today (display: "Eaten so far Mon–Fri")
  savedKcal: number;              // Σ saved over finished days (can be negative)
  pendingSavedKcal: number;       // savings held back on unconfirmed days, released when confirmed
  todayBaseKcal: number;
  leftTodayKcal: number;          // todayBase − eatenToday (negative = over)
  overTodayKcal: number;          // max(0, −leftToday)
  coveredBySavings: boolean;      // overToday > 0 && saved ≥ overToday
  leftThisWeekKcal: number;       // weeklyBudget − Σ counted(finished) − eatenToday
  makanDay?: LogicalDay;
  makanRoomKcal?: number;         // planned allowance of the makan day
  unabsorbedKcal: number;         // shortfall the remaining days couldn't take without going below the minimum
}
export function computeWeekBudget(input: { days: BudgetDayInput[]; today: LogicalDay; dailyMinimumKcal: number; makanDay?: LogicalDay }): WeekBudget;
export function daysInRange(days: { eatenKcal: number; status: DayStatusKind | null }[], maintenanceKcal: number, rangePct: number): number;
```
Rules for **finished** days (before today):
- `complete` / `guess`: counted = eaten; saved = base − eaten (may be negative).
- `unconfirmed` / `null`: counted = max(eaten, base); saved = min(0, base − eaten); pending += max(0, base − eaten). Overspend counts immediately; savings wait for the check-in.
- `notCounted`: counted = base; saved = 0 ("counts as exactly the target").
- paused (target null): base 0, counted 0, saved 0, kind `paused`.
Today: leftToday = base − eaten. Future days: planned = base, then:
- net = saved + min(0, leftToday).
- net ≥ 0: if a makan day is in the future, its planned = base + net (= makan room). Otherwise planned stays at base.
- net < 0: spread −net across future non-paused days by water-filling, never below `min(base, dailyMinimum)`; anything left is `unabsorbedKcal`.
Bar kinds: finished → `notCounted` | `paused` | `over` (eaten > base) | `logged`; today → `today`; future → `makan` or `planned`.

Worked example (must be a unit test): target 1,800 every day; Mon–Thu eaten 1,620 / 1,710 / 1,540 / 1,680, all complete; today Fri eaten 1,230; makan day Sat →
saved 650, leftToday 570, leftThisWeek 4,820, weeklyBudget 12,600, eatenSoFar 7,780, makanRoom 2,450.
Over example: today 2,110 → overToday 310, coveredBySavings true, makanRoom 2,140.

### 5.7 `trend.ts`
```ts
export const TREND_ALPHA = 0.25;   // matches the design's chart (decision §10.3)
export function emaTrend(values: number[], alpha?: number): number[];
export function dailyWeights(logs: WeightLog[]): { day: LogicalDay; kg: number }[]; // last reading per day, sorted
export function weightTrend(logs: WeightLog[], alpha?: number): { day: LogicalDay; kg: number; trendKg: number }[];
export function trendChange(points: { day: LogicalDay; trendKg: number }[], days: number): number | null; // trend now − trend `days` ago
```
Design sample (14 readings 78.6 … 77.8) → latest trend ≈ 77.9.

### 5.8 `maintenance.ts` — adaptive maintenance (plan §6.4, §8.3)
```ts
export function adaptiveMaintenance(input: {
  days: { day: LogicalDay; eatenKcal: number; workoutKcal: number; status: DayStatusKind | null }[];
  trend: { day: LogicalDay; trendKg: number }[];
  minCompleteDays?: number; // default 21; window last 28 days
}): { maintenanceKcal: number; avgEatenKcal: number; avgWorkoutKcal: number; trendKgPerWeek: number; daysUsed: number } | null;
// maintenance without workouts ≈ avg eaten − avg workout + (trend kg lost per day × 7,700); only complete days count; round to 10
export function targetSuggestion(current: { maintenanceKcal: number; dailyKcal: number }, adaptive: { maintenanceKcal: number }, goal: Pick<Goal,'template'|'paceKgPerWeek'|'surplusKcal'>, dailyMinimumKcal: number):
  { suggestedDailyKcal: number; newMaintenanceKcal: number; altSlowerPace?: { paceKgPerWeek: number; dailyKcal: number } } | null; // null unless |Δmaintenance| > 100
```

### 5.9 `timing.ts`
```ts
export const DEFAULT_SLOT_TIMES: Record<MealSlot, number>; // minutes after midnight: breakfast 9:30, lunch 13:30, dinner 20:30, snack 16:00, supper 23:30
export function eatingWindow(mealsOfDay: Pick<MealLog,'eatenAt'>[], rules: TimingRules): { opensAt?: Instant; closesAt?: Instant; lengthHours: number; occasions: number };
//   opens at first meal; closes at first meal + maxWindowHours (default 12); length = last − first
export function slotBaselines(history: Pick<MealLog,'eatenAt'|'slot'|'logicalDay'>[], tz?: string, rolloverHour?: number): Record<MealSlot, { medianMin: number; spreadMin: number; samples: number }>;
//   median and median-absolute-deviation of local wall-clock minutes per slot over the last 28 days
export type TimingTagKind = 'onTime' | 'lateForYou' | 'earlyForYou' | 'outsideWindow' | 'afterMidnight';
export function timingTag(meal: Pick<MealLog,'eatenAt'|'slot'>, ctx: { baselines: ReturnType<typeof slotBaselines>; window?: { closesAt?: Instant }; tz?: string; rolloverHour?: number }): TimingTagKind;
//   outsideWindow if after window close; late/early if beyond max(60, 2×spread) from median (fewer than 5 samples → DEFAULT_SLOT_TIMES with ±60); afterMidnight when wall clock is 00:00–rollover; else onTime
export function suggestSlot(at: Date | Instant, tz?: string, rolloverHour?: number): MealSlot;
```

### 5.10 `workout.ts`
```ts
export const MET_TABLE: Record<WorkoutType, Record<Intensity, number>>; // Compendium-style values; futsal moderate = 7
export function netWorkoutKcal(type: WorkoutType, intensity: Intensity, minutes: number, weightKg: number): number; // (MET − 1) × kg × h, round to 10
```
Futsal, moderate, 60 min, 78 kg → ~470.

### 5.11 `checkin.ts`
```ts
export function typicalSlotKcal(history: MealLog[], slot: MealSlot): number | null;    // median kcal of that slot, last 28 days
export function analyseDay(meals: MealLog[], ctx: { baselines; tz?; rolloverHour?; sleepAt?: Instant }):
  { mealCount: number; kcal: number; looksIncomplete: boolean; gap?: { from: Instant; hours: number; missingSlot: MealSlot; usualLabel: string } };
// looksIncomplete when a usual slot (≥ 5 samples) has no meal and the gap after the last meal is ≥ 6 h
```

## 6. Data layer contracts (`src/db`)

- `db.ts`: Dexie database `kira-makan`, version 1. Tables (primary key first):
  `profile ('id')`, `goals ('id, status')`, `goalVersions ('id, goalId, effectiveFrom')`, `goalPeriods ('id, goalId, from')`,
  `meals ('id, logicalDay, eatenAt, placeId, slot')`, `weights ('id, logicalDay, measuredAt')`, `workouts ('id, logicalDay')`,
  `bonuses ('id, logicalDay')`, `days ('logicalDay, status')`, `weekPlans ('weekStart')`, `places ('id, name')`,
  `usuals ('id, placeId')`, `pots ('id, expiresOn')`, `photos ('id')` (Blob + thumbnail Blob), `insightFeedback ('ruleId')`,
  `suggestionEvents ('id, at')`, `personalItems ('id, catalogueId, placeId')`.
- `repo/*.ts`: plain async CRUD per table (no React).
- `actions.ts`: user intents, each a transaction: `saveMeal(draft)`, `updateMeal(id, patch)`, `deleteMeal(id) → undo()`, `confirmDay(day, choice)`, `addWeight(kg, at?)`, `planMakanDay(day | null)`, `setWeeklyFocus(weekStart, focus)`, `addWorkout(...)`, `addBonus(...)`, `logPotServing(potId, servings)`, `completeSetup(input)`, `loadDemoData()`, `resetAll()`.
- `hooks.ts`: live-query hooks for screens (see §6.1). Hooks combine Dexie data with the engine; screens never call the engine for budget maths directly.
- `seed/defaults.ts`: goal templates (Cut, Festive maintain, Lean bulk, Pause) with timing rules and suggestion weights.
- `seed/demo.ts`: the design's sample world (design_handoff.md §9) anchored to the demo clock: week Mon 12 – Sun 18 Oct 2026, today Fri 16 Oct 7:10pm; last week 5–11 Oct for the weekly review; weights 3–16 Oct; Places, Usuals, the kari ayam pot, last week's futsal.
- `export.ts`: full JSON export/import and CSV (meals, items, weights, workouts).

### 6.0 As built (read the code; these supersede the sketches below)

- Repo functions take the database first: `listMealsForDay(db, day)`. App code passes the `db` singleton.
- `src/db/actions.ts` exports bound actions (and `createActions(db)` for tests). `saveMeal(draft)` returns `{ meal, undo }`; `deleteMeal`, `deleteWeight`, `deleteWorkout`, `deleteBonus` return an `undo()`; `planMakanDay(weekStart, day | null)`; `syncDemoClock()` must run before the first render (the shell does it).
- `src/db/selectors.ts` holds framework-free reads; `src/db/hooks.ts` wraps them with `useLiveQuery`. Hooks return supersets of §6.1 (e.g. `useActiveGoal` → `{ goal, version, period, paused }`, `useWeekBudget` → `{ budget, plan, goal, version, days, dailyMinimumKcal }`). Extra hooks: `useHasProfile` (tells "no setup yet" apart from loading), `useMeal`, `useProteinLeft`, `useFestiveDaysInRange`, `usePersonalItems`. Single-row hooks return `undefined` both while loading and when missing.
- `getCheckIn()` returns the newest unconfirmed day with a `queue` of older ones and the four choices with their consequence copy.
- The trend is a plain EMA (α 0.25). On the design's 14 readings the latest trend is 77.99 → "78.0 kg" (the design's "77.9" copy was hand-written).

### 6.1 Hooks screens can rely on
```ts
useProfile(): Profile | undefined
useNow(): Date                          // ticks every minute; demo-aware
useToday(): LogicalDay
useActiveGoal(day?): { goal: Goal; version: GoalVersion } | undefined
useDaySummary(day): { meals: MealLog[]; macros: Macros; kcal: number; record?: DayRecord; window: ...; tags: Record<mealId, TimingTagKind> } | undefined
useWeekBudget(day?): { budget: WeekBudget; plan?: WeekPlan; goal; version } | undefined
useWeightTrend(): { points: ...; latest?: ...; weekChangeKg: number | null } | undefined
usePlaces(), usePlace(id), useUsuals(), usePots(), useWorkouts(weekStart), useWeekPlan(weekStart), useCheckIn()
```

## 7. Estimation (`src/estimate`)

```ts
export interface EstimateRequest { text?: string; photo?: Blob; caption?: string; placeId?: Id; slot?: MealSlot }
export interface EstimateResult { items: MealItem[]; questions: { itemId: Id; question: string }[]; unmatched: string[]; method: 'local' | 'ai' }
export interface Estimator { estimate(req: EstimateRequest, ctx: { place?: Place; personal: PersonalItem[] }): Promise<EstimateResult> }
```
- `localEstimator.ts`: splits text on commas, "+", " and ", " dengan ", " with "; matches catalogue names/aliases (normalised, fuzzy); reads portion and sugar words (sikit/kurang/kosong/banjir/besar/mamak/2 pieces/"2 ketul"/"half") into variant choices; applies the Place's learned defaults; anything unmatched becomes an `aiGuess` item with a wide range (uncertainty 0.35) and a question. Fully offline.
- `aiClient.ts`: posts to `/api/estimate` (server function, added later). If unavailable or offline, the service falls back to the local estimator and marks items `pendingEstimate` only when nothing matched.
- `service.ts`: `getEstimator()` returns AI-with-local-fallback when an endpoint is configured (`VITE_ESTIMATE_URL`), else local.
- Request body (as built): `{ text?, caption?, slot?, place?: { type, defaultVariants (catalogueId → variant index), oilLevel? }, candidates?: [{ catalogueId, selectedVariant?, quantity, source }] }`; photos go as multipart (`photo` + `request` JSON). Never the Place's name or location, never body stats.
- Server: `supabase/functions/estimate/core.ts` (shared) → `index.ts` (Supabase Edge Function, Deno) and `server/devEstimatePlugin.ts` (POST `/api/estimate` on the Vite dev server when `ANTHROPIC_API_KEY` is set). Claude (`claude-opus-5-5`, effort low, structured output, server-side fallback, cached catalogue prompt) only identifies catalogue ids, portions and unknown items; macros for catalogue items come from the catalogue. Regenerate the function's catalogue with `npm run build:estimate-catalogue` whenever `src/data` changes.

## 8. Routes and sheets

| Path | Screen |
|---|---|
| `/` | S08 Today |
| `/diary` (`?day=`) | S12 Diary day |
| `/diary/week` (`?week=`) | S13 Diary week |
| `/diary/entry/:id` | S14 Entry detail / edit |
| `/insights` | S31 Insights |
| `/insights/weekly` | S33 Weekly review |
| `/more` | S48 More |
| `/more/weight` | S16 Weight |
| `/more/settings` | S19 Settings |
| `/more/export` | S20 Export |
| `/log/estimating` | S10 Estimating |
| `/log/review` | S11 Review |
| `/log/plate` | S24 Plate builder |
| `/ideas` | S36 Meal ideas |
| `/setup/*` | S01–S07 |
| `/dev` | Component gallery |

Sheets open over the current tab via the `?sheet=` search param: `log` (S09), `budget` (S17), `makan` (S18), `checkin` (S15), `evidence` (S32, with `&rule=<ruleId>`). The bottom nav is visible on tab roots and while a sheet is open; hidden on sub-screens.

### 8.1 Screen files and navigation contract

- Paths: `src/app/paths.ts` (`PATHS`, `SheetName`, `Tab`). Never hard-code paths.
- Sheets: `useSheet()` from `src/app/navigation.ts` → `{ sheet, params, open(name, extra?), close() }`. Opening pushes history so the phone's back button closes the sheet.
- Route table: `src/app/routes.tsx`. Each route has a handle `{ tab: Tab | false }`; `false` hides the nav.
- Screen files (default export = the route element): `src/screens/Today/TodayScreen.tsx` (S08), `src/screens/Log/{EstimatingScreen,ReviewScreen,PlateScreen}.tsx` (S10, S11 + S14 edit mode, S24), `src/screens/Diary/{DiaryDayScreen,DiaryWeekScreen,EntryScreen}.tsx` (S12–S14), `src/screens/More/{MoreScreen,WeightScreen,SettingsScreen,ExportScreen,ComingSoonScreen}.tsx` (S48, S16, S19, S20, later-phase placeholder), `src/screens/Insights/{InsightsScreen,WeeklyReviewScreen}.tsx` (S31, S33), `src/screens/Ideas/IdeasScreen.tsx` (S36), `src/screens/Setup/SetupFlow.tsx` (S01–S07).
- Sheet content files: `src/screens/sheets/{LogSheet,BudgetSheet,MakanSheet,CheckInSheet,EvidenceSheet}.tsx`. Each default-exports `({ close }) => content`; the shell wraps it in `BottomSheet` (check-in is not dismissible by scrim).
- Screens render inside the shell's scroll column. They start with their TopBar/SubScreenHeader at the design's `padding: 4px 20px 0` (the shell adds the status-bar safe area). Tab screens leave `var(--content-pad-nav)` bottom padding; screens with a floating `RangeTotal` leave `var(--content-pad-footer)`.
- Moving between logging steps uses the Zustand `reviewDraft` (`src/state/ui.ts`): set the draft, then navigate to `PATHS.review`. The draft's `backTo` says where Back goes.
- Phase 2 screens (all `tab: false`, reached from More): `src/screens/Places/{PlacesScreen,PlaceDetailScreen}.tsx` (S21, S22 — `PATHS.places`, `PATHS.place(id)`), `src/screens/Usuals/UsualsScreen.tsx` (S23 — `PATHS.usuals`), `src/screens/Pots/{PotsScreen,NewPotScreen,PotDetailScreen}.tsx` (S26–S28 — `PATHS.pots`, `PATHS.potNew`, `PATHS.pot(id)`), `src/screens/Activity/{ActivityScreen,LogWorkoutScreen}.tsx` (S30, S29 — `PATHS.activity`, `PATHS.workoutNew`). Goals, Reminders and Backups still route to `PATHS.soon(...)`.

## 9. Demo mode

`profile.demoMode` pins the clock (`clock.ts`) to Fri 16 Oct 2026 7:10pm MYT and loads `seed/demo.ts`. It exists so the app can be compared screen by screen with the prototype. Real use starts from Setup (S01–S07). Settings can switch demo mode off and clear demo data.

## 10. Decisions taken during the build

1. **Savings only accrue from confirmed finished days** (`design/README.md` behaviour rules). Unconfirmed days count overspend immediately but hold back their savings until the morning check-in confirms them (`pendingSavedKcal`). This is stricter than the plan's day-status table, and the plan's table has been updated to match.
2. **Hero = number + week bars** (design change note). C07 is implemented as `HeroCard`; no ring.
3. **Trend smoothing α = 0.25** to match the design's chart and its 77.9 kg sample (the plan's "~10-day smoothing" was a placeholder to tune).
4. **Week dates**: the prototype's "13–19 Oct" and "6–12 Oct" labels are off by one; with Fri = 16 Oct 2026 the weeks are 12–18 Oct and 5–11 Oct. Dates are always computed, never hard-coded.
5. **Macro targets in demo data** use the design's 110 / 180 / 60 g; new users get `defaultMacroTargets()`.
6. **Toast "Undo"** departs from README C05: `--accent` on the dark `--nav` fails WCAG AA in dark mode, so the toast uses an accessible pairing. Flag to design.
7. **Demo last week includes last Tuesday's futsal**, so the weekly review reads "+350 · 13,420 of 13,070" rather than the design's "12,950 of 12,600" (which forgot the workout).
8. **Text meals call the AI endpoint first when it's configured** (local matches are sent as candidates). Usuals, Place orders, the plate builder and pots never call AI.
9. **What you type outranks where you are**: an anchor like "nasi kandar" in the text picks the nasi kandar pieces even at an economy-rice Place. A typed meal with several parts is named by its first part ("Nasi kandar ayam goreng"); otherwise the name comes from the items.
10. **A pot gives what it has**: `logPotServing` clamps to the servings left and the meal records exactly what the pot gave; an empty pot or one past its clear day refuses with an error the caller shows.
