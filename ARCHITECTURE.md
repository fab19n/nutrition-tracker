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
- Push: Web Push (VAPID, aes128gcm) from the `send-reminders` Edge Function, run by pg_cron every 5 minutes; the worker is `src/sw.ts` (vite-plugin-pwa `injectManifest`).
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
  drive/          Google Drive photo sync (§10.18): GIS token, Drive REST, engine, status copy, hooks; testing/ fakes
  push/           Reminders on this device (§10.19): subscription engine, remote, status copy, hooks; testing/ fakes
  sw/             Service worker handlers (push, notificationclick, pushsubscriptionchange); the worker entry is src/sw.ts
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
fmtKg(77.9) → '77.9 kg'          fmtKgDelta(-0.4) → '−0.4 kg'   fmtKgRate(0.2348) → '0.25 kg' (paces and trend rates, nearest 0.05)
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
export function macrosForTarget(dailyKcal: number, proteinG: number): { proteinG; carbsG; fatG }; // keeps protein; fat and carbs as above (1,550 / 110 → 110 / 165 / 50)
export function paceOf(goal: Pick<Goal,'paceKgPerWeek'>, version?: Pick<GoalVersion,'paceKgPerWeek'>): number; // version.paceKgPerWeek ?? goal.paceKgPerWeek
```
Paces are versioned (decision §10.13): read a pace with `paceOf(goal, version)`, never `goal.paceKgPerWeek` alone.

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
export function proratedWeek(days: { day; targetKcal: number | null }[], today: LogicalDay, newKcal: number):
  { startsOn: LogicalDay; sameWeek: boolean; groups: { days: number; kcal: number }[]; totalKcal: number };
//   this week with newKcal from tomorrow (paused days left out): "5 days at 1,800 + 2 days at 1,550 = 12,100"; Sunday → sameWeek false
export function switchedWeek(days: { day; targetKcal: number | null }[], today: LogicalDay, targetAfter: (day: LogicalDay) => number | null):
  { startsOn; sameWeek; groups; totalKcal; pausedDays: LogicalDay[] };
//   S44: this week with another goal from tomorrow (null = paused); paused days are skipped without breaking a group and listed
//   in pausedDays: Fri switch to Festive → "5 days at 1,800 + 2 days at 2,100 = 13,200"; to Pause → "5 days at 1,800 = 9,000", Sat and Sun
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
export const MIN_WEIGH_INS = 8, MIN_WEIGH_IN_SPAN_DAYS = 14, KEEP_CURRENT_DAYS = 28, TREND_SETTLE_DAYS = 10;
export function checkTarget(input: { today; days: MaintenanceDay[]; trend: TrendPoint[]; goal?; latest?: GoalVersion; switching?: boolean; dailyMinimumKcal: number; kept?: KeptTarget }): TargetCheck;
//   kinds: noTarget (noGoal | paused | switching) · tooEarly (< 21 complete days) · needWeighIns (< 8, or spread < 14 days, or the
//   trend's run started too recently: needSpanDays 17 from its first day) ·
//   onTrack (|Δ| ≤ 100, or the target would stay the same: sameTarget) · suggestion · kept (after Keep current)
export function maintenanceWorking(estimate): string; // "You logged ~1,820 a day, and your trend dropped 0.25 kg a week."
```
`checkTarget` reads the 28 days to last Sunday (`basis: 'weekly'`, the same number Mon–Sun on every device); only while that
read is blocked does it read the 28 days to yesterday (`'daily'`). It compares with the goal's newest version, a pending one
included. The slope only uses trend points at least `TREND_SETTLE_DAYS` into their run (a run starts at the first weigh-in, or
after a gap of 10+ days), so a setup weight typed 1 kg off the morning scale moves maintenance by ~30 kcal, not ~230. Worked example (a unit test, `src/test/maintenanceWorld.ts`): Fri 30 Oct 2026, window 28 Sep–25 Oct, ~1,822 a day,
trend −0.25 kg a week → maintenance 2,100; 2,350 / 1,800 at 0.5 kg → suggested 1,550, or 0.25 kg → 1,825.

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

### 5.12 `goals.ts` — goal periods, switching, end conditions, the S42/S43 draft (plan §6, decision §10.14)
```ts
export function comparePeriods(a: GoalPeriod, b: GoalPeriod): number;      // from, then createdAt ?? '' (older rows first), then id
export function periodOn(periods, day): GoalPeriod | undefined;             // of the periods covering day (to exclusive), the last by comparePeriods
export function everInForce(periods, goalId, today): boolean;              // a period of the goal with from ≤ today
export function inUseAfter(periods, goalId, today): boolean;               // a period of the goal with to undefined or > today
export function activeGoalIdAfter(periods): Id | undefined;                // the goal of the open-ended period that sorts last
export function goalWeek(period, today): number;                           // floor(days since from / 7) + 1, at least 1
export function planGoalSwitch({ periods, today, goalId, until?, resumeGoalId?, newId, createdAt }): PeriodPlan;
//   T = tomorrow; remove periods with from ≥ T; cap periods reaching past today at to = T; add { goalId, from: T, createdAt } (to: until
//   for a dated pause, plus { resumeGoalId, from: until }); until must be T+1 … T+60 and needs resumeGoalId (RangeError). Past rows never change.
export function planCancelSwitch(periods, today): PeriodPlan | undefined;   // remove from ≥ T; today's period put back without `to`
export function endConditionState(end, { today, trendKg?, paceKgPerWeek }): EndState; // none · date (reached on the day) · weight (by the trend, in the pace's direction; pace 0 never)
export function endKey(goalId, state): string | undefined;                  // `${goalId}:date:${date}` · `${goalId}:weight:${kg}`
export function goalDraftFor(template, { name, maintenanceKcal, weightKg, dailyMinimumKcal }): GoalDraft; // presetFor + dailyTargetFor + defaultMacroTargets
export function validateGoalDraft(draft, { today, dailyMinimumKcal, trendKg?, kcalChanged, endChanged }): GoalDraftErrors; // {} when valid; an unchanged target or end is never an error
export function sameEndCondition(a, b): boolean;                            // same date and weight (none = none); callers pass !sameEndCondition(stored, draft) as endChanged
export function uniqueGoalName(base, taken): string;                        // 'Cut' → 'Cut 2' → 'Cut 3' (case-insensitive)
export class GoalChangedError extends Error;  export class GoalDraftError extends RangeError { errors }
```
Constants: `GOAL_NAME_MAX 40`, `TARGET_KCAL_MAX 5000` (step 50, the minimum is the daily minimum), `PROTEIN_LIMIT 40–250` (step 5),
`PACE_CHOICES 0.25 / 0.5 / 0.75`, `CUSTOM_PACE_CHOICES 0 / 0.25 / 0.5 / 0.75`, `RANGE_CHOICES 5 / 10 / 15%`, eating window 8–16 h,
last meal 1–4 h before sleep, grazing 3–8 occasions, `PAUSE_UNTIL_MAX_DAYS 60`, `END_DATE_MAX_DAYS 730`, end weight 30–300 kg.
`src/domain/insights/groups.ts`: `INSIGHT_GROUPS` (food · protein · timing · weight) and `rulesOffFor(goal)`; `evaluateInsights` leaves
an off group's rules out of `ranked`/`top` (and so the weekly focus options), `all` still holds them; the maintenance estimate is in no group.

## 6. Data layer contracts (`src/db`)

- `db.ts`: Dexie database `kira-makan`, version 3.
  - Version 1, the data tables (`SCHEMA_V1`, primary key first):
    `profile ('id')`, `goals ('id, status')`, `goalVersions ('id, goalId, effectiveFrom')`, `goalPeriods ('id, goalId, from')`,
    `meals ('id, logicalDay, eatenAt, placeId, slot')`, `weights ('id, logicalDay, measuredAt')`, `workouts ('id, logicalDay')`,
    `bonuses ('id, logicalDay')`, `days ('logicalDay, status')`, `weekPlans ('weekStart')`, `places ('id, name')`,
    `usuals ('id, placeId')`, `pots ('id, expiresOn')`, `photos ('id')` (Blob + thumbnail Blob), `insightFeedback ('ruleId')`,
    `suggestionEvents ('id, at')`, `personalItems ('id, catalogueId, placeId')`.
  - Version 2 adds the sync bookkeeping (`SYNC_STORES`, §6.2), with no upgrade function: `syncOutbox ('[table+key], changedAt')`,
    `syncRevs ('[table+key]')`, `syncMeta ('id')` (one row, `id: 'sync'`). Row types are in `syncTypes.ts`.
  - Version 3 adds the Drive photo bookkeeping (`DRIVE_STORES`, local only): `driveJobs ('id, notBefore')`,
    `driveMeta ('id')`, with no upgrade function; `db.tables` has 22. Row types are in `driveTypes.ts`.
  - `SCHEMA_V1`, `TableName` and `TABLE_NAMES` list the 17 data tables only, so export and import never see the sync or
    Drive tables. Every wipe (`clearAllTables`, setup, the demo load) clears `db.tables`, so the sync and Drive state go with the data.
  - `SYNC_TABLES` is every data table except `photos` (16): photos travel through Google Drive, and the meal carries the pointer. `createDb(name, { capture })` builds a database with capture
    off unless asked; the `db` singleton captures only when Supabase is configured.
- `repo/*.ts`: plain async CRUD per table (no React).
- `actions.ts`: user intents, each a transaction: `saveMeal(draft)`, `updateMeal(id, patch)`, `deleteMeal(id) → undo()`, `confirmDay(day, choice)`, `addWeight(kg, at?)`, `planMakanDay(day | null)`, `setWeeklyFocus(weekStart, focus)`, `addWorkout(...)`, `addBonus(...)`, `logPotServing(potId, servings)`, `completeSetup(input)`, `loadDemoData()`, `resetAll()`.
- `hooks.ts`: live-query hooks for screens (see §6.1). Hooks combine Dexie data with the engine; screens never call the engine for budget maths directly.
- `seed/defaults.ts`: goal templates (Cut, Festive maintain, Lean bulk, Pause) with timing rules and suggestion weights, plus the Custom preset (`presetFor(template)`, `NEW_GOAL_TEMPLATES` for S43).
- `seed/demo.ts`: the design's sample world (design_handoff.md §9) anchored to the demo clock: week Mon 12 – Sun 18 Oct 2026, today Fri 16 Oct 7:10pm; last week 5–11 Oct for the weekly review; weights 3–16 Oct; Places, Usuals, the kari ayam pot, last week's futsal.
- `export.ts`: full JSON export, CSV (meals, items, weights, workouts) and the restore of a JSON file, in two steps so a screen can show the file before anything changes. `readBackup(file)` checks the file and writes nothing; it throws a `BackupImportError` whose `reason` is `notJson`, `notABackup` (also a version that isn't a number), `newerVersion`, `badRow` (a row of the wrong shape, or a profile whose time zone or rollover hour would break every date), `unreadable` or `tooBig` (over 128 MB, refused before reading). A table the file doesn't list is left alone; a listed empty one empties it. `assertRestorable` refuses a file with no diary (`incomplete`) or the sample week (`sampleData`); `previewOf` and `compareWithDevice` describe it against this device. `restoreBackup(db, backup, { deviceDefaults })` is the app's restore: one transaction that deletes the rows the file lacks by key (never `clear()`) and puts the file's rows, keeps this device's `theme` and `useLocation`, forces `demoMode` off, and, when the file left photos out, keeps the photos meals point to and deletes the rest. Its writes are captured, so with sync on the account follows the file. `importAll(db, file)` is the raw replace (the file's profile as it is, photos wholesale) for tools and tests.

### 6.0 As built (read the code; these supersede the sketches below)

- Repo functions take the database first: `listMealsForDay(db, day)`. App code passes the `db` singleton.
- `src/db/actions.ts` exports bound actions (and `createActions(db)` for tests). `saveMeal(draft)` returns `{ meal, undo }`; `deleteMeal`, `deleteWeight`, `deleteWorkout`, `deleteBonus` return an `undo()`; `planMakanDay(weekStart, day | null)`; `syncDemoClock()` must run before the first render (the shell does it).
- `src/db/selectors.ts` holds framework-free reads; `src/db/hooks.ts` wraps them with `useLiveQuery`. Hooks return supersets of §6.1 (e.g. `useActiveGoal` → `{ goal, version, period, paused }`, `useWeekBudget` → `{ budget, plan, goal, version, days, dailyMinimumKcal }`). Extra hooks: `useHasProfile` (tells "no setup yet" apart from loading), `useMeal`, `useProteinLeft`, `useFestiveDaysInRange`, `usePersonalItems`. Single-row hooks return `undefined` both while loading and when missing.
- `getCheckIn()` returns the newest unconfirmed day with a `queue` of older ones and the four choices with their consequence copy.
- The trend is a plain EMA (α 0.25). On the design's 14 readings the latest trend is 77.99 → "78.0 kg" (the design's "77.9" copy was hand-written).
- Target suggestion (S37, decision §10.13): `src/db/targetSuggestion.ts` holds `getTargetCheck` / `getTargetView` / `useTargetView`,
  the actions `approveTarget(choice)`, `keepCurrentTarget({ versionId })`, `cancelPendingTarget(versionId)` (each refuses stale
  numbers with `TargetChangedError` and returns an undo) and the per-device notice store (`kira-makan:target-notice-seen`).
  `cancelPendingTarget` and the approval's undo remove **every** `approvedSuggestion` version of the goal for that day (two devices
  can each approve offline), by key with `bulkDelete`; the cancel's undo puts them all back. `useTargetDecisions(view)` keeps the
  buttons locked after a decision until the live `view` shows it. The Insights "Your real maintenance" unlock row follows the check.
  Rows: new optional `GoalVersion.paceKgPerWeek` (written on every approved version), feedback value `'keepCurrent'` with optional
  `InsightFeedback.keptTarget` in the row `ruleId: 'targetSuggestion'`. No new table, no Dexie or `SYNC_PROTOCOL` bump.
- Goals (S41–S44, decision §10.14): `src/db/goals.ts` holds the reads `getGoalLibraryIn` / `useGoalLibrary` (current with its week, a
  booked `next`, saved, the templates no goal of their own covers, ended with `lastUsed`, a reached `end`), `getGoalDetailIn` /
  `useGoalDetail` (`{ detail: null }` when missing; role current · next · saved · ended · template), `getNewGoalDefaultsIn`,
  `getSwitchPreviewIn` / `useSwitchPreview` and `getGoalEndCheckIn` / `useGoalEnd`, and the actions `createGoal(draft)`,
  `saveGoalEdits(id, draft)`, `switchGoal(id, { until? })`, `cancelGoalSwitch()`, `archiveGoal(id)`, `restoreGoal(id)`
  (`createGoalActions(db)` for tests). Each action is one transaction and returns an undo; a switch, cancel or edit undo does
  nothing once tomorrow has started. Stale state throws `GoalChangedError`, an invalid draft `GoalDraftError`. Which goal applies
  always comes from periods (`periodOn`, also used by `loadGoalTimeline`, `goalPeriodOn` and `listGoalPeriods`' order); every
  action leaves the goal of the latest open-ended period `'active'` and any other `'active'` goal `'saved'`, and screens never read
  "in force" from the status. New optional fields: `Goal.insightsOff` (an older app version rewriting the row drops it: insights
  come back on) and `GoalPeriod.createdAt` (the tie-break between two bookings for the same day). The goal-end notice's "seen" key
  is per device (`kira-makan:goal-end-seen`). No new table, no Dexie or `SYNC_PROTOCOL` bump. `getDaySummary` gives a paused day no
  timing tags and no window close; `getFestiveDaysInRange` centres the band on the version's `dailyKcal`.
- Search (S49, decision §10.16): `src/db/search.ts` (`loadSearchIndexIn`, `useSearchIndex`) builds one in-memory entry per meal from
  `src/domain/search.ts` (pure: the normaliser, the matcher, the index, `matchNote`, `groupByDay`, `oftenLogged`). It only reads
  `meals` and `places`: no write, no capture, no localStorage, no network.
- Top dishes check and Timing detail (S34, S35, decision §10.17): `src/domain/dishCheck.ts` (pure: `dishStats` over the last 56 days,
  `topDishes`, `dishEstimate` with its four sources, `stepVariant`, `planDishAnswer`) and `src/domain/learned.ts` (`learnedItem` and
  the other learned-item helpers, moved out of `src/screens/Log/library.ts`, which re-exports them so `src/db` need not import from
  `src/screens`). `src/db/dishCheck.ts` holds `getDishCheckStatusIn` / `getDishCheckViewIn` / `useDishCheckView` and the actions
  `answerDish(key, answer)`, `finishDishCheck()`, `dismissDishCheck()` (`createDishCheckActions(db)` for tests); each returns an undo,
  and a list that moved under the user throws `DishCheckChangedError`. The state is one existing synced row, `insightFeedback`
  `ruleId: 'topDishes'` (`feedback: 'dishCheck'`, optional `dishCheck: { startedOn, dishes, doneAt? }`), written with the first
  answer; an answer is kept through `rememberCorrection` (a `PersonalItem`, and `Place.defaultVariants` for a Place default). Reading
  never writes. `getInsightsView(…).dishCheck` carries the status for the Insights card and the Unlock-list row. S35 reads through
  `src/domain/timingDetail.ts` (`dayTimingMetrics`) and `src/db/timingDetail.ts` (`getTimingDetailIn` / `useTimingDetail`), and never
  writes. No new table, no Dexie or `SYNC_PROTOCOL` bump: `dishCheck` is optional, so an older app version rewriting the row drops it
  and every reader treats the check as not started.

- Drive photo sync (decision §10.18): `src/drive` (`config.ts` the public `VITE_GOOGLE_CLIENT_ID`; `gis.ts` the only module that
  loads Google Identity Services and holds the token flow; `api.ts` the only one that builds googleapis.com URLs; `engine.ts`;
  `index.ts` the app's engine and wrappers `startDrive`, `stopDrive`, `resumeDrive`, `prepareDrive`, `connectDrive`,
  `continueDrive`, `renewDriveTokenOnTap`, `disconnectDrive`, `retryDrive`, `fetchMealPhoto`, `forgetDriveToken`; `status.ts`
  `drivePhase`/`describeDrive` and the copy; `hooks.ts` `useDriveView`, `useMealPhoto`; `thumb.ts` the canvas thumbnails;
  `testing/fakeDrive.ts`, `testing/fakeGis.ts`). `src/domain/photoSync.ts` is the pure part (`drivePointerOf`,
  `driveFileName`, `retryDelayMs`, `mealPhotoView`, …). The synced field is the new optional `MealLog.photoDrive`
  `{ fileId, thumb? }`, written only by `recordUpload`; every reader goes through `drivePointerOf`. The queue and the
  connection live in `src/db/driveQueue.ts` (`queueUploadIn`, `dropUploadIn`, `queueTrashIn`, `undoTrashIn` inside the
  actions' transactions; `queueExistingPhotos`, `dueJobs`, `recordUpload` and the rest in their own). Lists read
  `useMealThumbUrl` (`src/db/diary.ts`): this device's photo, else the synced thumbnail. No new synced table, no
  `SYNC_PROTOCOL` bump.

- Reminders and push (S38, S40, decision §10.19): the rules are one import-free module, `supabase/functions/_shared/reminders.ts`
  (`decideReminder`, `quietWindowFor`, `slotUsualTimes`, `pausedOn`, `resolveReminderPrefs`, the messages and payload), which the
  app re-exports from `src/domain/reminders.ts` and `src/domain/remindersParity.test.ts` keeps equal to `day.ts`, `timing.ts` and
  `goals.ts`. `src/db/reminders.ts` holds `updateReminderSettings`, `getReminderViewIn` / `useReminderView` and the target push
  mark (`markTargetPending`, `markTargetSeen`; Today goes through `markTargetShowing` in `targetSuggestion.ts`). `src/push`: `config.ts` (the public `VITE_VAPID_PUBLIC_KEY`, the function URL),
  `support.ts`, `local.ts` (the device's record, localStorage `kira-makan:push`: never synced or exported), `remote.ts` (the
  `push_*` RPCs and the test call), `engine.ts`, `index.ts` (the app's engine and wrappers `startPush`, `turnOnPush`,
  `turnOffPush`, `sendTestPush`, `retryPush`, `repairPush`, `refreshPush`, `forgetPush`), `status.ts` (`describePush`), `hooks.ts`
  (`usePushView`), `worker.ts` and `notificationPaths.ts`, `testing/fakePush.ts`. The worker is `src/sw.ts` with the handlers in
  `src/sw/push.ts`; `src/app/notificationOpens.ts` navigates in place on a tap. The synced fields are the optional
  `Profile.reminders`, `InsightFeedback.targetNotice` (row `targetNotice`) and `InsightFeedback.targetNoticeSeen` (row
  `targetNoticeSeen`), both with feedback `'notice'`; `push_context` returns both. Subscriptions and the send log
  live only in Supabase (`push_subscriptions`, `push_log`). No new Dexie table, no `SYNC_PROTOCOL` bump. The server is
  `supabase/functions/send-reminders` (`core.ts`, `handler.ts`, `webpush.ts`, `store.ts`, `config.ts`; tested under `server/`).

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
| `src/sync/engine.ts`, `index.ts` | When to sync and what to do: gate, cycle, triggers, retry, the user's choices. `index.ts` builds the app's engine lazily and exports the wrappers (`startSync`, `stopSync`, `resumeSync`, `syncNow`, `catchUpSync`, `flushSync`, `restoreFromAccount`, …). |
| `src/sync/status.ts`, `hooks.ts` | `describeSync(view, nowMs, tz)`, the card copy for every phase; `useSyncView()` and `usePendingMealIds()` (the "Waiting to sync" badge, shown only while sync is stuck). |
| UI | `components/SyncStatus` (presentational card), `screens/More/SyncGroup.tsx` ("Account and sync", first in Settings when Supabase is configured), `screens/Setup/RestoreSheet.tsx` (Welcome › Restore from your account). |
| `src/sync/testing/fakeServer.ts` | `sync.sql` in memory, with the same rules and JSON, for tests. |
| `supabase/push.sql`, `push-selftest.sql` | Reminders (§10.19), pasted after `sync.sql` (DEPLOY.md steps 57–59): `push_subscriptions` and `push_log` (RLS, own rows, written only through `push_*` functions), the `sync_rows_meal_day` index, `push_context` (compact JSON from `sync_rows` for the job), the `kira-makan-reminders` pg_cron job and `push_configure` for its Vault secrets. They read synced rows and change none. |

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
- **A new synced table means bumping `SYNC_PROTOCOL`** (`db.ts`). Each device then pulls from revision 0 once and picks up the rows it skipped (a pull skips tables this version doesn't know). Photos don't travel through the account: meals carry `photoDrive` (§10.18).
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
- References (`placeId`, `potId`, `goalId`, `photoId`) may point at rows that haven't arrived yet; screens already treat a missing row as none. A meal's `photoDrive` may point at a Drive file this device can't read (not connected, or another Google account); screens show its thumbnail.

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
- **Triggers:** a change (2 s debounce, 10 s at most), `online`, coming back to the app after 30 s, a session change (after a refused token, an auth event for the same session too: a refreshed token, the same user signing in again), Sync now (a sign-in from Settings runs it too), `catchUpSync` (the Drive engine, before it writes a photo pointer: a cycle now on a linked device that isn't waiting for the user, a new sign-in or the SQL; the gate decides the rest as for any automatic cycle, and unlike Sync now it never resets a backoff or a refusal streak), and a 5-minute poll while visible. Going hidden pushes what's queued. Session listeners run inside supabase-js's auth lock, so the engine defers its work with `setTimeout(0)` and never awaits Supabase there.
- **Retry by kind** (`toSyncError` maps HTTP status and Postgres or PostgREST codes): `offline` waits for `online` or visible, plus a 2-minute probe; `unreachable`, `unavailable`, `rejected` and `failed` back off 10 s, 30 s, 2 min, 5 min, then every 15 min (±20 %); `needsSignIn` retries once straight away, then waits for a session change or a new token; `notSetUp` (the SQL isn't there) retries only on start, visible or Sync now; `cloudReset` and `otherAccount` wait for the user; `aborted` is silent.
- **A refused token can't spin.** In a refusal streak (every token refused, say after the project's JWT signing keys changed, while each look refreshes the token and fires an auth event), an auth event for the same session runs a cycle only when `getAuth()` now gives another token than the one refused last (an in-memory short hash, never stored or logged): the first time at once, then at most once a minute, on the backoff (1, 1, 2, 5, then every 15 min). A cycle that goes through, another user, signing out or in, and Sync now end the streak.
- **The card** (`describeSync`): `error` from `unreachable` or `unavailable` says it can't reach the account; from `rejected`, that the account refused the last sync, pointing at Supabase › Logs (DEPLOY.md); from `failed` (a local error, an answer this version can't place, another device linking at the same moment), "Sync stopped on a problem", blaming no one. `needsSignIn` while the session still reads signed in (a refused token) offers Try again and Sign out instead of Sign in. Sync copy says "this device", never "this phone": a laptop syncs too.
- **Sign out** flushes the queue for up to 5 s first. The link, queue and cursor stay; signing in as the same user resumes, and another user gives `otherAccount`.
- **Delete everything** stops the engine, wipes this device (data, queue, link), then resumes. The account copy stays, so signing in again and restoring brings it back. Wiping the account copy is a SQL step (DEPLOY.md); devices then show `cloudReset`.
- **Demo never syncs**, by four guards: `loadDemo` is uncaptured and clears the sync tables, the demo clock skips capture, the gate refuses a demo profile, and `demoMode` is stripped on push, never applied on pull, and refused by the server.

**Import** (Backups › Restore from a backup file, and Welcome › Restore from a backup file; `src/screens/Backups`)

- A restore is `restoreBackup`'s diff-delete plus `bulkPut` in one captured transaction, so it syncs like any edit: the rows the file lacks become tombstones, the file's rows become puts, and the account ends up equal to the file.
- **Reach decides the safeguards** (`restoreReach`): no profile (Welcome) and the sample week restore without a confirm; a real diary that isn't syncing asks for a confirm; a linked, unpaused diary (a restore reaches the account and every other device) asks for a confirm that needs `REPLACE` typed, and offers Export first.
- **A linked device catches up first** (`syncNow()`, and the restore goes on only if the engine ends `idle`), because the restore deletes only the rows this device holds: a row another device added that hasn't arrived here would otherwise come back after the restore. A catch-up that fails stops the restore with nothing written. A linked device whose card says Needs you (or is copying the diary) can't restore until that is fixed in Settings. If the catch-up itself ends in a Needs-you phase (the token was refused, the account changed or was reset, a copy to choose), the sheet says "Sync needs you first" with Open Settings and no Try again (`CatchUpFailed` carries the engine phase); only offline, error or unreachable keep "Couldn't reach your account" and Try again.
- **Demo leaves demo.** The write runs with the demo clock still on, so the sample rows' deletions are not captured as tombstones for rows the account never had; then the clock is unpinned, drafts are cleared, the sample week's last-export record is dropped, and `syncNow()` starts the first-link flow (an empty account takes the upload; an account with a diary shows Choose, never a merge).
- **Device-only fields survive** (`DEVICE_PROFILE_FIELDS`): `theme` and `useLocation` keep this device's values (a device with no profile takes its stored theme and `false`), and `demoMode` is forced off, the same rule a profile that arrives by sync follows. The sample week's profile counts as no profile here: its `useLocation: true` and theme were never chosen, so a restore over the sample week resets `useLocation` to `false` and the location primer still runs.
- After any restore `syncNow()` is called once; it never rejects and the gate decides. The last-backup date (`kira-makan:last-backup`, per device, never synced) becomes the file's export date.
- The monthly nudge (`src/domain/backup.ts`): a full backup (JSON) older than 30 calendar days, or none for a diary older than that, with at least one meal and never in demo mode. It shows in two quiet places only, the Settings › Backups row's sub-line and the backup-file card on Backups.

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
| `/diary/search` (`?q=`, `?slot=`, `?place=`) | S49 Search |
| `/insights` | S31 Insights |
| `/insights/weekly` | S33 Weekly review |
| `/insights/target` | S37 Target suggestion (and the target history) |
| `/insights/dishes` | S34 Top dishes check |
| `/insights/timing` (`?day=`) | S35 Timing detail |
| `/more` | S48 More |
| `/more/weight` | S16 Weight |
| `/more/settings` | S19 Settings |
| `/more/export` | S20 Export |
| `/more/backups` | S39 Backups |
| `/more/reminders` | S38 Reminders |
| `/more/goals` | S41 Goals library |
| `/more/goals/new` (`?template=`) | S43 New goal from template |
| `/more/goals/:id` | S42 Goal detail / edit (S44 Switch is a sheet on it) |
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
- Screen files (default export = the route element): `src/screens/Today/TodayScreen.tsx` (S08), `src/screens/Log/{EstimatingScreen,ReviewScreen,PlateScreen}.tsx` (S10, S11 + S14 edit mode, S24), `src/screens/Diary/{DiaryDayScreen,DiaryWeekScreen,EntryScreen}.tsx` (S12–S14), `src/screens/More/{MoreScreen,WeightScreen,SettingsScreen,ExportScreen,ComingSoonScreen}.tsx` (S48, S16, S19, S20, later-phase placeholder), `src/screens/Insights/{InsightsScreen,WeeklyReviewScreen,TargetScreen,DishCheckScreen,TimingDetailScreen}.tsx` (S31, S33, S37, S34, S35), `src/screens/Ideas/IdeasScreen.tsx` (S36), `src/screens/Setup/SetupFlow.tsx` (S01–S07).
- Sheet content files: `src/screens/sheets/{LogSheet,BudgetSheet,MakanSheet,CheckInSheet,EvidenceSheet}.tsx`. Each default-exports `({ close }) => content`; the shell wraps it in `BottomSheet` (check-in is not dismissible by scrim).
- Screens render inside the shell's scroll column. They start with their TopBar/SubScreenHeader at the design's `padding: 4px 20px 0` (the shell adds the status-bar safe area). Tab screens leave `var(--content-pad-nav)` bottom padding; screens with a floating `RangeTotal` leave `var(--content-pad-footer)`.
- Moving between logging steps uses the Zustand `reviewDraft` (`src/state/ui.ts`): set the draft, then navigate to `PATHS.review`. The draft's `backTo` says where Back goes.
- Phase 2 screens (all `tab: false`, reached from More): `src/screens/Places/{PlacesScreen,PlaceDetailScreen}.tsx` (S21, S22 — `PATHS.places`, `PATHS.place(id)`), `src/screens/Usuals/UsualsScreen.tsx` (S23 — `PATHS.usuals`), `src/screens/Pots/{PotsScreen,NewPotScreen,PotDetailScreen}.tsx` (S26–S28 — `PATHS.pots`, `PATHS.potNew`, `PATHS.pot(id)`), `src/screens/Activity/{ActivityScreen,LogWorkoutScreen}.tsx` (S30, S29 — `PATHS.activity`, `PATHS.workoutNew`).
- Reminders (S38, `tab: false`, `PATHS.reminders`; Settings › Reminders opens it and `/more/soon/reminders` redirects):
  `src/screens/Reminders/{RemindersScreen,NotificationsSheet,remindersModel}` (this device's card from `describePush`, the synced
  preferences, the check-in time and quiet hours sheets, the C58 primer before Chrome's prompt). A tapped notification opens its
  screen through the worker: an open window is told to navigate (`useNotificationOpens` in the shell), else a new one opens.
- Backups (S39, `tab: false`, `PATHS.backups`; Settings › Backups opens it and `/more/soon/backups` redirects to it): `src/screens/Backups/{BackupsScreen,BackupImportSheet,useBackupImport}` with the copy in `backupsModel.ts`. The screen shows the sync card (read-only except Sync now and Try again), the backup-file card (Export now, via `src/screens/More/exportFiles.ts`, shared with S20) and Restore from a backup file. `useBackupImport` is the stage machine behind the one `BackupImportSheet` (reading, preview, confirm, restoring, done, problems); Welcome uses the same hook and sheet with reach `none`.
- Meal photos in Google Drive (§10.18, no new route or `?sheet=`): Settings › Photos (`src/screens/More/PhotosGroup.tsx`, with
  `DriveConnectSheet.tsx`, also opened from Entry), Backups › Meal photos (read-mostly: Continue and Try again in place, else Open
  Settings), Entry's photo block (`useMealPhoto`), and the photo sheet's Estimate tap (`renewDriveTokenOnTap`).
- Search (S49, `tab: false`, `PATHS.search`; the Diary icon on Day and Week opens it and `/more/soon/search` redirects): `src/screens/Search/{SearchScreen,searchModel}.tsx|ts`. The query lives in the URL (replace), the cap and scroll are remembered in memory for Back.
- Phase 5 screens: `src/screens/Goals/{GoalsScreen,GoalDetailScreen,NewGoalScreen}.tsx` (S41, S42, S43 — `PATHS.goals`, `PATHS.goal(id)`, `PATHS.goalNew(template?)`); S44 is the local `GoalSwitchSheet` on S42 (not a `?sheet=`: it needs a goal id). Today's GoalPill and More › Goals open S41; `/more/soon/goals` redirects there.
- Top dishes check and Timing detail (S34, S35, `tab: false`, `PATHS.dishes`, `PATHS.timing`): `src/screens/Insights/{DishCheckScreen,DishCheckCard,TimingDetailScreen}.tsx` with the copy in `dishCheckModel.ts` and `timingDetailModel.ts` and the answer plumbing in `useDishCheckActions.ts`. Entry points are quiet: S34 from the Insights `DishCheckCard` and the "Top dishes check" row of "Unlocks as you log" (the durable way back); S35 from Insights › When you ate (`Details ›`), a `Timing details ›` text link on Today (under the nudge) and on Diary day (in the status card, with `?day=`). Back on both: the previous entry, else Insights.

## 9. Demo mode

`profile.demoMode` pins the clock (`clock.ts`) to Fri 16 Oct 2026 7:10pm MYT and loads `seed/demo.ts`. It exists so the app can be compared screen by screen with the prototype. Real use starts from Setup (S01–S07), or from Welcome › Restore from your account on a device whose account already holds a diary. Settings can switch demo mode off and clear demo data. Demo data never syncs (§6.2), never reaches Google Drive (§10.18) and never pushes (§10.19).

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
    - **Photos go to the user's Google Drive, not Supabase Storage (§10.18).**
    - **The account lives in the owner's Supabase project.** `sync_accounts` references `auth.users` with `on delete restrict`, so deleting the user can't silently erase the synced diary: a lost password is reset in place (DEPLOY.md).
13. **The target only changes when the user approves a change (S37).** The adaptive maintenance is read **weekly**, from the 28 logical days to last Sunday, so it is the same number all week and on every device (there is no server job); only while that read isn't possible yet (fewer than 21 complete days, or fewer than 8 weigh-ins spread over 14 days) is it read from the 28 days to yesterday, so the first suggestion comes as soon as the data allows. It compares with the goal's **newest** version, a pending one included, so an approval doesn't show the card again before the rollover. **Approve** (or "Change pace instead") adds a goal version from the next logical day (`reason 'approvedSuggestion'`, protein kept, fat and carbs from `macrosForTarget`); past days and today keep theirs and the week is prorated by the per-day version lookup. **Paces are versioned** (`GoalVersion.paceKgPerWeek`, read through `paceOf`); the goal row is never edited by a suggestion. **Keep current** is the synced `insightFeedback` row `targetSuggestion` (`'keepCurrent'`, 4 weeks), and the suggestion comes back sooner when the estimate moves by more than 100 kcal again or the target changes. The S40 notice is in-app for now: an accent banner on Today, once per `${versionId}:${weekStart}` per device (localStorage), behind the check-in banner and with no nav badge; the key is ready for a web push on Android later. Demo mode follows the real rules: the demo Friday is day 19 with 17 complete days, so S37 shows "17 of 21"; the designed card states are in the `/dev` gallery. **The trend settles before it counts:** the slope leaves out the first 10 days of each trend run (from the first weigh-in, often the setup weight, or after a 10-day gap), because one reading 0.5 kg off would alone move maintenance past the 100 kcal threshold. While the estimate is a daily read, S37 says "Checked again tomorrow" (it moves at every rollover), not next Monday.
14. **Goals switch from the next logical day and never rewrite the past (S41–S44).** A switch writes only goal periods and goal statuses: every period reaching past today ends at tomorrow, anything booked from tomorrow on is removed (a later booking replaces an earlier one), and the new period starts tomorrow, so today keeps its goal and this week's budget is prorated by the per-day lookup at once. The S44 week line counts Friday as Cut ("5 days at 1,800 + 2 days at 2,100 = 13,200"), not the plan's 4 + 3 example. **Periods decide which goal applies; `Goal.status` is bookkeeping** (the goal of the latest open-ended period is `'active'`, other `'active'` rows become `'saved'`), and two bookings for the same day are settled by the new optional `GoalPeriod.createdAt` (later wins, older rows first, then id), so two offline switches give the same answer on both devices. **Pause takes an end in S44** (the Monday after tomorrow's week, a picked day up to 60 days, or open): a dated pause is a bounded Pause period plus a period that gives today's goal back that day. Switching back to the goal in force while a switch is booked cancels the booking ("Keep Cut instead"); switch, cancel, create, edit, archive and restore all have an Undo, and an undo of a switch, cancel or edit does nothing once tomorrow has started. The Templates section is derived (a built-in template with no goal of its own running, booked or saved), and saving a template's S43 converts its `'template'` row. **Target edits are versions:** a goal never in force keeps one version, replaced; a goal in force or used before gets a version from tomorrow (`'manualEdit'`, with its pace), replacing any other version for tomorrow (a pending approval included); `Goal.paceKgPerWeek` is never edited. Name, timing, insight toggles, end condition, the Festive range and a Custom main number live on the goal row and apply at once. Festive's days in range centre on the version's target. Pause days have timing off. Archive ends a goal that was ever in force (history kept, "Restore" brings it back) and deletes one that never was. An end condition is never automatic: when it's reached (date, or the trend at or past the weight) and nothing is booked, S41/S42 suggest the first saved Festive goal (or setting one up) and Today shows a once-per-device banner after the check-in and the target notice. **Follow-ups from review:** (a) a Pause carries the budget goal's targets through any chain of Pauses (`goalTimelineOf` resolves the previous day through the timeline itself, memoised, so Pause after Pause still has a goal on every day), and a dated pause started while a Pause runs resumes the budget goal it carries, not the Pause; (b) the end condition is validated only when it differs from the stored one (`endChanged`, like `kcalChanged`), so an end that has passed or been reached never blocks a rename or a protein edit, while S43 and a changed end keep the full checks; (c) a Hold pace has no weight end (`withPace` turns it into no end, and a stored weight end on a Hold goal shows as no end); (d) "Keep Pause instead" cancels what is booked from tomorrow whatever day it starts (a running dated pause can go on), and a goal booked for a later day (a pause's resume) offers Switch to this goal to start from tomorrow; (e) when Save finds errors, `GoalEditorFields` takes a `focusSeq` that the screen bumps, scrolls the first invalid field into view and focuses it, and the messages are `role="alert"` with `aria-describedby` on the field; (f) a long goal name shortens the Today GoalPill with an ellipsis (the TopBar right slot shrinks, the title never does) and the aria-label keeps the whole name.
15. **Backups are the synced account copy plus a restorable file; Google Drive is for photos, later (S39).** Settings › Backups no longer means a weekly Drive copy: it opens a Backups screen built on what exists, the two-way sync (§6.2) and the JSON export. (a) **The sync card is read-only here:** Sync now and Try again run in place; Sign in, Choose, Switch, Turn on sync and Sign out stay in Settings behind one Open Settings, so their confirms exist once. (b) **Only a full backup (JSON) counts:** a spreadsheet export restores nothing, so the nudge reads its own `kira-makan:last-backup` date (written by a JSON export and by a restore, which sets it to the file's export date) and falls back to a JSON `last-export`; `last-export` itself still means the newest export of any kind. (c) **Export now is exactly S20's full backup** (no photos, `backupFilename(today)`, the same toast), through the shared `exportFiles.ts`. (d) **The nudge is one rule:** more than 30 calendar days in the profile zone since the last backup or, with none, since `startedOn`; never in demo mode, never with no meals; Settings' row sub-line and the file card are its only places, with no banner, dot or toast, and copy that never says overdue or forgot. (e) **A restore is a full replace** (§6.2 Import): safeguards by reach, a typed `REPLACE` and a catch-up sync on a linked device, device-only profile fields kept, demo left cleanly, a sample-week or diary-less file refused, and nothing written unless the whole file passes (one transaction). (f) **No new table, no `SYNC_PROTOCOL` bump, no new synced field:** the work is code, one localStorage key and optional parameters. Meal photos are §10.18's Google Drive sync (C55 BackupStatus stays a gallery-only component). (g) **Back steps back one level:** over the destructive confirm, the phone's Back (and Escape or the scrim) only dismisses the confirm, as its Cancel does, so the loaded file isn't dropped; the next Back closes the sheet. The Backups screen also says meal photos stay on the device and aren't in the file.
16. **Search is a read-only, in-memory text match (S49).** `/diary/search` reads every meal and Place once and matches in memory, because Dexie has no substring or accent-insensitive index. (a) **What it matches:** the meal name, every item name, the selected portion label, the typed text (a photo's caption too), the Place name and, for catalogue items, the catalogue name and aliases; slot words and prices are not matched. (b) **How:** token-AND and order-free, ignoring case and accents; a word of 3+ characters (or any non-Latin word) is found anywhere, a 1–2 letter word must start a word, and when the words fail the query run together (4+ characters) is tried against the meal run together, so "tehtarik" finds "Teh tarik"; a run-together hit must begin at the start of a word, so "ikan" does not find "Nasi kandar" (`nasikandar`), and the "Includes ..." note uses the same rule. No typo matching and no relevance ranking. (c) **Order and size:** newest first by the stored `logicalDay` (never re-derived from the rollover), then `eatenAt`, grouped by day, 30 drawn at a time with the total always shown. (d) **Speed:** a 200 ms debounce between typing and the results; the index is built in 400-meal slices that yield to the browser, so a long history never freezes the screen. (e) **The query lives in the address**, written with `replace`, so Back from Search is one step and Back from an entry returns to the same results (each replace gives the location a new key, so whether Search has an earlier entry, "Back" or "Back to Diary", is decided once at mount); the cap and scroll are remembered in a module variable for that Back, never stored. (f) **Filters:** a meal slot and an exact Place id, so Home does not also return "Nasi kandar near home". (g) **No stored search history:** "Often logged" and "Places" are computed from the meals themselves, so there is nothing to clear on Delete everything and no demo case. (h) **No new table, no new field, no `SYNC_PROTOCOL` bump:** Search never writes.
17. **Top dishes check and Timing detail are read-mostly Insights sub-screens (S34, S35).** (a) **S34** lists the 30 dishes logged most (2+ logs, over the last 56 days, once per meal), offered from day 14 of real logging (14 days with a real meal) by an Insights card and an Unlock-list row; the list is frozen at the first answer and stored with the answers in the `insightFeedback` row `topDishes` (`feedback: 'dishCheck'`, optional `dishCheck`), so it syncs, resumes on any device, and needs no table or protocol bump. (b) **An answer feeds the existing learning**: Looks right changes nothing except that an AI guess becomes your own value; Usually more/less picks the next/previous portion chip by kcal, except a step that doubles or halves a count ("1 piece" → "2 pieces"): those resize every count chip ×1.25 / ×0.8, because how many you had is picked when you log; otherwise it scales the item ×1.25 / ×0.8; a value that came from a Place (Place default) is updated at that Place (place-scoped `PersonalItem` + `Place.defaultVariants`), anything else for the dish everywhere. Past meals, Usuals and pots are never rewritten. (c) **Skip and Done**: unanswered dishes are never asked again after Done; Undo is per row while the screen is open; Not now hides the card for 28 days. (d) **S35** shows one day (expanded `DayTimeline` with a sleep marker; no wake marker because waking is not recorded), the day's numbers from the goal's own rules, the week's `TimingGrid` and an explanation of Going to sleep; it never writes. Entry points: Insights › When you ate, Today (text link), Diary day (text link). Pause days show no timing. (e) **A started check is judged against the meals it was built from, not the rolling 56 days:** the offer (`candidates`, `loggedDays`) comes from the rolling window, but whether a frozen dish is still in the diary, and the estimate behind its row, are read from `startedOn − 55 days` through today (`readState`). So an in-progress or done check keeps its dishes, answers and summary as the weeks pass, and only a dish whose meals were all deleted drops out. (f) **S35's expanded strip** places its 4-hour captions at the same percentage as the hour lines (the first and last stay inside the strip edges); the compact strip's three captions still spread in a row.

18. **Meal photos sync through the user's Google Drive (stage 4).** (D1) **The pointer syncs, not the bytes:** a meal gets the optional `photoDrive: { fileId, thumb? }` (a ~128 px square JPEG data URL of at most 16,000 characters) once its photo is in Drive; it reaches other devices with the meal through the existing sync. No new synced table and no `SYNC_PROTOCOL` bump; meal rows with a photo grow by about 10 KB. An older app version that rewrites a meal drops the field, and the device holding the photo heals it at its next start (the backfill finds the Drive file by `kmPhoto`, no second upload). (D2) **The queue is local:** Dexie version 3 adds `driveJobs` and `driveMeta` (string keys, never exported, never captured, cleared by every wipe), so a trash job commits and rolls back with the meal delete (Undo) and the queue survives restarts. (D3) **Pointer and thumbnail are written together, only after a successful upload**, from the local 240 px thumb. (D4) **No silent token refresh exists in Google's token model:** every token request opens a window and needs a tap, so a token is asked for only inside taps the user already makes for a photo (Settings/Backups **Continue**, Entry **Show full photo**, the photo sheet's **Estimate** when a token would be used), with `prompt: ''` and the stored email as `login_hint`, so a returning user sees a window that opens and closes by itself. The engine never opens a window on its own; the card says **Needs you** with **Continue** when photos wait. Entry offers Continue only for a photo whose upload waits for a token, never for one set aside until the next start (Continue doesn't release those). Tokens live in memory only (about an hour). (D5) **Disconnect is device-only and revokes nothing** (revoking would break the other device); removing access entirely is Google Account › Connections (DEPLOY.md). Queued jobs stay. (D6) **Delete everything** stops the Drive engine, wipes this device (the Drive stores with it), forgets the token and resumes; Drive files stay, and the confirm says so when Drive is connected, and how many photos that haven't uploaded (set-aside ones included) will be lost with this device. (D7) **The device where a meal was deleted trashes its file**, from its durable queue, whenever it is connected and online; a tombstone pulled from another device queues nothing. (D8) **Trash runs 60 s after the delete:** Undo deletes a pending trash job, or queues a restore (`trashed: false`) if it already ran; a trash job never runs while any meal here still points at the file. The Undo of a new photo meal whose upload already finished (the toast outlives a quick upload) reads the stored meal and trashes its file the same way. (D9) **Keep photos off pauses uploads** (trash and restore still run); turning it back on uploads the photos this device still holds. (D10) **Full photo on a tap, not on open**, cached in `photos` (removed with the meal, or by Delete everything). (D11) **Order:** trash and restore first, then uploads newest first, one job at a time per device (Web Lock `kira-makan-drive`). (D12) **One `Kira Makan photos` folder** in My Drive, marked `appProperties { kiraMakan: 'photos' }`; when two exist the oldest wins on every device; its id is cached, and a 404 on upload makes it again and retries once. (D13) **A file is found by `appProperties { kmPhoto, kmMeal }`** before every upload, so a crash between upload and pointer never duplicates it; the file name (`2026-10-16 Dinner - Nasi kandar ayam goreng.jpg`) is cosmetic. (D14) **Files over 5 MB are set aside** (multipart limit) until the next start. (D15) **Settings gets a Photos group** (Keep photos moves there from Privacy) with the Drive card (`SyncStatus`, copy from `describeDrive`) and the C58 primer in a sheet before Google's window. (D16) **Backups gets a read-mostly Meal photos card**; the backup-file caption says the photos are in Google Drive once connected. (D17) **CSP** adds only `script-src https://accounts.google.com/gsi/client`, `frame-src` and `connect-src https://accounts.google.com/gsi/`, and `connect-src https://www.googleapis.com`; `style-src` stays `'self'`, and there is never a `Cross-Origin-Opener-Policy: same-origin` (it would cut the popup off from the app). (D18) **The Google email stays on the device** (`driveMeta.email`, from Drive `about.get`), as the login hint and on the card; a token for another account is dropped. (D19) **The pointer write is an ordinary captured meal write** (whole row, later edit wins) that re-reads the meal in its transaction, **after this device has pulled**: an upload can land minutes after the meal synced (backoff, Continue, coming back to the app), and a write on a copy that hasn't pulled the other device's newer edit or delete would win by device time (§6.2 rule 4) and undo it. So after each upload the engine awaits a sync cycle (`catchUpSync`, a linked device only, never rejects) before `recordUpload`: a pulled edit gets the pointer on top, a pulled delete makes the upload an orphan whose file goes to the trash. What is left is the few seconds between that pull and the pointer's push, or, while sync can't reach the account (signed out, a refused token, an outage), until it can; then later edit wins, as for any edit. (D20) **Google's script loads only** when the device is connected (engine start, after 2 s), a Drive card or the connect sheet is on screen, or an Entry shows a Drive photo; never for a device that isn't configured or never looks at Drive. A load that fails (offline, blocked, the 15 s timeout, while the browser still says online) is tried again by the next tap that needs it (Connect, Continue, Show full photo, Estimate), by coming online and by coming back to the app; the tap itself answers `unavailable` ("Couldn't reach Google. Check your connection and try again."), and the connect sheet shows that line with its button on instead of waiting as "Getting ready…" (`DriveEngineState.gisFailed`). Backoff for an unreachable Drive is 30 s, 2 min, 10 min, 30 min, then hourly (±20 %), and grows with the streak of failures so a long outage stays quiet; Try again and Continue release backoffs but never a deleted meal's trash delay.
19. **Reminders are Web Push from one Edge Function; the rules are shared code (S38, S40, stage 5).** (D1) **Preferences are synced profile data:** the optional `Profile.reminders` (check-in on at 10am, gap nudges, weekly review, target suggestions, quiet hours from sleep taps or your own); a missing field is its default, and defaults can be "on" because nothing is sent until a device turns notifications on. No new table, no `SYNC_PROTOCOL` bump; an older version rewriting the profile drops the field (back to defaults). (D2) **A subscription belongs to one browser:** it lives only in Supabase (`push_subscriptions`, keyed by endpoint, written through RPCs), and the device remembers its own endpoint in localStorage (`kira-makan:push`, never synced or exported). (D3) **The service worker is ours** (`injectManifest`, `src/sw.ts`): the same precache, navigation fallback (`/api/` excluded) and auto-update as the generated worker, built as one classic script at `/sw.js`, plus the push handlers in `src/sw/push.ts`; `vercel.json` and the CSP are unchanged. (D4) **One rules module** (`supabase/functions/_shared/reminders.ts`, no imports, Deno- and browser-safe) with its own zone and day helpers, kept equal to `src/domain` by a parity test. (D5) **pg_cron every 5 minutes; the function decides.** `push_tick` calls it with pg_net and an `X-Cron-Secret` only while a subscription exists and `push_configure` has stored the address and secret in Vault; the function never verifies a JWT itself for the job and compares the secret in constant time. (D6) **Check-in** at the chosen time (7am–12pm), or as soon as quiet hours end, within 8 hours; only for a day in use, not paused, unconfirmed or with no record, and only if something was logged in the last 3 days. (D7) **Gap nudges** from 14 complete days, main meals only (never a snack or supper): a usual slot (5+ samples on half the days, complete days only) with no meal today, past its usual time by max(45 min, its spread) but by no more than 3 hours, after the last meal, and 6 hours since the last meal (or 60 minutes past the usual time with nothing logged today). (D8) **Weekly review** on logical Sunday from 8pm (after midnight before the rollover still counts), from day 7, with a meal this week; generic copy, since the budget engine isn't on the server. (D9) **Target suggestion push:** Today marks a showing suggestion in the synced `insightFeedback` row `targetNotice`; the server sends it once a week, 2 hours after the mark, 10am–9pm, and never once any device has seen it; the banner's own "seen" stays per device. **As built:** "seen" is kept twice, as the mark's `seenAt` and in a row of its own, `targetNoticeSeen` (its key), which only seeing writes: a device that opens Today before its first pull marks the suggestion on its stale copy, and that later edit wins the mark row (§6.2 rule 4), but it never touches the seen row, so `decideReminder` still skips the key. Seeing writes the seen row even before any mark (a mark for a seen key is then never written), `markTargetNoticeSeen` records it every time (it writes once), and Today records a suggestion this device saw already (the localStorage key, from before this version too) as seen instead of marking it. (D10) **Quiet hours** from the median sleep tap minus 30 min (3 taps), else the last meal plus an hour (5 days), until the first meal minus an hour, else 11pm–8am, rounded to 15 min and kept 6–14 hours; or your own (9pm–2am to 6am–11am). A "Going to sleep" tap makes it quiet until a meal is logged after it. (D11) **Calm:** one reminder per user per run, 60 minutes apart, check-in > gap > weekly review > target; urgency high (Doze), a TTL and a `Topic` per kind. **As built:** one notification tag per kind (`km-checkIn`, …) with `renotify: true`, so today's check-in replaces yesterday's left in the shade and still sounds and pops up; without it Chrome on Android swaps a same-tag notification in silently. (D12) **Never twice:** `push_log` is claimed before sending and released only when no device took it and a failure was transient. (D13) **The test notification** goes through the function with the user's token to this device only (`push_test_target`, 6 per 10 minutes per endpoint), unlogged. (D14) **Taps open the right screen** (`/?sheet=checkin`, `/`, `/insights/weekly`, `/insights/target`, `/more/reminders`, and nothing else); an open window navigates in place, and already on that path and query it stays put (no second history entry, so one Back still leaves). (D15) **Sign out and Delete everything remove this device's subscription** (the server row first, within 3 s, then the browser's); losing the session by itself removes nothing. (D16) **Rotation:** the worker resubscribes and saves through `push_resubscribe` as anon, proving ownership with the old auth secret; the app also reconciles at start, on sign-in, after 6 hours away, on the worker's message and when S38 opens. **As built:** a save the account hasn't confirmed, or a problem on the card, is looked at again on `online` and on every return to the app; while it waits on the connection or the account (offline, unreachable, unavailable), also by itself after 30 s, 2 min, 5 min, then every 15 min, so "Waiting for a connection" finishes on its own. (D17) **Unconfigured builds** (no Supabase or no `VITE_VAPID_PUBLIC_KEY`) show only "Reminders aren't set up in this version"; the dev server, having no worker, says so. (D18) **No proactive prompt this stage:** notifications are asked for only from S38's Turn on, through the C58 primer. (D19) The notification icon is `/icons/icon-192.png`; Android adds Chrome's small icon. (D20) `VAPID_SUBJECT` is the production address; `npm run push:keys` only prints, and new keys make each device re-subscribe at its next start. (D21) **The function reads compact JSON built in SQL** (`push_context`), never whole meal rows, with the project's secret key; a partial index keeps the 36-day meal read cheap. (D22) **Demo never pushes:** no subscription, no target mark, and the server skips a demo profile. **Follow-up:** a Today prompt around day 14 (plan §16.1) is not built. **As built:** Postgres caps a regex repeat count at 255, so the endpoint check is `^https://\S+$` plus a length test (18–1000 characters) rather than one `\S{10,990}` pattern.
