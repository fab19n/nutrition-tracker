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
- Local-first storage: Dexie 4 (IndexedDB) + `dexie-react-hooks` (`useLiveQuery`). Sync is a Dexie DBCore middleware outbox (`src/db/capture.ts`) and an engine (`src/sync`) over the `sync_*` functions in `supabase/sync.sql` (§6.2). Screens and repository functions don't know about it.
- Account: Supabase Auth (email and password), loaded lazily (`src/auth`). It protects sync and the AI estimate function; everything else works without it.
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
  auth/           Supabase client (the only value import of supabase-js) and the session
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
  sync/           Two-way sync (§6.2): wire mapping, local transactions, remote, engine, status copy, hooks; testing/fakeServer
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
fmtAgo(thenMs, nowMs, tz) → 'just now' | '5 min ago' | 'at 9:40pm' | 'yesterday at 9:40pm' | 'on Fri 16 Oct'   (real clock, calendar days)
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

- `db.ts`: Dexie database `kira-makan`, version 2.
  - Version 1, the data tables (`SCHEMA_V1`, primary key first):
    `profile ('id')`, `goals ('id, status')`, `goalVersions ('id, goalId, effectiveFrom')`, `goalPeriods ('id, goalId, from')`,
    `meals ('id, logicalDay, eatenAt, placeId, slot')`, `weights ('id, logicalDay, measuredAt')`, `workouts ('id, logicalDay')`,
    `bonuses ('id, logicalDay')`, `days ('logicalDay, status')`, `weekPlans ('weekStart')`, `places ('id, name')`,
    `usuals ('id, placeId')`, `pots ('id, expiresOn')`, `photos ('id')` (Blob + thumbnail Blob), `insightFeedback ('ruleId')`,
    `suggestionEvents ('id, at')`, `personalItems ('id, catalogueId, placeId')`.
  - Version 2 adds the sync bookkeeping (`SYNC_STORES`, §6.2), with no upgrade function: `syncOutbox ('[table+key], changedAt')`,
    `syncRevs ('[table+key]')`, `syncMeta ('id')` (one row, `id: 'sync'`). Row types are in `syncTypes.ts`.
  - `SCHEMA_V1`, `TableName` and `TABLE_NAMES` list the 17 data tables only, so export and import never see the sync tables.
    `db.tables` has 20, so every wipe (`clearAllTables`, setup, the demo load) clears the sync state with the data.
  - `SYNC_TABLES` is every data table except `photos` (16). `createDb(name, { capture })` builds a database with capture
    off unless asked; the `db` singleton captures only when Supabase is configured.
- `repo/*.ts`: plain async CRUD per table (no React).
- `actions.ts`: user intents, each a transaction: `saveMeal(draft)`, `updateMeal(id, patch)`, `deleteMeal(id) → undo()`, `confirmDay(day, choice)`, `addWeight(kg, at?)`, `planMakanDay(day | null)`, `setWeeklyFocus(weekStart, focus)`, `addWorkout(...)`, `addBonus(...)`, `logPotServing(potId, servings)`, `completeSetup(input)`, `loadDemoData()`, `resetAll()`.
- `hooks.ts`: live-query hooks for screens (see §6.1). Hooks combine Dexie data with the engine; screens never call the engine for budget maths directly.
- `seed/defaults.ts`: goal templates (Cut, Festive maintain, Lean bulk, Pause) with timing rules and suggestion weights.
- `seed/demo.ts`: the design's sample world (design_handoff.md §9) anchored to the demo clock: week Mon 12 – Sun 18 Oct 2026, today Fri 16 Oct 7:10pm; last week 5–11 Oct for the weekly review; weights 3–16 Oct; Places, Usuals, the kari ayam pot, last week's futsal.
- `export.ts`: full JSON export/import and CSV (meals, items, weights, workouts). Import deletes the rows missing from the file, then puts the file's rows (photos are cleared and put), so an import becomes the account's state on every device.

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

### 6.2 Sync contract

One user with a phone and a laptop. Each device's IndexedDB stays its working copy; the account holds a copy of every synced row, and devices exchange changes with it. Screens never call sync, and nothing syncs until the device is signed in and linked.

| File | Role |
|---|---|
| `supabase/sync.sql` | The server. `sync_accounts` (one per user: `dataset` id, `rev` counter; `on delete restrict` from `auth.users`) and `sync_rows` (one per `(user_id, tbl, row_key)`: jsonb `data` or a tombstone, `rev`, `changed_at`, `device_id`, `nonce`). RLS lets a user read only their own rows, nobody writes the tables directly, and nothing is granted to anon. All access goes through `sync_hello`, `sync_pull`, `sync_keys` and `sync_push`. It is pasted into the SQL Editor (DEPLOY.md steps 19–20) and kept out of `supabase/migrations`; `sync-selftest.sql` checks it and changes nothing. |
| `src/db/capture.ts`, `src/db/syncTypes.ts` | The DBCore middleware that writes outbox markers, and `markUncaptured()`. Types of the bookkeeping rows (`OutboxEntry`, `RowRev`, `SyncMeta` with its `SyncLink`, `SyncErrorKind`). |
| `src/sync/rows.ts` | Local row ↔ wire JSON, device-only fields, the content hash (`wireHash`, `isRealChange`). |
| `src/sync/local.ts` | Every sync transaction: link, collect and acknowledge a push, apply a pulled page, restore, record status. |
| `src/sync/remote.ts`, `errors.ts` | The four RPCs through supabase-js (type imports only; the client comes from `getSupabase()`), hand-written reply parsers, and `SyncError` with its kind. |
| `src/sync/engine.ts`, `index.ts` | When to sync and what to do: gate, cycle, triggers, retry, the user's choices. `index.ts` builds the app's engine lazily and exports the wrappers (`startSync`, `stopSync`, `resumeSync`, `syncNow`, `flushSync`, `restoreFromAccount`, …). |
| `src/sync/status.ts`, `hooks.ts` | `describeSync(view, nowMs, tz)`, the card copy for every phase; `useSyncView()` and `usePendingMealIds()` (the "Waiting to sync" badge, shown only while sync is stuck). |
| UI | `components/SyncStatus` (presentational card), `screens/More/SyncGroup.tsx` ("Account and sync", first in Settings when Supabase is configured), `screens/Setup/RestoreSheet.tsx` (Welcome › Restore from your account). |
| `src/sync/testing/fakeServer.ts` | `sync.sql` in memory, with the same rules and JSON, for tests. |

**Capture** (the header of `capture.ts` is the reference)

- Every read-write transaction that touches a synced table also opens `syncOutbox`, and each written key gets a marker `{ table, key, changedAt: Date.now(), nonce }` in the same transaction, so it commits or rolls back with the write. No call site changes.
- The outbox is coalesced: one entry per `[table+key]`, replaced by every write (which keeps its `seenRev`, below). The push reads the row as it is then: present means put, missing means delete (a tombstone). Undo needs nothing special; it is a new write.
- **`clear()` is local only.** `Table.clear()`, and any delete of a whole table (`toCollection().delete()`, `orderBy(…).delete()`), is never captured, so Delete everything, leaving demo, setup and the demo load never reach the account. A deletion that must reach other devices uses `delete`, `bulkDelete`, `where(index).equals(…).delete()` or a primary-key range.
- **`markUncaptured()`** is the first line inside `db.transaction()` for writes that must not sync: applying pulls and push answers, restore, linking, the demo load. Nested transactions share it; outside a transaction it throws.
- Nothing is captured while capture is off (Supabase not configured, or a `createDb()` database not given `{ capture: () => true }`), while the demo clock runs, for `photos`, or for the sync tables.
- **String keys only.** Every synced table's primary key is a string property, never `++` auto-increment. A non-string key is never recorded.

**Rows**

- A row travels as its JSON (undefined fields drop), under its primary key value. Strings lose U+0000 and a lone UTF-16 surrogate becomes U+FFFD, since Postgres refuses both; the hash is taken over the same JSON.
- **Device-only fields never sync:** the profile's `theme`, `useLocation` and `demoMode` (`DEVICE_PROFILE_FIELDS`), and a meal's `syncState` (deprecated). A row that arrives keeps this device's values; a fresh device takes its stored `km-theme` (or `'system'`) and `useLocation: false`. Sync never sets `demoMode`. Everything else syncs, `aiEstimates`, `keepPhotos`, `rolloverHour` and `timeZone` included. Preferences kept in localStorage (`km-theme`, Usual suggestion dismissals, the last export, the location primer) stay on the device too.
- **New fields must be optional.** Sync writes whole rows, and an older app version that rewrites a row drops the fields it doesn't know, so every reader treats a missing field as its default.
- **A new synced table means bumping `SYNC_PROTOCOL`** (`db.ts`). Each device then pulls from revision 0 once and picks up the rows it skipped (a pull skips tables this version doesn't know). Photos will join this way.
- `syncRevs` keeps, per row, the account revision this device last saw or sent and the hash of that version. A write that changes nothing that syncs (a theme toggle, a `syncState` flip) never pushes, so it can't beat a real edit made on another device.

**Conflicts** (settled by `sync_push`, per row, first match wins)

1. A key new to the account applies.
2. A retry of the same edit (same device and nonce) is answered `ok` and adds nothing.
3. An edit made on the current copy applies: its `base` (the revision this device last had) equals the current revision, or the current copy came from this same device.
4. Otherwise the later edit wins, by device time corrected for the device's clock offset, `least(at + (server now − sent at), server now)`; a tie goes to the larger device id. The loser is answered `lost` with the winner, which the device applies.

- Whole rows win, with no field merge and no history: counters and derived fields (`Pot.servingsLeft`, `Usual.useCount`, a Place's learned defaults) and natural-key rows (`days`, `weekPlans`, `insightFeedback`, `profile`) included.
- Tombstones are kept forever and follow the same rules: an edit made after a delete brings the row back, and an older edit loses to the delete.
- The profile is never deleted by sync: the server answers `invalid` to a profile tombstone or a demo profile, and a pull skips a profile tombstone.
- A row answered `invalid` is set aside (`failedAt`) until the next app start, so one bad row never blocks the queue. A push refused whole (`rejected`: 400 or 22xxx) is halved until the refused rows are found, and they are set aside the same way; when an empty push is refused too, the call itself is the problem and the cycle fails `rejected`.
- References (`placeId`, `potId`, `goalId`, `photoId`) may point at rows that haven't arrived yet; screens already treat a missing row as none.

**Revisions and the cursor**

- `sync_push` hands out revisions under a row lock on the account, so they commit in order: a pull that has seen revision n has seen every revision below it.
- The device's cursor moves only in the transaction that applied the rows (`applyPage`), or in the push acknowledgement when no one else wrote in between (`prevHead === cursor`) or when it goes back for a skipped revision (below).
- Every sync transaction re-reads `syncMeta` inside it. A link that changed (a wipe, a sign-out, another tab) throws `SyncError('aborted')` and writes nothing; an answer from another dataset throws `cloudReset`. Correctness never rests on the Web Lock.
- A pulled row that has a real pending change here is left for the push to settle. The change notes that revision (`seenRev`, kept through later edits); if it then comes to nothing (an undo), the acknowledgement moves the cursor back so the next pull fetches that revision again, and a change that changes nothing never beats the other device's edit.

**Engine**

- `App.tsx` calls `startSync()` at start-up and reloads the page on Dexie `versionchange`. Without Supabase configured the engine is inert. With a stored session it loads supabase-js after 1.5 s; without one, not until a sign-in.
- Tasks (a cycle, a restore, a choice) run one at a time per tab, inside the `kira-makan-sync` Web Lock when the browser has one.
- **Gate**, in order: configured, a profile, not demo, not paused, the session read, signed in, online, linked, linked to the signed-in user. Each stop has its phase (`unconfigured`, `noProfile`, `demo`, `paused`, `starting`, `signedOut` or `needsSignIn`, `offline`, `otherAccount`), and the Settings card describes it. Signed out with a session still stored (a refresh that failed on a bad connection) asks `getAuth()` anyway, so it reads as offline or unreachable rather than as a sign-out, on the card too.
- **First link** (signed in, a real profile, no link) starts with `sync_hello`. An account with no live rows gets this device's data: every local row is queued (the profile first, then the goal tables, then the rest, and the push sends the oldest first) and uploaded (`uploading`, with progress). Just before that upload it looks once more (`sync_pull` from the head `sync_hello` saw); if another device got there first, it unlinks and asks. The look is durable: `linkEmptyAccount` stores the link with `checkPending`, nothing is pushed while it is set, and every cycle that finds it looks again first; an empty look clears it in a transaction that re-reads the link (`clearCheckPending`), and one with rows unlinks, keeping the data (`unlinkUnchecked`), and runs the link flow again. A look that fails, or a cycle stopped before it, fails the cycle as usual and leaves the flag set. An account with data waits for the user (`choose`): **Use the account's data** downloads everything and replaces this device's data in one transaction; **Keep this device's data** uploads this device's rows and a tombstone for every account row it lacks; **Not now** pauses sync on this device. Two diaries are never merged.
- **Restore before setup** (Welcome › Restore from your account): with no profile, download everything into memory, then write it in one transaction with the profile in the same commit, so the app moves to Today on complete data. An account with no live rows gives "Nothing to restore yet"; one with rows but no profile yet (another device's first upload is part way) gives "Your diary is still uploading", with Try again. Neither writes anything.
- **Cycle:** push (`collectPush` → `sync_push` → `ackPush`; up to 200 changes or about 512 KB a batch, 25 batches), then pull (`sync_pull`, 500 rows a page, 20 pages), for up to 3 rounds; then `idle`.
- **Triggers:** a change (2 s debounce, 10 s at most), `online`, coming back to the app after 30 s, a session change (after a refused token, an auth event for the same session too: a refreshed token, the same user signing in again), Sync now (a sign-in from Settings runs it too), and a 5-minute poll while visible. Going hidden pushes what's queued. Session listeners run inside supabase-js's auth lock, so the engine defers its work with `setTimeout(0)` and never awaits Supabase there.
- **Retry by kind** (`toSyncError` maps HTTP status and Postgres or PostgREST codes): `offline` waits for `online` or visible, plus a 2-minute probe; `unreachable`, `unavailable`, `rejected` and `failed` back off 10 s, 30 s, 2 min, 5 min, then every 15 min (±20 %); `needsSignIn` retries once straight away, then waits for a session change or a new token; `notSetUp` (the SQL isn't there) retries only on start, visible or Sync now; `cloudReset` and `otherAccount` wait for the user; `aborted` is silent.
- **A refused token can't spin.** In a refusal streak (every token refused, say after the project's JWT signing keys changed, while each look refreshes the token and fires an auth event), an auth event for the same session runs a cycle only when `getAuth()` now gives another token than the one refused last (an in-memory short hash, never stored or logged): the first time at once, then at most once a minute, on the backoff (1, 1, 2, 5, then every 15 min). A cycle that goes through, another user, signing out or in, and Sync now end the streak.
- **The card** (`describeSync`): `error` from `unreachable` or `unavailable` says it can't reach the account; from `rejected`, that the account refused the last sync, pointing at Supabase › Logs (DEPLOY.md); from `failed` (a local error, an answer this version can't place, another device linking at the same moment), "Sync stopped on a problem", blaming no one. `needsSignIn` while the session still reads signed in (a refused token) offers Try again and Sign out instead of Sign in. Sync copy says "this device", never "this phone": a laptop syncs too.
- **Sign out** flushes the queue for up to 5 s first. The link, queue and cursor stay; signing in as the same user resumes, and another user gives `otherAccount`.
- **Delete everything** stops the engine, wipes this device (data, queue, link), then resumes. The account copy stays, so signing in again and restoring brings it back. Wiping the account copy is a SQL step (DEPLOY.md); devices then show `cloudReset`.
- **Demo never syncs**, by four guards: `loadDemo` is uncaptured and clears the sync tables, the demo clock skips capture, the gate refuses a demo profile, and `demoMode` is stripped on push, never applied on pull, and refused by the server.

**Tests and server changes**

- Tests drive the engine through `SyncEngineDeps` (a fake remote, session, timers and locks) and never call a live Supabase project. `fakeServer.ts` follows `sync.sql` and covers the same cases as `sync-selftest.sql`.
- A server change ships as a new file to paste (`sync-002.sql`, …), mirrored in the fake server and the self-test. To change a function's arguments, drop the old signature first: `create or replace` with different arguments adds an overload.

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
- Server: `supabase/functions/estimate/core.ts` (shared) → `index.ts` (Supabase Edge Function, Deno) and `server/devEstimatePlugin.ts` (POST `/api/estimate` on the Vite dev server when `ANTHROPIC_API_KEY` is set). Claude (`claude-sonnet-5-5`, chosen for cost; effort low, structured output, server-side fallback, compact catalogue prompt sent uncached because meals are hours apart) only identifies catalogue ids, portions and unknown items; macros for catalogue items come from the catalogue. Regenerate the function's catalogue with `npm run build:estimate-catalogue` whenever `src/data` changes.

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

`profile.demoMode` pins the clock (`clock.ts`) to Fri 16 Oct 2026 7:10pm MYT and loads `seed/demo.ts`. It exists so the app can be compared screen by screen with the prototype. Real use starts from Setup (S01–S07), or from Welcome › Restore from your account on a device whose account already holds a diary. Settings can switch demo mode off and clear demo data. Demo data never syncs (§6.2).

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
11. **Sign-in is email + password, typed in the app** (`src/auth/session.ts`, `SignInPanel`). It replaced emailed 6-digit codes: on new free Supabase projects the built-in mailer's templates can't be edited, so its email carries only a link, and an emailed link opens Safari instead of the installed iPhone app. Password sign-in sends no email, needs no SMTP, and works with password-manager autofill. A long random password from a password manager is what stops guessing. Supabase's per-IP token limit (password sign-ins share it with refreshes) and the estimate function's `ALLOWED_EMAILS` check back it up.
12. **Two-way sync is whole-row, later-edit-wins, with a base revision** (§6.2). One generic row store in Supabase, an outbox written by a Dexie middleware, and a per-account revision cursor; no Realtime, no field merge, no CRDTs, no history. An edit made on the copy it last saw always applies, so edits made one after another on the phone, then the laptop, are never lost to clock skew; only two edits that never saw each other are settled by time, offset-corrected on the server, and the overwritten version is not kept. With one user this needs both devices offline and editing the same entry. Product decisions, confirmed by the owner:
    - **Delete everything wipes only this device.** The account copy stays, and signing in and restoring brings it back. Wiping the account copy is a SQL step in DEPLOY.md, with no button in the app.
    - **When this device and the account both hold data at first link, the app asks**: Use the account's data, Keep this device's data, or Not now, with a confirm before either replacement. Merging two separate setups would give two active goals, duplicate Places and a duplicate setup weigh-in.
    - **The existing phone uploads automatically** the first time it links to an empty account; the Settings card shows the progress.
    - **Theme, location permission and demo mode are per device.** Everything else in the profile syncs.
    - **Sync timing:** about 2 s after a save, on opening the app or coming back to it, on reconnecting, and every 5 minutes while it's open. The laptop can lag the phone by up to 5 minutes while both are open.
    - **Photos stay on the device for now.** A later step adds a private Storage bucket (`kira-photos/{uid}/{id}.jpg`) and a photo row in `SYNC_TABLES` behind a `SYNC_PROTOCOL` bump; `keepPhotos` will decide what uploads.
    - **The account lives in the owner's Supabase project.** `sync_accounts` references `auth.users` with `on delete restrict`, so deleting the user can't silently erase the synced diary: a lost password is reset in place (DEPLOY.md).
