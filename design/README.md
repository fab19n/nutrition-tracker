# Handoff: Kira Makan — Personal Food Tracker (Phase 1 prototype)

## Overview
Kira Makan is a personal calorie tracker that works like an expense tracker: a weekly calorie budget, meals logged like transactions, Places that remember usual orders, and estimates shown as ranges that are easy to correct with Malaysian portion words. This package covers the locked visual direction ("6a Kopitiam pandan") and a clickable prototype of the Phase 1 screens plus the key flows F02, F03, F07, F08, F09, F10.

Behaviour source of truth: `personal_food_tracker_product_plan.md`. Screen and component list: `design_handoff.md`. Both are included in this folder. Component IDs (C01…C61) and screen IDs (S01…S48) in this README match those documents one-to-one and should become the component and route names in code.

## About the Design Files
The files in this bundle are **design references built in HTML**. They show intended look and behaviour; they are not production code to copy. The task is to **recreate these designs in the target codebase** — per the product plan, a React + TypeScript PWA built with Vite — using its established patterns. If no codebase exists yet, start one with that stack.

- `Kira Makan.dc.html` — the clickable prototype (open in a browser; the left column jumps between screens, the Tweaks panel toggles dark mode and goal variants).
- `Direction Options.dc.html` — the exploration board. Only option **6a** (top section) is the locked direction; earlier rounds are history.

## Fidelity
**High-fidelity for visual style and layout.** Colours, type, radii, spacing and the component treatments shown are final and should be reproduced exactly. Icons are placeholders (unicode glyphs); use one outline icon family (see Assets). Photo thumbnails are hatched placeholders; real photos go there. Copy is final unless noted.

Screens not yet in the prototype (Setup S01–S07, Places S21–S22, Usuals S23, Photo S25, Pots S26–S28, Workouts S29–S30, Settings S19–S20, Goals S41–S45, Evidence S32, Top dishes S34, Timing detail S35, Target suggestion S37, Reminders S38, Backups S39) should follow the same tokens and component patterns described here and the layouts given in `design_handoff.md`.

---

## Design Tokens

### Typography
- Family: **Bricolage Grotesque** (Google Fonts, variable, weights 400–800). Fallback: system-ui, sans-serif.
- `font-variant-numeric: tabular-nums` on the app root. Every number uses tabular figures.
- Sentence case everywhere (titles, buttons, tabs).

| Role | Size / weight / tracking | Used for |
|---|---|---|
| Hero number | 84px / 800 / −0.05em / line-height .95 | Left today (S08) |
| Hero number, sheet | 48px / 800 / −0.03em | Makan-day room (S18) |
| Metric large | 30px / 800 / −0.02em | Weekly review figures |
| Metric | 22px / 700 | Saved this week, Left this week |
| Metric small | 20px / 700 | MetricTile values |
| Screen title | 26px / 700 / −0.02em | Today, Diary, Insights, More |
| Sub-screen title | 24px / 700 | Review, Meal ideas, Weight |
| Sheet title | 22px / 700 | Budget breakdown, Plan a makan day, Check-in |
| Card headline | 19px / 700 / line-height 1.25 | SuggestionCard dish name |
| Item name | 16px / 600 | MealRow name, ReviewItemRow name |
| Insight headline | 16px / 700 / line-height 1.3 | InsightCard |
| Body | 15px / 400–600 | Rows, body copy |
| Meal row kcal | 17px / 700 | "~560" |
| Label / chip | 13px / 600 | Chips, buttons, pills |
| Section heading | 13px / 700 / +0.02em, uppercase, colour `muted` | "TOP 3 THIS WEEK" |
| Caption | 12px / 400–600 | Hints, meta lines, axis labels |
| Tag | 11px / 600 | TimingTag, status badges, source tags |

### Colour roles — light / dark
Implement as CSS custom properties on the app root; dark mode swaps the set (class `dark` or `prefers-color-scheme`).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#FAF4EA` | `#171310` | surface-0, page background |
| `--card` | `#FFFFFF` | `#241E18` | surface-1, cards and sheets |
| `--card2` | `#F5ECDD` | `#352C24` | surface-2, inset chips, inactive controls, track backgrounds in sheets |
| `--text` | `#2B1D12` | `#F4ECDF` | text-primary |
| `--muted` | `#7A6656` | `#A89683` | text-secondary / captions |
| `--accent` | `#2F7A4F` | `#5FBF8A` | accent (primary action, selected chips, on-track fills, + button) |
| `--on-accent` | `#FFFFFF` | `#0E2A1C` | text on accent |
| `--accent-soft` | `#E7F2EA` | `#17352A` | budget-ok soft, "fits" badge bg, window band, Try box |
| `--accent-text` | `#1F5C3A` | `#5FBF8A` | positive numbers (+650, −0.4 kg), links |
| `--amber` | `#D9951E` | `#F2B24C` | budget-near / budget-over / timing-late, makan-day outline |
| `--amber-soft` | `#FBEBD0` | `#3D2E12` | amber tag bg, check-in banner bg |
| `--amber-text` | `#7A4A0C` | `#F2B24C` | amber tag text, "+310 over" |
| `--bar` | `#E6DCCB` | `#3A3129` | WeekBars logged days |
| `--dash` | `#CDBFA8` | `#4A3F35` | dashed outlines, target line, grab handle, faint dots |
| `--line` | `#EDE3D3` | `#352C24` | hairline dividers, bar tracks, chart grid |
| `--nav` | `#2B1D12` | `#F4ECDF` | bottom nav, sticky RangeTotal footer, toast |
| `--nav-text` | `#BFAE9C` | `#7A6656` | inactive nav items |
| `--nav-active` | `#FAF4EA` | `#2B1D12` | active nav item, text on `--nav` |
| `--protein` | `#2F6DB3` | `#6FA8FF` | macro-protein |
| `--carbs` | `#D9951E` | `#F2B24C` | macro-carbs |
| `--fat` | `#B5649A` | `#E59ACB` | macro-fat |
| `--thumb1` / `--thumb2` | `#EADBC4` / `#F5ECDD` | `#3A2F25` / `#2E251D` | photo placeholder hatch |
| `--sheet` | `rgba(43,29,18,.45)` | `rgba(0,0,0,.6)` | scrim behind sheets |
| `--shadow` | `0 1px 2px rgba(43,29,18,.06)` | none | card shadow |
| `danger` | `#B4432C` | `#E5735C` | errors and destructive actions only (not yet used in the prototype). Never for food or budget. |

Rules: over budget is amber, never red. Macro colours are the colour-blind-safe blue / amber / magenta set above. Colour never carries meaning alone: every tag has a glyph or word ("◔ Late for you", "● On time", "S ★").

### Spacing, radius, elevation
- 4pt grid. Screen side padding **16px** for cards, **20px** for text that sits directly on the background.
- Gap between stacked cards **8px**; between the hero card and the row above **14px**; section headings have 18px top / 8px bottom padding.
- Radii: hero card **28px**; standard card **20px**; small tile **16px**; chips, pills, buttons **999px**; week bars **8px**; inset segmented chips **10px** outer / **8px** inner; sheets **32px** top corners; nav pill **33px**; floating footer **30px**; toast **16px**; phone frame 46px (mock only).
- Elevation: cards are flat (`--shadow` in light only). Sheets sit on `--sheet` scrim. Toast: `0 8px 24px rgba(0,0,0,.2)`.
- Touch targets ≥ 44×44. Chips render at ~30px tall but need a 44px hit area.

### Motion
- Sheet open / toast / meal row enter: `km-up` — translateY(24px)→0 with fade, **250–300ms ease**.
- Skeleton pulse: opacity .5↔1, 1.4s ease-in-out, staggered 150ms per row.
- Number changes (hero, bars) should animate ~300ms. Respect `prefers-reduced-motion` (disable transforms, keep opacity).

---

## Components

### C01 BottomNav
Floating pill: `left/right: 12px; bottom: 24px; height: 66px; background: var(--nav); border-radius: 33px`, 5 equal columns, 12px/600 labels. Active item `--nav-active`, inactive `--nav-text`. Centre item is the **Log button**: 62px circle, `--accent` bg, `--on-accent` "+" at 30px, raised 26px above the pill (`margin-top:-26px`) with a 5px ring in `--bg` (`box-shadow: 0 0 0 5px var(--bg)`). Hidden on sub-screens (Review, Plate, Ideas, Weight, Estimating, Weekly review). Badge state for check-in waiting: 8px `--amber` dot at top-right of "Insights"/"Today" (not yet in prototype).

### C02 TopBar
Large title 26px/700 left, with the date in 14px `--muted` beside it on Today ("Today  Fri 16 Oct"). Right slot holds the GoalPill (Today) or a segmented Day/Week switch (Diary). Sub-screens: 40px circular back button (`--card` bg, "‹") + 24px/700 title, 12px gap. Date switcher variant (Diary day): 15px/600 row "‹ Thu   Fri 16 Oct · Today   Sat ›", outer labels `--muted`.

### C03 GoalPill
`--accent` bg, `--on-accent` text, 14px/600, padding 7px 13px, pill. Copy per goal: "Cut · 1,800", "Lean bulk · 130g", "Festive · 2,100", "Paused until Mon". Tap → Goals (S41).

### C04 BottomSheet
Anchored bottom, `--bg` background, 32px top radii, padding 10px 16px 34px, 40×4px grab handle in `--dash` centred with 14px below, max-height 88–92%, scrolls inside. Scrim `--sheet`; tap scrim closes. Enter animation `km-up`.

### C05 Toast
`left/right: 24px; bottom: 106px` (above nav), `--nav` bg, `--nav-active` text 14px/600, padding 12px 16px, radius 16px, "Undo" in `--accent` on the right. Auto-dismiss 3–3.5s. Copy: "Saved · ~880 kcal", "Saving for Saturday", "Yesterday confirmed", "Got it. It's on your Today screen".

### C06 Banner (check-in waiting)
Inside the scroll area under the TopBar: `--amber-soft` bg, `--amber-text` text 13px, radius 16px, padding 10px 14px, "Check ›" bold on the right. Copy: "**Yesterday looks incomplete.** 2 meals, 1,240 kcal." Tap → S15.

### C07 BudgetRing → implemented as the **Hero card** (ring replaced by number + WeekBars)
Card 28px radius, padding 18px 20px 16px. Two-column grid: left = label 13px `--muted` ("Left today") over the hero number 84px/800; right column, right-aligned, bottom-aligned: "Saved this week" 12px + "+650" 22px/700 `--accent-text`, then "Left this week" 12px + "4,820" 22px/700. Below: **C10 WeekBars** (see below), then a 12px caption row: "1,230 eaten · window closes 10:40pm" left, "Sat: 2,450 room" right. Tap anywhere → S17.
States:
- **Under**: as above.
- **Over**: label "Over today", number "+310" in `--amber-text`, note line 13px `--amber-text` "Covered by your +650 saved".
- **Lean bulk**: label "Protein left", number "88g".
- **Festive maintain**: label "Days in range", number "5 of 7".
- **Pause**: label "Budget off", number "—" in `--muted`, note "Logging is optional this week".

### C08 MacroBar
Three tiles in a 3-column grid, gap 8px: `--card`, radius 16px, padding 10px. Label 12px `--muted` ("Protein · behind" when < 55% of target, else "Protein"), value "42" 15px/700 + "/110g" 500 `--muted`, 6px track `--line` with fill in the macro colour, 6px above.

### C09 MetricTile
`--card`, radius 16px, padding 10px 12px. Label 12px `--muted`, value 20px/700 (coloured `--accent-text` for good, `--amber-text` for over), optional 11px `--muted` sub-line.

### C10 WeekBars
7-column grid, gap 6px, bottom-aligned, height 64px (hero) / 96px (Diary week) / 72px (Weekly review). A dashed 1.5px `--dash` target line sits at the daily target height. Bar states: **logged** solid `--bar`, radius 8px; **today** 2px solid `--accent` outline with a solid `--accent` fill from the bottom to eaten/target %; **planned** 2px dashed `--dash` outline; **makan day** 2px dashed `--amber` outline, taller (room/target); **not counted** hatched `repeating-linear-gradient(135deg, var(--bar) 0 4px, transparent 4px 8px)` with 1.5px solid `--dash` border; **over** (past week) solid `--amber`. Day letters below: 12px/600 `--muted`, today in `--text`, makan day "S ★" in `--amber-text`.

### C11 WeightTrendChart
SVG 320×110. Three horizontal grid lines `--line` 1px. Daily readings: 3.5px circles in `--dash`. Trend: 3px `--accent` path, round caps (EMA, α≈0.25). Annotation: 5px hollow `--amber` circle + 10px `--amber-text` text ("Monday jump: salt and water"). Range switch 14d / 30d / 90d as a `--card2` segmented pill, 11px/600. Axis captions 11px `--muted` ("3 Oct" / "today").

### C12 DayTimeline (compact)
16px tall track, radius 8px, `--card2`. Eating-window band `--accent-soft` (full radius). Meal dots: 10–14px circles, size by kcal, colour `--accent` on time / `--amber` late. "Now" marker 2px `--text` line overhanging 3px top and bottom. Captions 11px `--muted` under: "5am · now · 5am" (logical day) or "woke 10am … slept 1:30am" (Check-in). Check-in gap: dashed 2px `--amber` rounded box over the gap with a 10px/700 `--amber-text` label above ("usual dinner 9pm").

### C13 TimingGrid
Rows "M T W T F S S" 28px label column + track; per row a 4px `--accent-soft` bar for the eating window and 7–12px dots (`--accent`, late `--amber`). Axis "5am · noon · 6pm · midnight" 11px. Header line: "Average window 10.4 h" left, "Early read · 9 days" right.

### C14 CategoryBar
Row: name 13px (700 when highlighted, else 500), % right 600; 6px `--line` track, fill `--bar` (or `--accent` for the highlighted category).

### C15 UnlockProgress
Row: label 13px, "9 of 14 days" `--muted` right; 6px `--line` track with `--accent` fill.

### C16 LogInput
Card 20px radius, padding 14px 16px, min-height 88px. Text 17px/1.4; placeholder "nasi lemak ayam goreng, teh o ais" in `--muted`. Footer row: hint 12px `--muted` ("Type it like a message" → "Matches from your library · no AI yet" while typing); right: 40px circle secondary button (`--card2`) + "Estimate" pill button 40px tall (`--card2`/`--muted` when empty, `--accent`/`--on-accent` when text present).

### C17 QuickActionRow
4-column grid, gap 8px: `--card` tiles radius 16px, padding 12px 6px, 20px glyph over 12px/600 label: Photo · Plate · Usuals · Pot. Leave room for a 5th (barcode) later.

### C18 PlaceChip
`--accent` pill with pin glyph "⌖" when auto-selected/chosen ("⌖ Nasi kandar near home · Nearby"). Secondary context chips (TimeChip C19 "Now", MealSlotChip C20 "Dinner") are `--card` pills 13px, padding 7px 12px.

### C21 ReviewItemRow
Card 20px radius, padding 12px 14px. Header: name 16px/600 + **C24 SourceTag** inline (11px/600, pill, 1px border `--line` + `--muted` text; **AI guess** = dashed 1px `--amber` border + `--amber-text`), kcal "~330" 16px/700 right. Optional **C25 FollowUpQuestion** line 13px `--muted` ("Is there kuah under the rice?") — a row with a question gets `box-shadow: inset 0 0 0 1.5px var(--amber)`. Below: **C22 PortionChips** row, gap 6px, wrap.
States: confident (default) · AI guess (tag + amber ring) · edited (selected chip changed; keep original in history) · waiting for AI (offline: kcal replaced by "—", hint "Estimate will run when you're back online").

### C22 PortionChips
Pill 13px/600, padding 6px 12px. Unselected `--card2` bg / `--text`; selected `--accent` bg / `--on-accent`. Groups used: Small / Normal / Mamak big · Sikit / Normal / Banjir · Kosong / Kurang / Normal · 1 piece / 2 pieces · Half / 1 scoop / 1.5 scoops · None / Some / Banjir. Long-press shows grams (not in prototype).

### C23 RangeTotal (sticky footer)
Floating: `left/right: 10px; bottom: 22px; background: var(--nav); color: var(--nav-active); radius 30px; padding 14px 16px 14px 20px`. Left stack: "Best guess" 12px at 70% opacity, "880 kcal" 26px/800, "likely 750–1,010" 12px 70%. Right: **Save** pill button `--accent`, 16px/700, padding 16px 22px. Below (Review only): a 6px three-segment bar — eaten (accent at 45%), this meal within budget (accent), overflow (amber) — then 12px line "After this: 310 over today · covered by your +650 saved" or "After this: 120 kcal left today". Range = best guess ±15%, rounded to 10.

### C27 DishTile
2-column grid, gap 8px. `--card`, radius 16px, padding 12px. Name 14px/600, "~250 a piece" 12px `--muted`. Selected: `inset 0 0 0 2px var(--accent)` ring + count badge top-right (`--accent` pill, 22px tall, "×1"/"×2"). "Picked often" 11px/600 `--accent-text` when unselected and frequent. Tap cycles 0 → 1 → 2 → 0.

### C29 MealRow
`--card`, radius 20px, padding 10px, flex, gap 12px. 52px square thumbnail radius 16px (photo or hatched placeholder). Middle: meta 12px `--muted` "Breakfast · 10:40am · Nasi kandar near home" (Diary adds "· RM 4.80"), name 16px/600, **C31 TimingTag** pill 11px/600 ("◔ Late for you" amber-soft/amber-text; "● On time" accent-soft/accent-text). Right: "~560" 17px/700. Swipe: duplicate / delete with undo (not in prototype).

### C30 MealSectionHeader (empty slot)
Dashed 2px `--dash` box, radius 20px, padding 10px 10px 10px 14px: "Dinner" 12px `--muted` / "Not logged yet" 16px/600, and a **Meal ideas** `--accent` pill button (14px/600, padding 10px 16px) right.

### C32 DayStatusBadge
Pill 11px/600: Complete (accent-soft / accent-text), In progress (accent-soft / accent-text with "●"), Unconfirmed and Makan day (amber-soft / amber-text), Planned (card2 / muted), Not counted (card2 / muted, hatched bar), Paused (card2 / muted).

### C40 SuggestionCard
`--card`, radius 24px, padding 14px 16px. Header: role 12px/700 `--muted` uppercase ("YOUR USUAL" / "LIGHTER SWAP" / "SOMETHING DIFFERENT") left, fit badge right (11px/700 pill: "Fits" accent-soft, "Tight fit" amber-soft). Name 19px/700. Reason 13px `--muted`. Footer: "~540 kcal · 38g protein · Medan selera nearby" 14px with the kcal bold; **Log this** `--accent` pill 13px/700, padding 9px 14px. "Surprise me": dashed card, 15px/600 `--muted`, centred.

### C41 InsightCard
`--card`, radius 20px, padding 14px 16px. Headline 16px/700, evidence 13px `--muted` with a `--accent-text` 600 link ("See 11 drinks"). "Try:" box `--accent-soft` / `--accent-text`, radius 12px, padding 8px 10px, 13px. Footer: meta 11px `--muted` ("Early read · based on 9 days") left; "Useful" `--card2` pill + "Not for me" text button right.

### C44 WeeklyFocusCard
`--accent-soft` / `--accent-text`, radius 16px, padding 10px 14px, 13px: "**This week's focus:** kurang manis for drinks" left, "0 of 5" bold right.

### C49 CheckInCard
Sheet content: "Good morning" 13px `--muted`; "Yesterday · 2 meals · 1,240 kcal" 22px/700; timeline card (C12 with gap box); explanation 14px/1.45; "Was that everything?" 18px/700; four option rows (`--card`, radius 16px, padding 13px 14px, 15px/600 label + 22px radio circle: 2px `--dash` border unselected, filled `--accent` selected, selected row gets a 2px `--accent` inset ring); consequence line 13px `--muted` min-height 40px; **Done** full-width `--accent` pill 52px tall, 16px/700.

### C50 WeightEntry
Card radius 24px, centred: "This morning" 12px `--muted`; value 64px/800 −0.04em with " kg" 20px `--muted`; 3-column numpad of 44px-tall `--card2` keys radius 12px, 18px/600 (1–9, ".", 0, ⌫); **Save weigh-in** `--accent` pill 48px → label becomes "Saved · trend 77.9 kg".

### C56 EmptyState / C57 SkeletonLoader
Skeleton row: `--card`, radius 20px, padding 14px; grey blocks in `--card2` (14px title bar of varying width, two 26px chip pills, 40×16 kcal block); pulse animation staggered. Under rows: "Estimating… matching to your library and MyFCD" 14px `--muted` centred, then "Cancel" text button.

---

## Screens

All screens: phone portrait **390×844** design size, fluid down to 360 wide, centred column max ~480 on larger screens. Status bar area 47px. Scrollable content area with bottom padding 120px when the nav is visible, 150–170px when a sticky footer is visible.

### S08 Today
Order: TopBar (title + date, GoalPill) → Check-in Banner (conditional) → Hero card (C07 + C10) → MacroBar ×3 → WeeklyFocusCard (conditional) → MealRows by slot → empty Dinner slot with Meal ideas (until dinner is logged) → nudge line 13px `--muted` centred ("Protein is behind: ~68g left. A protein-heavy dinner helps." → after dinner: "Dinner logged. Window closes 10:40pm.") → BottomNav.
States shown in prototype via Tweaks: normal, over (after saving a big dinner), Lean bulk, Festive, Pause, check-in waiting, focus set. Still to design: first day / empty, offline.
Sample numbers: target 1,800; eaten 1,230 (560 + 670); left 570; saved +650; left this week 4,820; macros 42/110g, 145/180g, 52/60g.

### S09 Log sheet (C04)
Context chips (Place · Now · Dinner) → LogInput → match list while typing (`--card`, 14px rows: "Nasi kandar ayam goreng, kuah campur · your usual here  ~950", "Teh o ais kurang · your correction  ~60") → QuickActionRow → section "AT NASI KANDAR NEAR HOME" → UsualOrderRows (name 600, detail 12px `--muted`, "Log" `--card2` pill button) incl. a Pot row ("Kari ayam pot · 3 left", "Log 1").

### S10 Estimating
Back + "Reading your meal" → typed text in a card at 17px → 4 skeleton rows → status line → Cancel. Auto-advances to S11 after ~2.2s in the prototype (real: when the AI returns; show "Still working…" after 6s; failure → S47).

### S11 Review
Back + title ("Check your meal" / "Check your plate" / "Your usual order") → context chips → quoted source text 13px `--muted` (text flow only) → ReviewItemRows → row "+ Add item" (`--accent-text` 600) / "Finished it all? ▾" (`--muted`) → "Also save as a Usual" toggle row → sticky RangeTotal with "after this" bar and Save. Save → Today with toast "Saved · ~880 kcal" and Undo; hero, Friday bar, macros, week totals update.
Sample items (text flow): Rice Small/**Normal**/Mamak big ~330 (Catalogue) · Ayam goreng **1 piece**/2 pieces ~300 (MyFCD) · Kubis · 1 scoop ~70 · Kuah campur Sikit/**Normal**/Banjir ~120 (AI guess, question "Is there kuah under the rice?") · Teh o ais Kosong/**Kurang**/Normal ~60 (Your correction). Total 880, likely 750–1,010.

### S12 Diary day
TopBar with Day/Week segmented control → date switcher → status card (DayStatusBadge + "1,230 of 1,800 kcal", DayTimeline, 5am…5am captions) → MealRows (with RM) → Weight row ("Weight · 8:05am", "77.8 kg", "Trend 77.9" right) → dashed "No workout today".

### S13 Diary week
Week switcher ("‹ Last week  13–19 Oct · This week  ›") → WeekBars card (96px bars, caption "Target 1,800 a day" / "Saved so far +650") → day rows (day 600, DayStatusBadge, kcal 700; planned values in `--muted`) → "View under" segmented: Goal at the time / Current goal.

### S15 Morning check-in (sheet, non-dismissable by scrim)
CheckInCard as specified. Options and consequence copy:
1. "Yes, that's all I ate" → "Marks yesterday complete. Counts toward maintenance and timing."
2. "I had dinner. Fill in a typical one (~650)" → "Adds ~650 kcal to this week's budget, marked as a guess. Left out of maintenance and timing insights."
3. "I ate more. Let me add it" → "Opens Log with the time set to last night."
4. "Don't count this day" → "Counts as exactly 1,800. Missed meals never count as calories saved."
Done → Today, banner clears, toast.

### S16 Weight
Back + "Weight" → WeightEntry → trend card (range switch + chart + axis) → MetricTiles: Trend 77.9 kg · This week −0.4 kg · Plan −0.5 kg a week. Data: 78.6, 78.3, 78.5, 78.1, 78.2, 78.0, 79.0, 78.6, 78.2, 78.1, 77.9, 78.0, 77.7, 77.8.

### S17 Budget breakdown (sheet)
"This week's budget" → rows card: Weekly budget 12,600 (7 × 1,800) · Workouts added +0 · Eaten so far (Mon–Fri) 7,780 · Saved from finished days +650 · **Left this week 4,820** (18px) → explanation 13px `--muted` → **Plan a makan day** / "Change makan day" button → "One-off bonus today  + kcal" row.

### S18 Plan a makan day (sheet)
Title → day chips Sat / Sun / Other (`--card` → `--accent` when selected, 15px/700, padding 14px) → room card ("Room on Saturday", "~2,450 kcal", "if today and the other days stay at 1,800") → Confirm → Today, toast "Saving for Saturday".

### S24 Plate builder
Back + "Build your plate" → chips (Place auto-selected "⌖ Kedai near home · Nearby") → Rice card with chips Half / **1 scoop** / 1.5 scoops → hint "Tap a dish to add it, tap again for 2" → groups PROTEIN (ayam goreng 280, ayam masak merah 250 ✓, ikan goreng 200, telur dadar 180) · VEGETABLES (kangkung belacan 90 ✓, kubis goreng 70 ✓, terung sambal 120, taugeh 60) · TOFU AND EGG (tauhu goreng 110, telur rebus 80) → Kuah on rice None / **Some** / Banjir → row "Oil here Medium · remembered" + "RM 9.50" → sticky RangeTotal "670 kcal · likely 570–770" with **Review** → S11 (plate variant).

### S31 Insights
Title + "Week 3 · day 19" → MetricTiles (Last week +350 over plan · Trend −0.4 kg · Complete 6 of 7) → dark CTA card (`--nav`): "Sunday night / Your weekly review is ready ›" → TOP 3 InsightCards → WHERE IT CAME FROM CategoryBars (Rice dishes 38 · Home cooking 18 · **Drinks 17** · Noodles 14 · Snacks and kuih 13) → RECURRING CALORIES rows (Teh tarik ~8 a week ≈ 1,450 · Roti canai ~3 ≈ 900 · Evening biscuits ~5 ≈ 750) → WHEN YOU ATE TimingGrid → UNLOCKS AS YOU LOG (Timing patterns 9 of 14 · Your real maintenance 9 of 21).

### S33 Weekly review
Back + "Your week" + "Step n of 3"; 3-segment progress bar (4px, `--accent` filled / `--line`).
Step 1 card: "6–12 Oct", Budget **+350** (amber) "12,950 of 12,600" · Trend **−0.4 kg** (accent) "on plan" · WeekBars (Sat over = amber, Sun not counted = hatched) · summary line. Button "Next · top 3".
Step 2: the three InsightCards (no footer). Button "Next · pick one thing".
Step 3: "Pick one thing to try next week" 22px/700; three option rows with radio (Kurang manis for drinks / Half rice at nasi kandar / Keep eating days under 12 hours, each with a sub-line); button "Got it, put it on Today" (40% opacity until a pick). Done → Today shows WeeklyFocusCard, toast.

### S36 Meal ideas
Back + "Meal ideas" → context line 15px: "**570 kcal** and ~68g protein left · window closes 10:40pm" → 3 SuggestionCards (Your usual: Ayam bakar, half rice, ulam ~540 / 38g / Medan selera nearby · Lighter swap: Mee sup ayam instead of mee goreng ~430 / 26g / Nasi kandar near home · Something different: 3-egg omelette, sayur, small rice ~510 / 27g / Home) → Surprise me. "Fits" when kcal ≤ left, else "Tight fit". Log this → S11 pre-filled.

### S48 More
Title → active GoalCard (`--card` radius 24: "Active goal · week 3", "Cut · 1,800 a day", "−0.5 kg a week · protein 110g · min 1,400", "Active" badge; saved goals as `--card2` chips "Festive maintain · Saved", "Lean bulk · Draft") → rows: Goals · Places · Usuals · Pots · Weight · Activity · Settings (label 16px/600, sub 12px `--muted`, chevron) → disclaimer 12px `--muted` centred.

---

## Interactions & State

### Navigation
Bottom tabs: today, diary (day | week), insights, more. Log is a sheet over the current tab. Sub-routes without nav: review, plate, ideas, weight, estimating, weekly. Sheets over Today: log, budget, makan, checkin. Back from Review returns to its origin flow (plate → S24, ideas → S36, text/usual → Today).

### State (prototype)
```
screen, weeklyStep (1–3), focus | null, focusPick | null,
checkinDone, checkinChoice | null,
logText, reviewFlow ('text'|'plate'|'usual'|'ideas'), reviewItems[], reviewMeta {place,title,time,name,protein,text},
toast | null, makanDay ('Sat'|'Sun'|'Other'), makanPlanned,
riceIdx, kuahIdx, dishCounts {name: 0|1|2},
weightInput, weightSaved, extraMeals[]
```
Derived: eaten = Σ meals; left = target − eaten; macros Σ; week eaten = Mon–Thu totals + today; left this week = 12,600 − week eaten; today fill % = eaten / target; review total = Σ (selected chip kcal | fixed kcal); range = ±15% rounded to 10; after = left − review total.

### Behaviour rules (from the product plan)
- Logical day rolls over at 5am; a 2am supper counts toward the previous day.
- Weekly budget Mon–Sun = 7 × target + workouts + one-off bonus. Savings only accrue from **complete** finished days. Missed logs never count as savings.
- Over budget is amber information; the shortfall spreads across remaining days, never below the 1,400 daily minimum.
- Every estimate is a range with a source tag. Follow-up questions: max 2 per meal, only if the answer moves the total ≥ 100 kcal.
- Goal switch applies from the next rollover; week budget prorated; stored meals unchanged.
- Timing tags compare against the user's own median for that meal (14–28 complete days); before day 14 insights say "Early read".
- Offline: all logging screens work; show "waiting to sync" icon on rows and "Estimate will run when you're back online" on review items.

### Loading / error
- Estimating: skeleton rows, not a spinner; "Still working…" after 6s; S47 on failure with Try again / Pick from your library / Enter kcal yourself (nothing typed is lost).
- Saves are optimistic with Undo in the toast.

### Accessibility
WCAG AA contrast is met by the token pairs listed (muted text on card ≥ 4.5:1 in both modes). Layouts must survive 130% system text. All tappables ≥ 44px. Colour is always paired with a glyph or label.

---

## Assets
- Font: Bricolage Grotesque via Google Fonts (`https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&display=swap`). Self-host for the PWA.
- Icons: placeholders in the prototype (⌖ ◔ ● ★ ◎ ▣ ↻ ◍ ‹ ›). Replace with one outline icon family (e.g. Lucide or Phosphor) covering: rice, noodles, drinks, kuih, bread, pot, pin, home, stall, camera, plate, clock, moon, sun, scale, workout, goal, insights, backup, offline.
- App icon (from 6a): `--bg` tile, "570"-style hero numeral in `--text` with a two-segment bar under it (accent + accent-soft); dark variant on `#171310`. Produce 192/512 PNG + maskable.
- Photos: user-generated; 52px thumbnails, 16px radius.

## Files
- `Kira Makan.dc.html` — clickable prototype (source of truth for layout and states).
- `Direction Options.dc.html` — exploration board; option 6a is the locked direction.
- `design_handoff.md` — full component and screen brief (C01–C61, S01–S48).
- `personal_food_tracker_product_plan.md` — behaviour, budget maths, data model, build order.

## Change note (vs. the brief)
- **C07 BudgetRing → number + WeekBars.** The ring was replaced by a large figure with this week's bars inside the hero card, so the four goal variants are just different figures and the week is visible at a glance. The ring treatment from earlier rounds can be reinstated if preferred.
- **Log (S09) is a bottom sheet**, not a full screen.
- **Review footer** adds an "after this" line and three-segment bar showing the effect on today before saving.
- **Eating window** on Today is a caption in the hero card ("window closes 10:40pm") rather than a separate timeline strip; the full DayTimeline lives on Diary day and Check-in.
- Thumbnails on every MealRow (Diary photo density: thumbnails on every row).
