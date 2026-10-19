# Design Handoff: Personal Food Tracker
### A brief for Claude Design

**Version:** 1.0 · 19 October 2026
**Behaviour source of truth:** `personal_food_tracker_product_plan.md` (v2). Upload both files. This document says **what to design**; the plan explains **why and how it works**.
**After design:** the designs go back to Claude Code to build. Keep every component and screen name matching the IDs here (e.g. `C22 PortionChips`, `S11 Review`), so design and code use the same vocabulary.

---

## 0. How to Use This Document

1. Read sections 1–4 for context, principles and platform rules.
2. Build the **design system** first (section 5), then the **components** (section 6), then the **screens** (section 7), in **phase order** (section 11).
3. Use the **sample data** in section 9 on every screen, so all screens tell the same story.
4. Design **every state** listed for each screen and component. Empty, loading, offline and early-data states matter as much as the main view.
5. Anything marked **Designer's call** is open for you to decide (section 13).
6. Return the deliverables listed in section 12.

---

## 1. The Product in One Paragraph

A personal food tracker that works like an **expense tracker for calories**. There's a weekly calorie budget instead of a money budget, meals are logged like transactions, and **Places** (stalls, mamak, home) work like merchants that remember your usual orders. You type *"nasi kandar ayam goreng, kuah campur, teh o ais"* or snap a photo, and the app estimates calories as a **range** that's easy to correct with local portion words (sikit / normal / banjir). You pick a **goal** (Cut, Festive maintain, Lean bulk, Pause), and the goal decides the main number on the home screen, the timing rules, the insights and the meal suggestions. The app learns your real maintenance calories from daily weigh-ins, judges meal timing against **your own day** rather than the clock, suggests what to eat when you can't decide, and explains every number with the entries behind it.

---

## 2. The User

There's **one user**, and the app is personal, not a commercial product.

| Fact | Design implication |
|---|---|
| Lives in Malaysia; eats at mamak, hawker stalls, kopitiam, economy-rice stalls and at home | Malaysian food words appear as-is; the economy-rice plate builder and Places are core screens |
| Doesn't know food calories | Estimates must look like estimates (ranges, "~", source tags) and be very easy to fix |
| First goal is fat loss | The **Cut** goal is the default design; other goals are variants |
| Works from home; wake and sleep times vary a lot | No fixed clock assumptions; the timeline is based on their own day |
| Weighs themselves most days | Weight entry must take seconds; the trend matters more than daily readings |
| Wants a weekly budget with room for weekend makan | "Left today" and "Saved this week" are both always visible |
| Finds it hard to decide what to eat | "Meal ideas" is one tap from Today |
| Sometimes forgets to log | A friendly morning check-in, never a guilt trip |

### Usage contexts to design for

| Context | Conditions | What matters |
|---|---|---|
| **At a stall** | One hand, food arriving, bright sunlight, patchy signal | Huge tap targets, Log reachable by thumb, works offline, done in under 30 s |
| **At the desk (WFH)** | Two hands, unhurried | Editing, plate building, pots, Places |
| **Late at night** | Dark room, tired | Dark mode, low-glare, minimal decisions |
| **Sunday night** | Relaxed, reflective | Weekly review: calm, a few clear charts, one decision |

---

## 3. Design Principles

1. **Logging in seconds.** The main actions sit in the bottom third of the screen. A repeat meal takes under 15 s; a new meal or economy-rice plate under 30 s.
2. **Feels like an expense tracker.** A ledger of entries, "left today", "saved this week", a weekly statement and recurring items. Make these patterns feel familiar.
3. **Estimates look like estimates.** Use "~" and ranges ("750–1,010 kcal"), with a source tag on every value. Never show false precision.
4. **Calm, never judgmental.** Going over budget is **amber information, not a red alarm**. Red is only for errors. No food is ever labelled bad.
5. **Explain everything.** Every number can be tapped to show how it was worked out or the entries behind it.
6. **The goal sets the main number.** Today's main number changes with the active goal (kcal left, protein left, days in range, or none).
7. **Local first.** Malaysian food and portion words (kuah banjir, kurang manis, senduk, bungkus) appear as normal text, not italicised or translated.
8. **Quiet until useful.** Show "unlocks in 5 days" or "Early read" instead of empty charts or guesses.

---

## 4. Platform and Layout Rules

- **Installable web app (PWA), phone portrait first.** Design at **390 × 844** and check at **360 × 800** (a common Android size). On tablet or desktop the app is a centred column (max ~480 px wide); no separate layout.
- **Safe areas:** respect the notch and home indicator; the bottom nav sits above the home indicator.
- **Touch targets:** at least **44 × 44 pt**. Chips can look smaller but need a 44 pt hit area. Keep at least 8 pt between tappable items.
- **Thumb zone:** the primary action of each screen sits in the bottom third. The Log button is the centre of the bottom nav.
- **Light and dark mode are both required** (late-night use).
- **Text scaling:** layouts must survive system text at 130%. All numbers use **tabular (fixed-width) figures**.
- **Accessibility:** WCAG AA contrast. **Never use colour alone** to carry meaning; always pair it with an icon or label (timing tags, budget states, macro bars).
- **Offline:** every logging screen works offline. Design a "waiting to sync" state for entries and an "estimate pending" state for items that need AI.
- **AI waiting time:** estimates take about 2–6 s. The loading state should feel useful (show the parsed text and placeholder rows), not like a spinner.
- **No app-store chrome.** Design the app icon, splash screen and "Add to Home Screen" prompt (iOS Safari and Android Chrome).
- **Motion:** subtle and quick; respect the reduced-motion setting.

---

## 5. Design System

Values are the **Designer's call**. These are the **roles** the system must provide, in light and dark.

### 5.1 Colour roles

| Token (suggested name) | Used for |
|---|---|
| `surface-0/1/2/3` | Page background, cards, sheets, popovers |
| `text-primary/secondary/muted` | Main text, supporting text, captions |
| `accent` | Primary action, selected chips, links |
| `budget-ok` | On track (ring, bars, "fits" badges) |
| `budget-near` | 10% or less of today's allowance left |
| `budget-over` | Over budget. **Amber, not red** |
| `danger` | Errors and destructive actions only, never food |
| `macro-protein / macro-carbs / macro-fat` | A colour-blind-safe set of three |
| `timing-on-time / timing-late / timing-outside` | Timing tags and timeline dots |
| `window-band` | Eating-window fill on timelines |
| `weight-trend / weight-dot` | Trend line and faint daily dots |
| `status-complete / guess / not-counted / paused / unconfirmed` | Day status badges |
| `source-tag` | Neutral tag background for data sources |
| `chart-grid / chart-axis` | Quiet chart structure |

### 5.2 Typography

| Style | Used for |
|---|---|
| **Hero number** | The main number inside the budget ring (e.g. "570") |
| **Metric number** | Metric tiles, totals ("1,230 kcal") |
| **Title** | Screen titles |
| **Section heading** | Section labels within screens |
| **Body** | Item names, descriptions |
| **Label** | Chips, tags, buttons |
| **Caption** | Hints, ranges, source lines |

All numbers use tabular figures. The typeface is the Designer's call; it needs strong numerals and must read well at small sizes in bright sunlight.

### 5.3 Other foundations

- **Spacing:** a 4 pt grid.
- **Radius scale:** chips, cards, sheets and the phone-frame feel.
- **Elevation:** flat cards, bottom sheets and dialogs.
- **Icons:** one outline family covering: food categories (rice, noodles, drinks, kuih, bread, home pot), Places (pin, home, stall), camera, plate, timing (clock, moon, sun), weight, workout, goals, insights, backup, offline.
- **Motion:** durations for tap, sheet open and number changes. The ring should animate smoothly when an entry is saved.

### 5.4 Chart style

One consistent style across the budget ring, macro bars, week bars, weight trend, day timeline and timing grid: minimal axes, direct labels instead of legends where possible, and tabular numbers.

---

## 6. Component Inventory

Each component lists its **variants and states**. Design all of them.

### 6.1 Navigation and structure

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C01 | **BottomNav** | 5 items: Today, Diary, **Log** (centre, visually prominent), Insights, More. States: active, badge (e.g. check-in waiting) | All main screens |
| C02 | **TopBar** | Large title and compact versions; optional back, search, overflow; date switcher (‹ Fri ›) variant | All screens |
| C03 | **GoalPill** | Shows the active goal and its key target ("Cut · 1,800"). Variants per goal; "Paused" state. Tap opens Goals | Today, Insights |
| C04 | **BottomSheet** | Half and full height, grab handle, title, close | Log, Evidence, Switch goal, pickers |
| C05 | **Toast** | "Saved · Undo"; "Saved offline, will sync"; error version | After saves and deletes |
| C06 | **Banner** | Offline, sync waiting, AI unavailable, early-read info, check-in waiting | Top of screens |

### 6.2 Numbers and charts

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C07 | **BudgetRing** | Main number in the centre plus a label. Variants: **kcal left** (Cut), **protein left** (Lean bulk), **days in range** (Festive maintain), **no ring** (Pause). States: under, near, **over** (shows "+120 over" in amber and "covered by savings" when applicable), makan-day room. Tap opens the budget breakdown | S08 Today |
| C08 | **MacroBar** | Label, bar, "42 / 110g". States: behind, on track, reached. Usually shown 3 across | Today, Review |
| C09 | **MetricTile** | Label, number, optional change in colour (+650 saved, −0.4 kg) | Today, Insights, Budget, Weight |
| C10 | **WeekBars** | Mon–Sun bars against a daily target line. Bar states: logged, **today** (partly filled within a target outline), **planned** (dashed), **makan day** (marker), **not counted** (hatched), **paused** | Budget breakdown, Diary week, Weekly review |
| C11 | **WeightTrendChart** | Faint daily dots plus a strong trend line; 14 / 30 / 90-day ranges; tooltip; annotation ("Monday jump: salt and water") | Weight, Weekly review |
| C12 | **DayTimeline** | A strip covering the logical day: eating-window band, meal dots (size = kcal, colour/shape = timing tag), "now" marker, wake and sleep markers. Compact and expanded versions | Today, Diary day, Check-in, Timing detail |
| C13 | **TimingGrid** | 7 rows (days) × hours; dots sized by kcal; late dots highlighted; a line for each day's eating window; average window label | Insights, Timing detail |
| C14 | **CategoryBar** | Label, %, bar; highlighted version for the category an insight is about | Insights |
| C15 | **UnlockProgress** | Label, "9 of 14 days", progress bar; locked and unlocked states | Insights, Today (early days) |

### 6.3 Logging and food

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C16 | **LogInput** | Multi-line text box with an example placeholder, camera button and send button. States: empty, typing (with matches below), sending, offline | S09 Log |
| C17 | **QuickActionRow** | Photo · Plate · Usuals · Pot | S09 Log |
| C18 | **PlaceChip / PlacePicker** | Chip with a pin icon and name. States: **auto-selected by location ("Nearby")**, chosen, none, new ("Create 'Medan selera nearby'"). Picker: search, recent, nearby | Log, Review, Plate |
| C19 | **TimeChip** | "Now", "30 min ago", "1 h ago", custom time picker. After-midnight hint: "Counts toward Thu" | Log, Review |
| C20 | **MealSlotChip** | Breakfast · Lunch · Dinner · Snack · Supper (suggested, can be changed) | Log, Review |
| C21 | **ReviewItemRow** | Item name (with local alternative name), kcal, source tag, portion chips, add-on chips, swap and remove actions. States: **confident**, **uncertain** (wider range, softer style), **AI guess**, **edited**, **waiting for AI** (offline) | S11 Review |
| C22 | **PortionChips** | Single-select chip groups: Small / Normal / Mamak big · Sikit / Normal / Banjir · Kosong / Kurang / Normal · 1 piece / 2 pieces · Half / 1 / 1.5 scoops · 1 / 2 senduk (home dishes). Long-press reveals grams (advanced) | Review, Plate, Pot |
| C23 | **RangeTotal** | "Best guess 880 kcal" with "Likely 750–1,010", a small range bar and mini macros. Sticky above the save button | Review, Plate, Pot |
| C24 | **SourceTag** | Your correction · Catalogue · MyFCD · SG FoodID · USDA · AI guess (icon + label) | Review rows, Evidence |
| C25 | **FollowUpQuestion** | Question, 2–4 answer chips, Skip. At most 2 per meal | Review (photo/text) |
| C26 | **FinishedPicker** | All · Most · Half · Other | Review (mainly photo flows) |
| C27 | **DishTile** | Plate-builder tile: dish name, kcal per scoop/piece, count badge (×2). States: off, 1, 2; "picked often" marker | S24 Plate builder |
| C28 | **CorrectionScopePrompt** | "You've corrected the rice portion here twice. Make big rice the default?" Yes · Just this time. Scope picker: This time · Always at this Place · Always for this dish | After a save; Entry edit |
| C29 | **MealRow** (ledger entry) | Photo thumbnail or category icon, name, time, Place, "~kcal", timing tag, optional RM, waiting-to-sync icon. Swipe: duplicate, delete (with undo) | Today, Diary, Evidence |
| C30 | **MealSectionHeader** | Slot name and subtotal; empty-slot version ("Dinner · not logged" with a Meal ideas button) | Today, Diary |
| C31 | **TimingTag** | On time · Late for you · Early for you · Outside window · After midnight (counts toward the previous day) | MealRow, Timeline |
| C32 | **DayStatusBadge** | Complete · Guess added · Not counted · Paused · Unconfirmed | Diary, Week views |
| C33 | **PhotoThumb** | Thumbnail with an optional "Half finished" label; tap to view full size | MealRow, Entry detail |

### 6.4 Places, Usuals and Pots

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C34 | **PlaceCard** | Name, type pill (Mamak / Economy rice / Kopitiam / Hawker / Home), visits, average kcal vs elsewhere, spend | Places list, Place detail |
| C35 | **UsualOrderRow** | Name, detail ("Kuah campur · 9 times · ~950 kcal"), Log button (and "Logged" state) | Place detail, Log |
| C36 | **LearnedDefaultRow** | "Rice portion · Big, +30%", editable and removable | Place detail |
| C37 | **UsualCard** | Name, items, ~kcal, Log in one tap, edit | Usuals list, Log |
| C38 | **PotCard** | Name, "3 of 8 servings left", ~kcal per serving, "Clears Sunday", Log 1 serving | Pots list, Log |
| C39 | **IngredientRow** | Name, amount, kcal, source tag; oil version with spoon chips (2 / 4 / 6 tbsp) | New pot, Pot detail |

### 6.5 Suggestions and insights

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C40 | **SuggestionCard** | Role label (**Your usual / Lighter swap / Something different**), "Fits" badge, dish name, reason line, ~kcal and protein, Place, Log this. States: fits, tight fit, logged | S36 Meal ideas |
| C41 | **InsightCard** | Headline fact, evidence line with a "See 11 drinks" link, "Try:" line, optional "Early read" label, Useful / Not for me. States: new, marked useful, dismissed (collapsed with undo) | Insights, Weekly review |
| C42 | **EvidenceSheet** | A summary line plus the MealRows behind an insight, with an optional mini chart | From InsightCard |
| C43 | **RecurringRow** | Item, how often ("~8 a week"), kcal a week | Insights |
| C44 | **WeeklyFocusCard** | "This week's focus: kurang manis for drinks · 3 of 5 so far" | Today |
| C45 | **TargetSuggestionCard** | Current vs suggested target, the working in plain words, Approve / Keep current; secondary "Change pace instead" | S37, Insights |

### 6.6 Goals

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C46 | **GoalCard** | Name, template, key targets, status (**Active / Saved / Draft / Template / Ended**); the active card is emphasised | Goals library |
| C47 | **GoalSwitchSheet** | "Switch to Festive maintain?", "Starts tomorrow (Sat)", the prorated week maths, what changes (main number, rules), Confirm | S44 |
| C48 | **GoalEditorFields** | Number steppers (kcal, protein), pace segmented control, timing-rule toggles with values, insight toggles, end condition | S42, S43 |

### 6.7 Check-in, weight and workouts

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C49 | **CheckInCard** | Yesterday's timeline and total, a gap note, 4 answer rows (radio style), a line explaining what the choice means for the budget and trends | S15 Check-in |
| C50 | **WeightEntry** | Large number pad, kg to one decimal, pre-filled with the last value | S16 Weight |
| C51 | **WorkoutForm** | Type picker (walking, futsal, badminton, gym, running, cycling, swimming, other), duration stepper, intensity (easy / moderate / hard), live estimate ("~470 kcal added to this week") | S29 |
| C52 | **OneOffBonus** | "+ kcal today" with a reason field | S29, Budget breakdown |

### 6.8 Setup, settings and system

| ID | Component | Variants and states | Used in |
|---|---|---|---|
| C53 | **SetupStep** | Progress indicator, question, input, Next, optional Skip | S02–S07 |
| C54 | **SettingsRow** | Label, value, chevron or toggle; destructive version | Settings |
| C55 | **BackupStatus** | Connected / not connected / failed, last backup, Back up now | S39 |
| C56 | **EmptyState** | Illustration slot, headline, one line, action button | Many |
| C57 | **SkeletonLoader** | Placeholder item rows for AI estimating and lists | S10, lists |
| C58 | **PermissionPrimer** | A short explanation shown before the system prompt, for location, notifications and Google Drive | When first needed |
| C59 | **InstallPrompt** | iOS (Share → Add to Home Screen) and Android (Install app) versions | S01 |
| C60 | **ConfirmDialog** | Delete entry; delete everything (type "DELETE" to confirm) | Edit, Settings |
| C61 | **SleepTap** | "Going to sleep" button with a moon icon; appears on Today in the evening, near your usual sleep time. States: hidden, shown, tapped ("Good night · 1:30am", with undo). Optional; the app works without it | S08 Today |

---

## 7. Screens

### 7.1 Navigation map

```
Bottom nav
├── Today (S08)
│   ├── Budget breakdown (S17) ── Plan a makan day (S18)
│   ├── Meal ideas (S36)
│   ├── Timing detail (S35)
│   └── Morning check-in (S15, shown on first open after the day rollover)
├── Diary
│   ├── Day view (S12) ── Entry detail (S14)
│   └── Week view (S13)
├── + Log (S09 sheet)
│   ├── Text → Estimating (S10) → Review (S11)
│   ├── Photo (S25) → Estimating (S10) → Review (S11)
│   ├── Plate builder (S24) → Review (S11)
│   ├── Usuals (S23) → Review (S11)
│   └── Pots (S26) → Pot detail (S28) / New pot (S27)
├── Insights (S31)
│   ├── Evidence (S32)
│   ├── Weekly review (S33)
│   ├── Top dishes check (S34)
│   └── Target suggestion (S37)
└── More (S48)
    ├── Goals (S41) ── Goal detail (S42) ── New goal (S43) ── Switch (S44)
    ├── Places (S21) ── Place detail (S22)
    ├── Usuals (S23)
    ├── Pots (S26)
    ├── Weight (S16)
    ├── Activity (S30) ── Log workout (S29)
    └── Settings (S19) ── Reminders (S38) · Backups (S39) · Export (S20)
```

### 7.2 Screen list

| ID | Screen | Phase |
|---|---|---|
| S01 | Welcome and install | 1 |
| S02–S07 | Setup steps | 1 |
| S08 | Today | 1 |
| S09 | Log sheet | 1 |
| S10 | Estimating | 1 |
| S11 | Review (shared) | 1 |
| S12 | Diary: day | 1 |
| S13 | Diary: week | 1 |
| S14 | Entry detail / edit | 1 |
| S15 | Morning check-in | 1 |
| S16 | Weight | 1 |
| S17 | Budget breakdown | 1 |
| S18 | Plan a makan day | 1 |
| S19 | Settings | 1 |
| S20 | Export | 1 |
| S21 | Places list | 2 |
| S22 | Place detail | 2 |
| S23 | Usuals | 2 |
| S24 | Plate builder | 2 |
| S25 | Photo capture | 2 |
| S26 | Pots list | 2 |
| S27 | New pot | 2 |
| S28 | Pot detail | 2 |
| S29 | Log workout | 2 |
| S30 | Activity | 2 |
| S31 | Insights | 3 |
| S32 | Evidence sheet | 3 |
| S33 | Weekly review | 3 |
| S34 | Top dishes check | 3 |
| S35 | Timing detail | 3 |
| S36 | Meal ideas | 4 |
| S37 | Target suggestion | 4 |
| S38 | Reminders settings | 4 |
| S39 | Backups | 4 |
| S40 | Notifications | 4 |
| S41 | Goals library | 5 |
| S42 | Goal detail / edit | 5 |
| S43 | New goal from template | 5 |
| S44 | Switch goal sheet | 5 |
| S45 | View under another goal | 5 |
| S46 | Offline and sync states | 1 |
| S47 | AI failed | 1 |
| S48 | More menu | 1 |

### 7.3 Screen details

Layouts run top to bottom. Component IDs are in brackets.

---

#### S01 Welcome and install
- **Purpose:** first open; get the app installed on the home screen.
- **Layout:** app name and icon → one line: "A calorie budget that speaks Malaysian food" (Designer's call on wording) → Get started → InstallPrompt [C59] (iOS / Android versions).
- **States:** in browser (show install prompt) · already installed (skip straight to setup).

#### S02–S07 Setup (about 2 minutes) [C53]

| Step | Content | Notes |
|---|---|---|
| **S02 About you** | Age, sex, height ("an estimate is fine"), today's weight | Short helper line under height |
| **S03 Your activity** | "On a day **without** workouts, you're mostly…" (WFH, mostly sitting / on your feet a fair bit / very active) | Explain that workouts are added separately |
| **S04 Goal and pace** | Goal: Cut (pre-selected). Pace: 0.25 / 0.5 / 0.75 kg a week. **Live result:** "Starting maintenance ~2,350 → daily target **1,800 kcal**". Daily minimum (sample 1,400) | The result updates as pace changes |
| **S05 Your regulars** | Tap common meals to make them Usuals (Roti canai + teh tarik, Nasi lemak bungkus, Bread kaya kopi, Mee goreng, + Add your own) | So suggestions work on day 1 |
| **S06 Your main Places** | Add 2–3: Home (pre-added), your mamak, your economy-rice stall | Location is set later, when you're there |
| **S07 Your day** | Day rollover (5am default, with a one-line explanation: "a 2am supper counts as the night before") and week start (Monday) → Done | Done leads to Today, first-day state |

---

#### S08 Today
- **Purpose:** the home screen. How much is left, what you've eaten, and what's next.
- **Layout:**
  1. TopBar [C02]: "Today · Fri", GoalPill [C03] "Cut · 1,800".
  2. Check-in banner [C06] (only when yesterday is unconfirmed).
  3. **BudgetRing** [C07]: **570** "kcal left today". Underneath: "Saved this week **+650**" (tap → S17).
  4. MacroBar row [C08]: Protein 42 / 110g (behind) · Carbs 145 / 180g · Fat 52 / 60g.
  5. WeeklyFocusCard [C44] (if a focus is set).
  6. DayTimeline compact [C12]: window from first meal 10:40am, "closes 10:40pm"; dots at 10:40am and 2:15pm; "now" marker.
  7. Meals by slot [C30, C29]: Breakfast (roti canai + teh tarik, ~560, *Late for you*) · Lunch (economy rice, ~670, *On time*) · **Dinner · not logged → "Meal ideas"** button · Snacks.
  8. One-line nudge (e.g. "Protein is behind: ~70g left. A protein-heavy dinner helps").
  9. SleepTap [C61] (evenings only, near your usual sleep time).
  10. BottomNav [C01] with the Log button.
- **States to design:**
  - First day (empty, friendly welcome, "Log your first meal")
  - Morning, nothing logged yet
  - Normal (sample above)
  - Near budget (10% or less left)
  - **Over budget** ("+120 over · covered by savings", amber)
  - Makan day planned ("Saving for Saturday: 2,450 room")
  - **Lean bulk** variant (main number: protein left, "88g")
  - **Festive maintain** variant (main number: "5 of 7 days in range")
  - **Pause** variant (no ring; "Paused until Mon"; log list only)
  - Offline / entries waiting to sync
  - Check-in waiting (banner + nav badge)

#### S09 Log sheet
- **Purpose:** the single entry point for logging. Opens as a sheet from the centre nav button (Designer's call: sheet or full screen).
- **Layout:**
  1. Context chips: PlaceChip [C18] "Nasi kandar near home · Nearby", TimeChip [C19] "Now", MealSlotChip [C20] "Dinner".
  2. LogInput [C16] with placeholder *"nasi lemak ayam goreng, teh o ais"*.
  3. QuickActionRow [C17]: Photo · Plate · Usuals · Pot.
  4. "At this Place" usual orders [C35] (one-tap log).
  5. Recent Usuals [C37].
- **Behaviour:** while typing, show **instant matches** from your library and the catalogue (no AI, with ~kcal). Tapping a match adds it as an item; Send asks the AI to read the whole text.
- **States:** empty · typing with matches · no location (no "Nearby") · offline ("Estimate will run when you're back online; you can still pick from your library") · Pot available ("Kari ayam pot · 3 left").

#### S10 Estimating
- **Purpose:** the 2–6 s while the AI reads the meal.
- **Layout:** the text you typed (or the photo) at the top → SkeletonLoader rows [C57] → "Estimating…" → Cancel.
- **States:** text · photo · slow (> 6 s: "Still working…") · failure → S47.

#### S11 Review (shared by all logging flows)
- **Purpose:** check and fix items before saving. This is the **most important screen**.
- **Layout:**
  1. Context chips: Place, time, slot (all editable). Photo thumbnail if there is one.
  2. FollowUpQuestion [C25] when needed: "Is there kuah under the rice?" Sikit / Normal / Banjir / Skip.
  3. ReviewItemRows [C21] with PortionChips [C22] and SourceTags [C24]. Sample (Place: *Medan selera nearby*):
     - Rice: Small / **Normal** / Mamak big · ~330
     - Ayam goreng: **1 piece** / 2 pieces · ~300
     - Kubis, 1 scoop · ~70
     - Kuah campur: Sikit / **Normal** / Banjir · ~120
     - Teh o ais: Kosong / **Kurang** / Normal · ~60
  4. "+ Add item" (opens search) and swap or remove on each row.
  5. FinishedPicker [C26] (collapsed: "Finished it all?").
  6. Price (optional): "RM".
  7. **RangeTotal** [C23], sticky: "Best guess **880 kcal** · likely 750–1,010".
  8. **Save to diary** (primary). Secondary toggle: "Also save as a Usual".
- **States:** all confident · includes an **AI guess** item · with a follow-up question · item edited · **offline** (items waiting for AI, saving still allowed) · edit mode (from S14: "Edit entry", with Delete).
- **After saving:** Toast [C05] "Saved · Undo". If you've made the same correction twice at this Place → CorrectionScopePrompt [C28].

#### S12 Diary: day view
- **Layout:** TopBar with date switcher (‹ Thu · Fri › Sat) → DayStatusBadge [C32] + "1,230 of 1,800 kcal" → DayTimeline [C12] → meals by slot [C30, C29] → workout row → weight row ("77.8 kg") → search icon in TopBar.
- **States:** complete · unconfirmed · **guess added** (the guess row looks clearly different, e.g. dashed with "Guess" label) · **not counted** (whole day dimmed with an explanation) · paused · empty day.

#### S13 Diary: week view
- **Layout:** week switcher → WeekBars [C10] → one row per day (total, DayStatusBadge, makan-day marker) → "View under: goal at the time / current goal" toggle (S45).
- **States:** current week (today partial, rest planned) · past week · week with a goal switch (marker on the switch day).

#### S14 Entry detail / edit
- Reuses S11 in edit mode, plus: photo [C33], **history** ("Original estimate ~820 · edited by you"), Duplicate, Save as Usual, Delete [C60].

#### S15 Morning check-in
- **Purpose:** confirm yesterday so missed meals don't become fake savings.
- **Trigger:** the first app open after the day rollover, if yesterday looks incomplete or isn't confirmed. Shown as a sheet or card over Today.
- **Layout:** CheckInCard [C49]. Scenario B (section 9.6): "Yesterday · 2 meals · 1,240 kcal" → timeline with a highlighted gap → "Nothing logged for 10 hours after 3:40pm. You usually have dinner around 9pm." → **Was that everything?**
  - Yes, that's all I ate
  - I had dinner. Fill in a typical one (~650)
  - I ate more. Let me add it
  - Don't count this day
  → a consequence line updates as you choose ("Adds ~650 kcal to this week's budget, marked as a guess. Left out of maintenance and timing insights.").
- **States:** each of the four choices selected · a day that looks complete (lighter version: "Yesterday: 3 meals, 1,760 kcal. All there?" with Yes / Add more).

#### S16 Weight
- **Layout:** WeightEntry [C50] (pre-filled "77.8") → Save → WeightTrendChart [C11] (14 / 30 / 90 days) → MetricTiles [C09]: Trend 77.9 kg · This week −0.4 kg · Plan −0.5 kg/week → list of entries.
- **States:** first weigh-in (no trend yet: "Your trend appears after a few weigh-ins") · normal · spike annotated · gaps in weigh-ins.

#### S17 Budget breakdown
- **Purpose:** show the weekly budget maths in plain words (tapping the ring opens it).
- **Layout:** WeekBars [C10] → rows: Weekly budget 12,600 (+ workouts) · Eaten so far 7,780 · **Saved +650** · Left this week 4,820 → short explanation ("Unspent calories from finished days are saved for later in the week. Each week starts fresh on Monday.") → **Plan a makan day** button → daily minimum note → OneOffBonus [C52] entry.
- **States:** under · over (how the shortfall spreads: "Sat and Sun allowance: 1,650 each, never below your 1,400 minimum") · with a workout added · with a goal switch this week (prorated maths shown).

#### S18 Plan a makan day (sheet)
- Pick a day (Sat / Sun / other) → "Room on Saturday: **~2,450 kcal** if today and Sunday stay at 1,800" → Confirm → Today shows "Saving for Saturday".

#### S19 Settings
- **Sections:** Profile and body · Budget (daily minimum, week start) · Day (rollover time) · Reminders (S38) · Location (on/off) · Photos (keep photos, quality) · Backups (S39) · Export (S20) · About and disclaimer ("Estimates are approximate. Not medical advice.") · **Delete everything** [C60].

#### S20 Export
- Options: Full backup (JSON) · Spreadsheet files (CSV) · Photos (zip) → Export → share sheet. Shows the last export date.

---

#### S21 Places list
- Search → sort (recent / most visited) → PlaceCards [C34] → "+ New place".
- **Empty state:** "Places appear as you log. Type a name in 'Where?' next time you eat out."

#### S22 Place detail
- **Layout:** name and type pill → visits ("14 in 30 days") → MetricTiles: avg here 920 vs elsewhere 640, spend RM 58 this week → **Your usual orders** [C35] → **What you've taught it** [C36] (Rice portion: Big +30% · Default kuah: Banjir · Oil level: High) → location (set / update "I'm here now") → for economy-rice Places: **Trays here** (the dishes this stall usually has) → edit / delete.
- **States:** new Place (few visits: "Learning your orders") · economy-rice Place · Home (shows pots and home-style dishes).

#### S23 Usuals
- UsualCards [C37], reorder, + New Usual, suggested Usuals ("You've logged *Bread, kaya, kopi* 4 times. Save as a Usual?").

#### S24 Plate builder (economy rice)
- **Layout:** PlaceChip "Kedai near home" → Rice: Half / **1 scoop** / 1.5 scoops (plus other bases) → "Tap a dish to add it, tap again for 2" → DishTile grid [C27] grouped: **Protein** (ayam goreng 280 · **ayam masak merah 250** · ikan goreng 200 · telur dadar 180) · **Vegetables** (**kangkung belacan 90** · **kubis goreng 70** · terung sambal 120 · taugeh 60) · Tofu and egg → **Kuah on rice**: None / **Some** / Banjir → Oil level here: Medium (remembered) → Price (optional) RM 9.50 → sticky RangeTotal: **670 kcal**, likely 570–770 → **Review and save** → S11.
- **States:** a Place with remembered trays (its dishes first) · a new Place (generic grid) · dishes at ×2 · searching for a dish not on the grid.

#### S25 Photo capture
- Camera or gallery → preview → caption box ("Add a few words, e.g. *kuah banjir*") → **Estimate** → S10 → S11 (with FollowUpQuestion and FinishedPicker).
- **States:** camera permission primer [C58] · no camera (gallery only) · offline (photo saved, estimate waits).

#### S26 Pots list
- Active pots [C38] ("Kari ayam · 3 of 8 left · ~500 each · clears Sunday") → saved recipes ("Cook again") → + New pot.
- **Empty state:** "Cooked a big pot? Type the recipe once and log servings in one tap."

#### S27 New pot
- **Layout:** name → recipe text box ("1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak…") → **Split into ingredients** → IngredientRows [C39] (Ayam ~2,150 · Santan ~800 · Kentang ~350 · Rempah, bawang ~250 · **Cooking oil: 2 / 4 / 6 tbsp** ~480) → Whole pot **~4,030 kcal** → Servings: 6 / **8** / 10 → **~500 kcal a serving** → Save pot.
- **States:** splitting (loading) · unknown ingredient (AI guess tag) · edited amounts.

#### S28 Pot detail
- "3 of 8 left" (large) → ~500 kcal a serving → **Log 1 serving** (plus ½ and 2) → ingredients → "Clears Sunday" → Cook again → Delete.

#### S29 Log workout
- WorkoutForm [C51]: Futsal · 60 min · Moderate → "**~470 kcal** added to this week" → Save. A "Big one-off day?" link opens OneOffBonus [C52].
- Short helper line: "Estimated from activity type, time, intensity and your weight."

#### S30 Activity
- Workouts by week, with kcal added → + Log workout. Sample: "Last week · Tue · Futsal 60 min, moderate · ~470".

---

#### S31 Insights
- **Layout:**
  1. **This week** MetricTiles [C09]: Budget +350 · Trend −0.4 kg · Complete 6 of 7.
  2. **Top 3** InsightCards [C41]:
     - "Drinks were 17% of your calories" · "Teh tarik 8 times, milo ais 3 times, ~2,200 kcal" · Try: "kurang manis for half of them, about 300 kcal a week less" · See 11 drinks.
     - "Nasi kandar nights cost the most" · "4 visits, ~950 kcal each vs 640 elsewhere" · Try: "half rice there, or kuah sikit".
     - "Long eating days ran higher" · "Days over 13 hours averaged +350 kcal" · **Early read, 9 days**.
  3. **Where it came from:** CategoryBars [C14] (Rice dishes 38% · Home cooking 18% · **Drinks 17%** · Noodles 14% · Snacks and kuih 13%) → by Place (Nasi kandar near home 3,800 · RM 58 / Home 2,300 · RM 31 / Kedai near home 1,900 · RM 38).
  4. **Recurring calories** [C43]: Teh tarik ~8 a week ≈ 1,450 · Roti canai ~3 a week ≈ 900 · Evening biscuits ~5 a week ≈ 750.
  5. **When you ate:** TimingGrid [C13], average window 10.4 h.
  6. **Unlocks as you log** [C15]: Timing patterns 9 of 14 · Your real maintenance 9 of 21.
  7. Entry to the last weekly review.
- **States:** **days 1–6** (budget and categories only; friendly "More insights unlock as you log" with progress) · normal · all unlocked · a dismissed insight (collapsed with undo) · target suggestion waiting (TargetSuggestionCard at the top).

#### S32 Evidence sheet
- BottomSheet [C04]: "11 drinks this week · ~2,200 kcal" → mini bar by day → MealRows [C29] → "Not for me" option.

#### S33 Weekly review (Sunday night)
- **Three steps:**
  1. **Your week:** WeekBars, budget result (+350), trend (−0.4 kg), complete days (6 of 7), last focus result ("kurang manis on 5 of 8 drinks").
  2. **Top 3:** InsightCards.
  3. **Pick one thing to try next week:** 3 options taken from the insights → choose one → "Got it. It's on your Today screen."
- **Day-7 version, "What we learned about you":** your usual meal times, top Places, top foods, and complete days. No judging.

#### S34 Top dishes check (day 14)
- "Check your 30 most-logged dishes once" → list rows: dish, ~kcal per portion, source tag → for each: **Looks right / Usually more / Usually less** → progress "12 of 30" → Done.

#### S35 Timing detail
- Expanded DayTimeline [C12] with wake and sleep markers → metrics: first meal, last meal, **window length**, **eating occasions**, first-meal drift vs your usual → TimingGrid [C13] for the week → an explanation of the "Going to sleep" button.
- **States:** before day 14 ("Early read") · a day with a sleep tap · a day without (that check is skipped).

---

#### S36 Meal ideas
- **Layout:** context line: "**570 kcal** and ~70g protein left · window closes 10:40pm" → 3 SuggestionCards [C40]:
  - **Your usual:** Ayam bakar, half rice, ulam · ~540 kcal · 38g protein · "You had this 6 times this month"
  - **Lighter swap:** Mee sup ayam instead of mee goreng · ~430 kcal · 26g protein · "Your Friday favourite, about 400 kcal lighter"
  - **Something different:** 3-egg omelette, sayur, small rice · ~510 kcal · 27g protein · "Not had in 12 days. Easy for a WFH evening"
  → **Surprise me**.
- **States:** little budget left (light options only, phrased neutrally) · over budget ("Lightest options for tonight", no blame) · no history yet (starter picks, "Ideas get better as you log") · near a saved Place (that Place's options first) · logged (card shows "Logged").

#### S37 Target suggestion
- TargetSuggestionCard [C45] in full: "Your real maintenance looks like **~2,100**, not 2,350" → the working: "You logged ~1,820 a day, and your trend dropped 0.25 kg a week" → new daily target **1,550** at your 0.5 kg/week pace (never below your 1,400 minimum) → **Approve** / Keep current → secondary: "Change pace instead" (e.g. 0.25 kg/week → ~1,825) → history of target versions.

#### S38 Reminders
- Morning check-in (on) · **Gap nudges** (locked until about day 14: "Switches on once the app knows your pattern") · Weekly review notification (Sunday night) · Quiet hours (from your sleep taps, or custom).

#### S39 Backups
- PermissionPrimer [C58] ("Saves a weekly copy to a folder in your Google Drive. The app can only see files it creates.") → Connect Google Drive → BackupStatus [C55]: Last backup Sun 9:00pm · Keeps last 12 · Back up now · Disconnect.
- **States:** not connected · connected · failed ("Couldn't reach Google Drive. Retry") · in progress.

#### S40 Notifications (push designs)
| Notification | Example text |
|---|---|
| Gap nudge | "6 hours since your last log. Dinner time for you?" |
| Morning check-in | "Quick check: was yesterday's log complete?" |
| Weekly review | "Your week is ready: +350 kcal, trend −0.4 kg" |
| Target suggestion | "New target suggestion based on 3 weeks of data" |
| Backup failed | "Weekly backup couldn't reach Google Drive" |

---

#### S41 Goals library
- Active GoalCard [C46] (Cut · 1,800 a day · −0.5 kg a week · week 3) → saved goals (Festive maintain · Saved; Lean bulk · Draft) → templates (Pause) → + New goal.

#### S42 Goal detail / edit
- GoalEditorFields [C48] → versions history ("1,800 since setup") → end condition → Switch to this goal / Archive.

#### S43 New goal from template
- Choose a template (Cut / Festive maintain / Lean bulk / Pause / Custom) → pre-filled fields → adjust → Save (doesn't become active until you switch).

#### S44 Switch goal sheet
- GoalSwitchSheet [C47]: "Switch to **Festive maintain**?" · "Starts tomorrow (Sat). Past days keep the goal they had." · "This week: 5 days at 1,800 + 2 days at 2,100 = **13,200 kcal**" · "Main number becomes days in range (2,100 ± 10%)" · **Switch from tomorrow** / Cancel.
- **Variants:** to Lean bulk ("Main number becomes protein left, 130g") · to Pause ("Budget off. Logging is optional, and these days stay out of trends").

#### S45 View under another goal
- A toggle in Diary week (S13) and Insights (S31) headers, plus a banner: "Viewing last month under Lean bulk. Your meals haven't changed."

#### S46 Offline and sync states (patterns across screens)
- Offline banner [C06] · a "waiting to sync" icon on MealRows · Review items "Estimate will run when you're back online" · Toast "Saved offline, will sync".

#### S47 AI failed
- "Couldn't estimate this right now." → Try again · Pick from your library · Enter kcal yourself → nothing typed is lost.

#### S48 More menu
- Goals · Places · Usuals · Pots · Weight · Activity · Settings.

---

## 8. Key Flows to Prototype

| ID | Flow | Steps | Target |
|---|---|---|---|
| F01 | **First run** | S01 → S02–S07 → S08 (first-day state) | About 2 min |
| F02 | **Mamak meal by text** | Log → type → S10 → S11 (change kuah to banjir) → Save → Toast → Today ring updates | Under 30 s |
| F03 | **Economy rice at the stall** | Log → Plate (Place auto-selected) → tap dishes → Review → Save | Under 30 s |
| F04 | **Repeat meal** | Log → Usual (or Place usual order) → Review (pre-filled) → Save | Under 15 s |
| F05 | **Photo** | Log → Photo → caption → S10 → FollowUpQuestion → S11 → Finished? → Save | |
| F06 | **Fix and teach** | Diary → entry → change rice to Big → Save → "Make big rice the default here?" → Yes | |
| F07 | **Morning check-in** | Open app → S15 → "Fill in a typical one" → consequence shown → Today | |
| F08 | **Plan a makan day** | Today ring → S17 → Plan a makan day → Saturday → Today shows "Saving for Saturday" | |
| F09 | **What should I eat?** | Today → Meal ideas → Log this → Review → Save | |
| F10 | **Weekly review** | Sunday notification → S33 steps 1–3 → pick a focus → Today shows the WeeklyFocusCard | |
| F11 | **Approve a target** | Notification or Insights → S37 → Approve → new goal version | |
| F12 | **Switch goal** | More → Goals → Festive maintain → S44 → Switch → tomorrow's Today shows the new main number | |
| F13 | **Cook a pot** | Log → Pot → New pot → type recipe → oil → servings → Save → Log 1 serving | |
| F14 | **Log a workout** | More → Activity → Log workout → Save → Today's "left" goes up | |
| F15 | **Weigh-in** | Weight → number pad → Save → trend updates | Under 5 s |
| F16 | **Connect backups** | Settings → Backups → primer → Google consent → Connected | |

**Minimum clickable prototype:** F02, F03, F07, F09 and F10.

---

## 9. Sample Data (use on every screen)

### 9.1 Profile and goal
- Age 30, height ~172 cm (estimate), weight 78.6 kg at setup. Activity: WFH, mostly sitting.
- Starting maintenance ~2,350 · pace 0.5 kg/week · **daily target 1,800** · daily minimum 1,400 · protein 110g.
- **Weekly budget 12,600** (Mon–Sun) · day rollover 5am.
- Goal library: **Cut** (active, week 3) · Festive maintain (2,100 ± 10%, saved) · Lean bulk (2,300 kcal, protein 130g, draft) · Pause (template).

### 9.2 This week (today is Friday)

| Day | kcal | Status |
|---|---|---|
| Mon | 1,620 | Complete |
| Tue | 1,710 | Complete |
| Wed | 1,540 | Complete |
| Thu | 1,680 | Complete |
| **Fri (today)** | **1,230 so far** | In progress |
| Sat | planned 2,450 (makan day) | Planned |
| Sun | planned 1,800 | Planned |

- Saved this week: **+650** (Mon–Thu). Eaten so far: 7,780. Left this week: 4,820.
- Saturday room if today and Sunday hit 1,800: **2,450**.

### 9.3 Today's meals
- **Breakfast, 10:40am, Nasi kandar near home** · Roti canai + dhal (~360) and teh tarik (~200) = **~560 kcal** · RM 4.80 · *Late for you* (usually ~9:30am).
- **Lunch, 2:15pm, Kedai near home** · Economy rice: 1 scoop rice (200), ayam masak merah (250), kangkung belacan (90), kubis goreng (70), kuah some (60) = **~670 kcal** · RM 9.50 · *On time*.
- **Today's totals:** 1,230 kcal · left **570** · protein 42 / 110g · carbs 145 / 180g · fat 52 / 60g.
- Eating window opened 10:40am → closes **10:40pm** (12-hour rule).

### 9.4 Places
| Place | Type | Detail |
|---|---|---|
| Nasi kandar near home | Mamak | 14 visits in 30 days · avg 920 kcal (vs 640 elsewhere) · usual orders: nasi kandar ayam goreng kuah campur (9×, ~950), roti telur + dhal (4×, ~420), teh o ais kurang (12×, ~60) · learned: rice big +30%, kuah banjir, oil high |
| Kedai near home | Economy rice | 9 visits · avg 640 · oil medium · typical RM 9.50 |
| Medan selera nearby | Hawker | 2 visits (new, still learning) |
| Home | Home | Kari ayam pot; home-style dishes |

### 9.5 Usuals, pot, weight and workout
- **Usuals:** Roti canai + teh tarik (~560) · Bread, kaya, kopi (~380) · Nasi lemak bungkus (~490) · Teh o ais kurang (~60).
- **Pot:** Kari ayam · cooked Wednesday · 8 servings · **3 left** · ~500 kcal a serving · clears Sunday.
- **Weight (last 14 days):** 78.6, 78.3, 78.5, 78.1, 78.2, 78.0, **79.0** (Monday after a weekend), 78.6, 78.2, 78.1, 77.9, 78.0, 77.7, 77.8 → trend **77.9 kg**, about −0.5 kg in 2 weeks.
- **Workout (last week, Tue):** Futsal · 60 min · moderate · ~470 kcal added.

### 9.6 Scenario B: incomplete yesterday (for S15 only)
- Yesterday: 2 meals (11:10am, 3:40pm) · 1,240 kcal · woke ~10am · slept ~1:30am · usual dinner ~9pm · typical dinner ~650 kcal.

### 9.7 Last week's review (for S31 and S33)
- Budget 12,950 vs 12,600 (**+350**) · trend −0.4 kg · complete days 6 of 7 · last focus "kurang manis for drinks": 5 of 8.
- Insights, categories, Places and recurring calories as listed under S31.

### 9.8 Suggestions (dinner, Friday 7:10pm)
- As listed under S36 (570 kcal left, ~70g protein left, window closes 10:40pm).

---

## 10. Copy and Content Guide

### 10.1 Voice
- Plain, warm and brief, like a friend who's good with numbers. Talk to the user as "you".
- Sentence case everywhere (buttons, titles, tabs).
- Malaysian food words are normal words: *kuah banjir, kurang manis, bungkus, senduk, makan*. Don't italicise or translate them in the UI. (Italics in this document are only for examples.)

### 10.2 Number formats
| Thing | Format |
|---|---|
| Calories | "1,800 kcal"; estimates "~560 kcal"; ranges "750–1,010 kcal"; estimates rounded to the nearest 10 |
| Macros | "42g"; progress "42 / 110g" |
| Weight | "77.9 kg" (one decimal); change "−0.4 kg" |
| Money | "RM 9.50" |
| Time | "1:20pm", "10:40am" |
| Days | "Today", "Yesterday", "Thu"; dates "Fri 16 Oct" |
| Changes | "+650 saved", "+120 over" |

### 10.3 Words to avoid
| Avoid | Why | Use instead |
|---|---|---|
| bad, junk, unhealthy, cheat, guilty, naughty | Moralising | "doesn't fit today", "makan day" |
| failed, broke, ruined (about a day or week) | Guilt | "went over by 350" |
| earn, deserve (about food) | Food as reward or punishment | "workout added 470 kcal" |
| please, successfully, "!" | Filler or shouty | "Saved", "Backup done" |
| exact, precise (about estimates) | False precision | "best guess", "likely" |

### 10.4 Key strings
| Where | Text |
|---|---|
| Log placeholder | "nasi lemak ayam goreng, teh o ais" |
| Photo caption hint | "Add a few words, e.g. kuah banjir" |
| Range line | "Likely 750–1,010 kcal. Tap anything to adjust." |
| Over budget | "+120 over today · covered by your savings" |
| Check-in question | "Was that everything?" |
| Missed-log rule | "Missed meals never count as calories saved." |
| Early insight | "Early read · based on 9 days" |
| Locked insight | "Timing patterns unlock in 5 days" |
| Empty Today | "Log your first meal. A rough guess is fine." |
| Empty Places | "Places appear as you log. Type a name in 'Where?' next time you eat out." |
| AI failed | "Couldn't estimate this right now. Try again, or pick from your library." |
| Offline save | "Saved offline. It'll sync when you're back online." |
| Disclaimer | "Estimates are approximate. This app isn't medical advice." |

---

## 11. Design Priority by Phase

Design in this order, so building can start before every screen is finished.

| Phase | Design first | Screens |
|---|---|---|
| **1** | Design system + core components (C01–C33, C49–C50, C53–C61) | S01–S20, S46–S48 |
| **2** | Places, Usuals, Pots, workouts (C34–C39, C51–C52) | S21–S30 |
| **3** | Insights (C41–C44) | S31–S35 |
| **4** | Suggestions, target, reminders, backups (C40, C45) | S36–S40 |
| **5** | Goals (C46–C48) | S41–S45 |

**Variants needed in Phase 1 anyway:** the BudgetRing [C07] variants for all goals (kcal left, protein left, days in range, none). Today's layout must work for each from the start.

**Show on Today before its screen exists:** the "Meal ideas" button (S36, Phase 4) and the weekly focus card (Phase 3) are hidden until their phase ships. Design Today with and without them.

---

## 12. Deliverables Expected from Claude Design

1. **Design system:** colour roles (light and dark), typography scale, spacing, radius, elevation, motion and the icon set choice. Export tokens as **CSS variables** (or JSON) so they drop straight into the code.
2. **Component library:** every C-ID with all its variants and states, named `C07 BudgetRing`, `C07 BudgetRing / Over`, and so on.
3. **Screens:** every S-ID with all listed states, named `S08 Today / Over budget`, etc. Light and dark for at least S08–S16; light for the rest is fine to start.
4. **Clickable prototype** of at least F02, F03, F07, F09 and F10.
5. **Annotations** wherever behaviour isn't obvious from the picture (what's tappable, what animates, what's sticky).
6. **App icon, splash screen and install prompt.**
7. **A short change note** listing anything you changed from this brief and why.

Then hand the designs to Claude Code. The component and screen IDs here map one-to-one to code components and routes.

---

## 13. Designer's Calls

- **App name.** Placeholder ideas: *Kira Makan* ("kira" = count or calculate), *Makan Ledger*, *Budget Makan*. Feel free to propose others.
- **Visual identity:** palette, typeface, illustration style for empty states, app icon.
- **Log** as a bottom sheet or a full screen.
- **Main number:** ring (current idea) or another treatment, as long as it handles all goal variants.
- How dense the **Diary** is with photos (thumbnails on every row, or a photo-grid toggle).
- **Dark mode** character.
- **Constraints that aren't open:** over budget stays non-alarming (no red); macro colours must be colour-blind safe; every number keeps the "tap to explain" behaviour.

---

## 14. Out of Scope for This Design

- Social features, sharing or accounts for other people.
- Barcode scanning (later; leave room for one more button in the QuickActionRow [C17]).
- Native widgets, watch apps, Health Connect / Apple Health screens.
- A Malay-language UI (later; leave ~30% room for text expansion).
- A marketing website.
