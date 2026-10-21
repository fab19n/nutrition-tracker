# Personal Food & Nutrition Tracker
## Personalised Product Plan (v2)

**Last updated:** 19 October 2026
**Status:** Brainstorm complete. Next step: clickable prototype and starter food catalogue (Phase 0).
**What changed from v1:** v1 was a general product plan. v2 rebuilds it around one person's real routine and the decisions made in the brainstorm on 18–19 October 2026. Every decision is listed in [Appendix A](#appendix-a-decision-log).

---

## 1. Summary

A personal, goal-driven food tracker that works like an expense tracker: a calorie budget instead of a money budget, meals instead of transactions, and Places instead of merchants. It is built for Malaysian eating (mamak, hawker, economy rice and home-cooked pots), for someone who doesn't know the calories in their food, works from home on a changing schedule, and weighs themselves most days.

The app:

- estimates calories from a quick sentence, a photo, a plate builder or a saved Usual, and makes every estimate easy to fix;
- runs on a **weekly** calorie budget with room for weekend makan;
- learns your real maintenance calories from your weight trend, and suggests target changes for you to approve;
- adds workout calories back without counting them twice;
- judges meal timing against your own day, not the clock;
- suggests what to eat when you can't decide, based on your own history;
- explains every number and insight with the entries behind it.

### Core principle

**Goals change how the app interprets food. They never change the food records.**

---

## 2. Who It's For

| Fact | What it means for the design |
|---|---|
| Lives in Malaysia; eats mostly at mamak/hawker/kopitiam stalls, economy rice stalls and at home | Malaysian dishes, portions and add-ons are core; Places remember stalls; economy-rice plate builder; home pots |
| Home meals are cooked both by the user and by family | Two home flows: pots you cook, and "home style" dishes that learn from corrections |
| Doesn't know the calories in food | AI estimation is part of the first build, not a later add-on |
| First goal: lose fat | The **Cut** goal shapes the first version |
| Works from home on a flexible schedule; wake and sleep times vary a lot | Timing rules don't depend on the clock |
| Weighs themselves most days; height is only an estimate | The weight trend drives an adaptive maintenance estimate, so the starting formula only needs to be roughly right |
| Wants a weekly budget with room for weekend makan | Weekly budget with savings, a daily minimum and a fresh start each Monday |
| Finds it hard to decide what to eat | "What should I eat?" suggestions from personal history |
| Does workouts and wants them to add calories back | Workout add-back designed so calories aren't counted twice ([section 8](#8-weight-and-exercise)) |

---

## 3. Product Principles

1. **Estimation is the foundation.** Without estimates nothing logged has a useful number, so estimation comes first.
2. **Consistent beats precise.** The adaptive maintenance estimate absorbs a steady estimation bias, so logging every day matters more than perfect numbers.
3. **Goals interpret; records stay unchanged.** Switching goals never rewrites meals or reruns AI.
4. **Your data first.** Your corrections, Places and Usuals take priority over any generic database.
5. **Timing follows your day, not the clock.**
6. **Missed logs never count as savings.**
7. **Every number is explainable.** Ranges instead of fake precision; every insight links to its evidence.
8. **Rules before AI.** Budget maths, insights and suggestions are plain code. AI is used to turn text, photos and recipes into food items.
9. **No moralising.** Foods aren't "good" or "bad"; they fit or don't fit today's budget.
10. **Start simple.** One web app and managed services; no extra infrastructure until a real need appears.

---

## 4. The Expense-Tracker Model

| Expense tracker | This app |
|---|---|
| Budget | Weekly calorie budget (daily target × 7, plus workouts) |
| "Left to spend today" | **Left today**, the big number on the home screen |
| Savings | **Saved this week**: unspent calories from finished days |
| Transaction | Meal entry: what, when, how much, kcal range, optional price |
| Merchant / payee | **Place**: a stall, mamak, home or office that remembers your usual orders |
| Recurring payments | **Usuals** (one-tap meals) |
| Subscriptions audit | **Recurring calories** (e.g. a daily teh tarik ≈ 1,450 kcal a week) |
| Receipt photo | Meal photo, kept as a visual diary |
| Spending by category | Where your calories came from: food categories and Places |
| Monthly statement | **Weekly review** every Sunday night |
| Amount spent | Optional **price (RM)**, giving food spending as a bonus |

---

## 5. App Structure

Bottom navigation: **Today · Diary · + Log · Insights · More**

- **Today:** the main number (chosen by the active goal), macros, today's timeline with the eating window, the meal list with timing tags, this week's focus, and a "Meal ideas" button.
- **Diary:** the ledger. Day-by-day entries with photos, each day's status, edit, duplicate, search (by name, item or Place) and a week view.
- **+ Log:** always one tap away. Opens on a text box, with buttons for Photo, Plate (economy rice), Usuals and Pots. Place and time are pre-filled.
- **Insights:** top 3 insights, where your calories came from, recurring calories, the timing grid, unlock progress and the weekly review.
- **More:** Goals, Places, Pots and recipes, Weight, Workouts, and Settings (budget, day rollover, reminders, backups, export).

---

## 6. Goals

### 6.1 A goal is a saved set of choices

| Setting | Example: Cut |
|---|---|
| Name | Cut |
| Main number on Today | kcal left |
| Budget | Weekly: 1,800 kcal a day (12,600 a week) plus workouts |
| Daily minimum | Set during setup; no day's allowance goes below it |
| Pace | 0.5 kg a week |
| Protein target | e.g. 110 g a day |
| Timing rules | Eating window ≤ 12 h; last meal ≥ 2 h before sleep (when sleep is tapped); flag more than 5 eating occasions a day |
| Insights on | All fat-loss rules |
| Suggestion weights | Budget fit first, protein second |
| End condition (optional) | A target date or weight |
| Version | Every target change creates a new version |

All defaults are editable.

### 6.2 Templates

| Template | Main number | Budget | Timing | Insights and suggestions |
|---|---|---|---|---|
| **Cut** (active first) | kcal left | Maintenance − pace deficit | Window length, late eating, grazing | Budget fit first |
| **Festive maintain** | Days in range | Maintenance ± 10% | Relaxed | For open-house seasons; tracks days in range |
| **Lean bulk** | Protein left | Maintenance + small surplus (e.g. +200 kcal) | Protein spread over 3–5 meals | Protein first |
| **Pause** | None | Off | Off | For travel or sick days; logging is optional and days stay out of trends |

A custom goal can set its own eating window (for example a regular-eating or fasting window), so the template list stays short.

### 6.3 Switching goals

- A switch takes effect at the **next day rollover**, so each day is judged under one goal only.
- **The week's budget is prorated.** Days already done keep the old target and the remaining days get the new one. Example: switching from Cut (1,800) to Festive maintain (2,100) on a Friday gives 4 × 1,800 + 3 × 2,100 = **13,500 kcal** for that week.
- **Every day records the goal version that was active**, so past weeks are judged by the goal that applied at the time. A toggle lets you view any period under the current goal.
- When an end condition is reached, the app suggests switching to a maintain goal, so a cut doesn't run on without a plan.
- Switching never changes stored meals and never reruns AI.

### 6.4 Setting and adjusting the target

**Starting estimate (Mifflin–St Jeor):**

> BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age + 5 (male) or − 161 (female)
>
> Starting maintenance = BMR × activity factor for a **day without workouts** (e.g. 1.2 for "WFH, mostly sitting"; 1.375 for "on my feet a fair bit")

- **An estimated height is fine:** a 5 cm error changes the result by only about 30 kcal a day. Activity level matters far more (around 250–300 kcal between "sedentary" and "lightly active").
- The activity factor must describe a day **without** workouts, because workouts are added separately ([section 8](#8-weight-and-exercise)).
- **Pace:** 0.25 / 0.5 / 0.75 kg a week gives a deficit of 275 / 550 / 825 kcal a day (using ~7,700 kcal per kg).
- **Example:** starting maintenance ~2,350 − 550 = **1,800 kcal a day**.
- The daily target never goes below the daily minimum.

**Adaptive maintenance** (from day 21, recalculated weekly) uses the formula in [section 8.3](#83-maintenance-without-workouts). If the result differs from the current maintenance by more than ~100 kcal a day, a suggestion card shows the new target and how it was worked out (e.g. *"You logged ~1,820 a day and your trend dropped 0.25 kg a week, so maintenance is about 2,100"*), with **Approve** and **Keep current** buttons. Approving creates a new goal version. **The target never changes automatically.**

---

## 7. Weekly Budget

- The week runs **Monday to Sunday**. The daily target stays fixed.
- **Weekly budget** = daily target × 7 + workout calories + any one-off bonus.
- **Left today** = daily target + today's workout calories − eaten today.
- **Saved this week** = the sum of (daily target + workouts − eaten) over finished days.
- Savings can be spent on any day. **Plan a makan day** sets savings aside for a chosen day and shows the room available (e.g. Saturday room = 1,800 + 650 saved = **2,450 kcal**).
- **Overspending:** if savings go negative, the shortfall is spread across the remaining days, but no day's allowance drops below the daily minimum. Anything that can't be absorbed is shown, not carried over.
- **Fresh start every Monday:** no savings or shortfall carry into the next week.
- **Missed logs:** a "not counted" day counts as eating exactly the target (no fake savings); a "guess added" day counts its guess ([section 10](#10-missed-logs)).
- Per-meal budgets (envelopes) are left for later.

---

## 8. Weight and Exercise

### 8.1 Weigh-ins

- Daily weigh-ins are smoothed into a **trend line** (an exponential moving average with roughly 10-day smoothing; tuned at build time).
- The chart shows the trend clearly with the daily readings as faint dots. Water-weight jumps after salty or high-carb weekends (kuah, mamak, extra rice) are expected; the trend and all target suggestions use the trend, never a single reading.

### 8.2 Workouts add calories back

- Log a workout with its **type, duration and intensity** (easy / moderate / hard).
- **Estimate:** net kcal = (MET − 1) × body weight (kg) × hours, with MET values from standard tables (e.g. the Compendium of Physical Activities). Using *net* calories leaves out the resting burn, which maintenance already includes. The app uses its own estimate, not a fitness tracker's number.
- Workout calories are **added to the week's budget** and show up in today's "left" first, so a Tuesday futsal session can also pay for part of Saturday.
- A manual **one-off bonus** covers unusual days (a hike, a tournament).

### 8.3 Maintenance without workouts

To avoid counting workouts twice, the adaptive estimate calculates maintenance **without** workouts:

> maintenance without workouts ≈ average kcal eaten − average workout kcal added + (trend weight lost per day × 7,700)

- It uses only **complete** days from the last 21–28 days.
- **It corrects itself.** If workouts are overestimated by 30%, weight comes off more slowly than expected and this number drifts down by about that amount on average, so totals end up right after about 3 weeks.
- The same mechanism absorbs a steady logging bias (for example, mamak oil being consistently underestimated).

### 8.4 Activity data import

A web app **can't read Health Connect (Android) or Apple Health**. Automatic step and workout import is the main reason to wrap the app as a native app later ([section 17](#17-platform-and-architecture)). Until then, logging a workout manually takes one quick tap.

---

## 9. Logging

### 9.1 Many ways in, one review screen

Every way of logging produces the same thing: a list of items, each with a portion, add-ons, a kcal range and a source tag. That list goes to **one shared review screen**, then into the diary.

| Way in | Best for | AI needed |
|---|---|---|
| Usual | Repeat meals | No |
| Usual order at a Place | Stall regulars | No |
| Plate builder | Economy rice | No (uses the catalogue) |
| Pot serving | Home-cooked pots | No (after the pot is set up) |
| Text | Anything | Small call |
| Photo + caption | Unfamiliar dishes | Larger call |

### 9.2 Text logging

- Type the meal like a message: *"nasi kandar ayam goreng, kubis, kuah campur, teh o ais"*. Local words are understood.
- The review screen shows each item with portion buttons, a best guess and a range (e.g. *"880 kcal, likely 750 to 1,010"*).

### 9.3 Economy-rice plate builder

- **Rice:** half / 1 / 1.5 scoops, or another base (nasi lemak rice, bihun, mee).
- **Tap dishes** from a grouped grid (protein, vegetables, tofu and egg). Tap again for two. Values are "one scoop or piece at a typical stall".
- **Kuah on rice:** none / some / banjir.
- **Oil level** (low / medium / high), remembered for each Place.
- Each Place remembers its own trays, and your most-picked dishes come first.
- Optional price.

### 9.4 Places

- **No setup screen.** A Place is created the first time you type a name into "Where?". Home is a Place too.
- **Each Place learns:** your usual orders (by frequency), a portion-size adjustment (e.g. "rice here is big, +30%"), default add-ons (kuah banjir, teh o ais kurang), oil level and typical price.
- **It only learns from repeats.** Make the same correction twice at one Place and it asks "Make this the default here?" A one-off fix stays one-off.
- **Location:** when you open Log, the app pre-selects the nearest saved Place within ~150 m. It only stores **each Place's own coordinates** (saved once, when you create the Place while there), never a history of where you've been.
- Each Place shows visits, average kcal compared with elsewhere, and spending.

### 9.5 Usuals

- Created from setup ("add your regulars"), from any diary entry ("save as Usual"), or suggested after you've logged the same meal 3 or more times.
- Logged in one tap, with portion and time adjustable on the review screen.

### 9.6 Photo logging

- A photo is just another way in: the AI turns it into items and you land on the same review screen.
- **A photo with a few words** (*"nasi kandar, kuah banjir"*) is encouraged, because the camera can't see oil, the sugar in a drink, or gravy under the rice.
- The AI asks **at most 2 follow-up questions**, and only when the answer would move the total by **100 kcal or more**.
- **"Did you finish it?"** All / most / half.
- **Photos are kept** as a visual diary. They're shrunk on the phone to ~200–300 KB before upload (about 330 MB a year at 3 photos a day).
- Kept photos plus your corrected values form a personal test set for checking AI accuracy ([section 15](#15-ai-estimation)).

### 9.7 Home cooking

**Pots (meals you cook):**

1. Type the recipe the way you'd text it (*"1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak"*). The AI splits it into ingredients, and each is looked up in the catalogue, MyFCD or USDA.
2. **Oil** gets its own buttons, since it's the biggest unknown.
3. Say how many servings the pot made. Example: a kari ayam pot of ~4,030 kcal ÷ 8 servings ≈ **500 kcal a serving**.
4. The pot works like **stock that runs down**: "Log 1 serving" takes one out, the pot shows how many are left, and it clears itself after **4 days**.
5. Recipes are saved, so cooking the same dish again creates a new pot in one tap.

**Home-style dishes (family cooking without a recipe):** log them like a stall dish (*"kari ayam, home style"*) with Place = Home. After a couple of corrections, save it as **your home's version**.

**Home units:** senduk (ladle), scoop, piece, bowl and plate.

### 9.8 Fixing estimates

- **Use your own words, not grams:** sikit / normal / banjir; kosong / kurang / normal; small / normal / mamak big; 1 or 2 pieces. Grams are available under "advanced" for home cooking with a scale.
- **Four fixes per item:** change the portion, swap the item (*"ayam madu, not ayam goreng"*), remove it, or add something missed (*"+ drink"*).
- **How widely a fix applies:** this time only / always at this Place / always for this dish.
- **Entries stay editable after saving.** The original estimate and every correction are kept in the background, so the app can see where it's consistently wrong.

### 9.9 Time, day rollover and price

- Time defaults to now, with quick buttons ("30 min ago", "1 h ago", pick a time). Meals logged later default to your typical time for that meal.
- **Logical day:** the day rolls over at **5am** by default (editable), so a 2am supper counts toward the previous day.
- The meal slot (breakfast, lunch, etc.) is suggested and can be changed.
- **Price (RM)** is optional.

---

## 10. Missed Logs

**Why it matters:** a missing meal looks like eating nothing. With a weekly budget, an unlogged dinner becomes fake savings that get spent on Saturday. It also drags the maintenance estimate down (making the target stricter for no reason) and shows up as fake fasts in timing insights.

### 10.1 Day status

| Status | How it's set | Budget | Maintenance estimate | Timing insights |
|---|---|---|---|---|
| **Complete** | "Yes, that's all I ate" | As logged | Included | Included |
| **Guess added** | "Fill in a typical one": your own average for that meal, marked as a guess | Logged + guess | Excluded | Excluded |
| **Not counted** | "Don't count this day" | Assumes the daily target | Excluded | Excluded |
| **Paused** | Pause goal active | No budget | Excluded | Excluded |
| **Unconfirmed** | Check-in not answered | Overspend counts straight away; any savings are held until the check-in confirms the day | Excluded | Excluded |

### 10.2 Morning check-in

- Appears the **first time you open the app after the day rollover**, not at a fixed clock time.
- Shows yesterday's timeline and total, and points out unusual gaps (*"Nothing logged for 10 hours after 3:40pm. You usually have dinner around 9pm."*).
- Four answers: *that's all*, *fill in a typical one*, *let me add it* (opens Log with the time set to last night), *don't count this day*.

### 10.3 Reminders

- **Days 1–14:** morning check-in only.
- **From about day 14: gap nudges** based on your own pattern (*"6 hours since your last log, and you usually eat by now."*).
- **Quiet hours** come from your "Going to sleep" taps and your usual overnight gap, so there are no 2am pings.
- Delivered as web push notifications (Android; iPhone from iOS 16.4 for apps added to the home screen).

---

## 11. Meal Timing

- **Logical day:** measured from the day rollover, not midnight ([section 9.9](#99-time-day-rollover-and-price)).
- **What's measured:** first meal, last meal, **eating window length** (first bite to last bite), number of **eating occasions**, gaps between meals, **drift** of the first meal across the week, and the gap from last meal to sleep (only on days you tap "Going to sleep").
- **Two lenses:**
  - **Against the goal's rules:** e.g. "outside your 12-hour window".
  - **Against your own rhythm:** e.g. "3:40pm lunch is late for you", based on the median and spread for that meal over the last 14–28 complete days.
- **Entry tags:** On time, Late for you, Outside window.
- **Cut defaults:** eating window ≤ 12 h; last meal ≥ 2 h before sleep; flag more than 5 eating occasions a day (grazing at home). All editable.
- Timing insights unlock at day 14; anything earlier is labelled "Early read".
- **No medical claims.** Insights state facts and patterns with an optional interpretation. A missing log never counts as fasting.

---

## 12. "What Should I Eat?"

- **Where:** a "Meal ideas" button on Today and inside Log.
- **Inputs:** the time and meal slot; left today and saved this week; today's protein gap; your history (what you usually eat at this meal, and where); the goal's timing rules (e.g. a 12-hour window that opened at 10:40am closes at 10:40pm); variety (days since you last had something); the nearest Place.
- **Output:** **3 picks with different jobs**, plus **Surprise me**:
  1. **Your usual:** a familiar choice that fits.
  2. **Lighter swap:** a lighter version of something you like (e.g. mee sup ayam instead of mee goreng).
  3. **Something different:** something you haven't had in a while, often a home option.

  Each pick shows kcal, protein, a "fits" badge, the reason, and a **Log this** button.
- **Scoring (plain code):** score = budget fit + protein fit + familiarity + variety + timing fit + nearby bonus − recently ignored. The goal sets the weights (Cut: budget fit first; Lean bulk: protein first).
- **Lighter swaps** come from links in the catalogue (the same dish with fewer add-ons, or related dishes). AI can propose new swaps later, and they're added to the catalogue once you accept them.
- **Learning:** the app records which picks you take and which you ignore.
- **Before you have history:** uses the regulars entered at setup plus the starter catalogue.
- **Tone:** "fits" or "doesn't fit today". No food is labelled bad.

---

## 13. Insights

### 13.1 Layout of the Insights tab

1. **This week:** budget versus plan, weight trend change, number of complete days.
2. **Top 3 insights**, ranked by kcal per week × confidence.
3. **Where it came from:** by food category and by Place (kcal and RM).
4. **Recurring calories:** small things you have often (e.g. teh tarik ~8 a week ≈ 1,450 kcal).
5. **When you ate:** the weekly timing grid and average eating window.
6. **Unlock progress:** e.g. "Timing patterns: 9 of 14 days".

### 13.2 How each insight works

- **Fact → evidence → one thing to try** (e.g. *"Drinks were 17% of your calories → see 11 drinks → try kurang manis for half of them, about 300 kcal a week less"*).
- An insight based on thin data is labelled **"Early read"**.
- **Useful / Not for me** buttons. "Not for me" pauses that insight for about 4 weeks.
- **Written by fixed rules, not AI.** Each rule has a minimum amount of data, a calculation, a kcal-per-week impact, a confidence level, a sentence template and an evidence query. AI may polish the wording later if the templates feel stiff.

### 13.3 Unlock schedule

| When | What unlocks |
|---|---|
| **Day 1** | Budget, where your calories came from, biggest meals |
| **Day 7** | Recurring calories, weekday vs weekend, first weekly review |
| **Day 14** | Timing patterns, protein per meal, eating-window length vs calories, review of your top 30 dishes |
| **Day 21** | Real maintenance estimate and a suggested target to approve |

### 13.4 Starting insight rules

| Rule | Minimum data | Example |
|---|---|---|
| Category share | 7 days | "Drinks were 17% of your calories" |
| Place comparison | 2+ visits | "Nasi kandar nights average 950 kcal vs 640 elsewhere" |
| Recurring calories | 7 days | "Teh tarik ~8 a week ≈ 1,450 kcal" |
| Weekday vs weekend | 7 days | "Weekends averaged 600 kcal more a day" |
| Protein gaps | 7 days | "Protein target reached on 2 of 7 days; breakfast is lowest" |
| Budget result | 7 days | "Week finished 350 kcal over plan" |
| Eating window vs calories | 14 days | "Days over 13 hours averaged +350 kcal" |
| First-meal drift | 14 days | "Your first meal moved 3 hours later this week" |
| Grazing | 14 days | "3 snacks between 3pm and 6pm on most workdays" |
| Late eating | 14 days with sleep taps | "Last meal was within 2 hours of sleep on 4 nights" |
| Weight trend vs plan | 21 days | "Losing 0.3 kg a week vs 0.5 planned" |
| Maintenance estimate | 21 days | "Maintenance is about 2,100, not 2,350" |

### 13.5 Weekly review

- Appears **Sunday night** when the budget week closes. Insights also stay visible on the tab all week (feed + weekly review).
- Shows the budget result, weight trend, top 3 insights, and **"Pick one thing to try next week"**.
- The choice appears on Today as **this week's focus**, and the next review reports how it went (*"kurang manis on 5 of 8 drinks"*).
- The **day-7 review** is special: "what we learned about you" (usual times, top Places, top foods), not a report card.

---

## 14. Food Data

### 14.1 Four layers, checked in order

| Layer | Source | What it's for | Notes |
|---|---|---|---|
| **1. Your library** | Your corrections, Places, Usuals, pots and home versions | Anything you've eaten before | Always takes priority; grows every week |
| **2. Starter catalogue** | ~150–200 entries written once ([14.3](#143-starter-catalogue)) | Coverage from day one | Every entry has low / typical / high values and a source tag |
| **3. Reference tables** | MyFCD (Malaysia), SG FoodID (Singapore HPB), USDA FoodData Central | Checking catalogue values; home-cooking ingredients | Check reuse terms before copying values in bulk |
| **4. AI fallback** | Claude estimates the components | Anything not covered above | Marked "AI guess"; moves to layer 1 once confirmed or corrected |

Later: barcode scanning of packaged food via Open Food Facts.

### 14.2 How food is stored

- **Base + add-ons + portion.** Teh tarik is one base, with add-ons (kurang manis, kosong) and portion sizes (cup, tarik besar). Nasi lemak is a base with add-ons (ayam goreng, telur, extra sambal). This keeps the catalogue small and matches the review-screen buttons exactly.
- **Portion dictionary:** what a scoop, piece, plate, cup, senduk or "mamak big" means in grams. Reference tables give values per 100 g; this dictionary is what turns them into how you actually eat, and no database provides it.
- **Ranges:** every value is stored as low / typical / high, and ranges add up to the meal's range.
- **Source tag on every value:** Your correction / Catalogue / MyFCD / SG FoodID / USDA / AI guess.

### 14.3 Starter catalogue

- Claude drafts **~150–200 entries**: the mamak menu (roti, nasi kandar parts, mee goreng and so on), economy-rice tray dishes per scoop or piece, nasi lemak variants, hawker noodles and soups, kuih, drinks by sugar level and size, and common home dishes per senduk.
- Each entry has portion units, ranges, add-ons, a source and a note.
- Stored as a seed data file in the project and loaded during setup.
- **Day 14:** the app lists the ~30 dishes you log most for a one-time check.

### 14.4 Sources and cautions

- **[MyFCD](https://myfcd.moh.gov.my/)** (Ministry of Health / Institute for Medical Research): 668 prepared foods plus 441 raw and processed foods. During research in October 2026, some pages on the site reportedly showed unrelated spam links, so use it as a reference to read and cross-check manually, not a source to scrape. Check its terms before copying values.
- **[SG FoodID](https://www.hpb.gov.sg/healthy-living/food-and-beverage/sgfoodid/)** (Singapore Health Promotion Board; formerly FOCOS): covers many hawker dishes Malaysia shares. Check its terms of use before copying values in bulk.
- **[ASEAN Food Composition Tables](https://inmu.mahidol.ac.th/aseanfoods/composition_data.html)** (INMU, Mahidol University): last updated 2014 and intended for analysing groups of people, so a backup only.
- **[USDA FoodData Central](https://fdc.nal.usda.gov/)**: public domain; used for generic ingredients in home cooking.
- **Open Food Facts** (later, for barcodes): check its database licence's share-alike terms.

---

## 15. AI Estimation

### 15.1 Workflow

1. **Input:** text, a photo with an optional caption, or a recipe.
2. **AI (server-side) returns structured items:** a catalogue match (or "unknown" with a description), portion and unit, add-ons, confidence, and any follow-up question worth asking.
3. **Plain code calculates** calories, macros and ranges from the library and catalogue.
4. **Unknown items:** the AI estimates their components, marked "AI guess". Once you confirm or correct them, they're saved to your library.
5. **Review and save:** the original estimate and the final values are both stored.

### 15.2 Rules

- Estimates are always ranges, never presented as exact measurements.
- At most 2 follow-up questions, and only when the answer moves the total by 100 kcal or more.
- A photo can't reveal hidden oil, sugar, or gravy soaked into rice, so the review screen always asks about the big unknowns through buttons.

### 15.3 What is sent to the AI

- **Sent:** the meal text or photo, relevant catalogue candidates, and the Place's defaults.
- **Not sent:** your name, body stats or weight.

### 15.4 Model and evaluation

- A current vision-capable **Claude model via the Claude API**, called only from a server function. Pick the exact model and check pricing at build time using the current documentation.
- **Personal test set:** kept photos plus your corrected values. Measure error by dish type and portion size, and test any new model or prompt against this set before switching.

---

## 16. Setup and the First 3 Weeks

### 16.1 Setup (about 2 minutes)

1. Age, sex, height (an estimate is fine), today's weight.
2. Activity on a day **without** workouts.
3. Goal (Cut), pace (default 0.5 kg a week) and daily minimum. The app shows the resulting daily target.
4. **Add your regulars:** your usual breakfasts and lunches become Usuals straight away, so suggestions work on day one.
5. **Your 2–3 main Places** (Home, your mamak, your economy-rice stall).
6. Day rollover (default 5am) and week start (Monday).

Permissions are asked only when first needed: location (first time you open Log), notifications (around day 14, or when you turn on reminders) and Google Drive (when you turn on photo backup, a later step).

### 16.2 The first 3 weeks

| When | What happens |
|---|---|
| **Day 1** | Log everything, even roughly. The budget shows, but insights stay quiet |
| **Day 7** | First review: your usual times, Places and top foods |
| **Day 14** | Timing insights and gap nudges switch on; check your top 30 dishes |
| **Day 21** | Real maintenance estimate and a suggested target to approve |

---

## 17. Platform and Architecture

### 17.1 Recommendation: an installable web app (PWA)

- Built for one user, works on Android or iPhone, needs no app store and no developer account.
- Updates show up instantly, and the camera works through photo upload.
- It's the fastest option to keep improving.
- **Go native later** (by wrapping the same app, e.g. with Capacitor) only if you need Health Connect or Apple Health data, more reliable notifications, or home-screen widgets.

### 17.2 Proposed stack

| Part | Choice | Why |
|---|---|---|
| App | React + TypeScript, built with Vite as an installable PWA | One codebase; any phone; instant updates |
| Offline | Local database in the browser (IndexedDB) with a sync queue | Logging at stalls with bad signal |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions, scheduled jobs | Managed; relational data; row-level security |
| AI | Claude API, called only from an Edge Function | The API key never sits on the phone |
| Notifications | Web Push sent by scheduled jobs | Gap nudges and the weekly review |
| Backups | The synced account copy, plus an export file you keep and can restore from (Google Drive is for photos, later) | A copy outside the main provider |

### 17.3 Scheduled jobs

| Job | When |
|---|---|
| Gap nudges | Every ~30 minutes |
| Weekly review | Sunday night |
| Maintenance recalculation | Weekly |
| Backup file nudge | In the app, once a full backup is over 30 days old (no scheduled job; Google Drive is for photos, later) |
| Expire old pots | Daily |

### 17.4 Time handling

- Store timestamps in UTC together with the time zone.
- Work out the logical day from the rollover time.
- Calculate every summary by logical day, so meals near midnight land on the right day.

### 17.5 Architecture principle

Start with one modular app and managed services. Don't add microservices, Kubernetes, load balancers or complex event-driven infrastructure until a measured need justifies them.

---

## 18. Data Model

| Table | What it holds |
|---|---|
| `profiles` | Age, sex, height, activity without workouts, time zone, rollover time, week start, daily minimum, preferences |
| `goals` | Saved goal definitions (template, main number, timing rules, insight and suggestion settings, end condition) |
| `goal_versions` | Target values over time (kcal, protein, pace); a new row for every approved change |
| `goal_periods` | Which goal and version was active, and from when |
| `catalogue_items` | Base dishes and ingredients: nutrients per portion unit, ranges, add-ons, source tag, swap links |
| `portion_units` | The portion dictionary: scoop, piece, plate, cup, senduk and their gram values |
| `personal_items` | Your library: corrected versions with their scope (once / Place / dish) |
| `places` | Name, type, optional coordinates, portion adjustment, default add-ons, oil level, typical price |
| `meal_logs` | Time, logical day, meal slot, Place, price, photo, way logged |
| `meal_log_items` | Item reference, portion, add-ons, **nutrient snapshot**, range, source, original estimate, corrections |
| `usuals` | One-tap saved meals |
| `pots` / `pot_ingredients` | Recipe, ingredients, total nutrients, servings, servings left, cooked and expiry dates |
| `workouts` | Type, duration, intensity, net kcal estimate |
| `weight_logs` | Weigh-ins (the trend is calculated from these) |
| `day_status` | Logical day, status (complete / guess / not counted / paused / unconfirmed), sleep taps |
| `insight_records` | Rule, evidence entries, impact, confidence, feedback (useful / not for me), when shown |
| `weekly_reviews` | Week summary, chosen focus and how it went |
| `suggestion_events` | Picks shown, taken or ignored |
| `backup_runs` | Backup history and results |

### Data rules

1. **Save a nutrition snapshot with every entry.** If a catalogue value changes later, old meals keep the values they were logged with.
2. **Keep goal settings separate from goal history.** Versions and periods mean switching or adjusting a goal never rewrites the past.
3. **Keep estimates auditable.** Store the original estimate, follow-up answers, corrections and final values.
4. **Use the logical day everywhere.** Every summary uses the rollover-based day.
5. **Day status controls what counts.** Budget, maintenance and timing insights follow the table in [section 10.1](#101-day-status).
6. **Keep workouts separate.** Workout calories add to the budget but are subtracted when calculating maintenance without workouts.

---

## 19. Privacy, Backups and Export

- **Sign-in:** just you, with an email sign-in link. You stay signed in.
- **Changing phones:** sign in on the new phone and everything is there.
- **Offline:** logging works without signal and syncs when you're back online.
- **Export:** a **JSON** file (complete, and can be imported back in) plus **CSV** files (meals, items, weights, workouts) for a spreadsheet. Photos are exported separately as a zip.
- **Backups:** the data is backed up by the synced copy in your account and by the export file. **More → Settings → Backups → Export now** saves a complete JSON file (no photos), and **Restore from a backup file** reads it back, on that screen or on the welcome screen of a fresh install, after showing what is in it; a restore replaces everything on the device (and, on a device that syncs, the account's copy too, which asks for a typed confirm). A quiet nudge appears once a full backup is over 30 days old. **Google Drive is for meal photos, as a later step** (the `drive.file` scope: only the files the app creates, never the whole Drive); there is no scheduled Drive backup of the data. This supersedes the weekly Google Drive backup of earlier drafts.
- **Privacy:** row-level security on all tables; only meal text and photos go to the AI; no third-party analytics; a **"delete everything"** button.
- **Not medical advice.** Estimates are approximate, the app doesn't diagnose anything, and timing insights don't claim that meal times alone cause weight gain.

---

## 20. Build Order

The main change from v1: **AI estimation moves into Phase 1**, because without estimates nothing logged has a useful number. Start using the app daily from Phase 1, so that real data has built up by the time insights and suggestions are built.

### Phase 0: Prototype and catalogue

- Clickable prototype of Today, Log and the review screen, the plate builder and Insights, using sample data.
- Draft the starter catalogue (~150–200 entries) and the portion dictionary.
- **Done when:** you can tap through a pretend day, and the catalogue covers your regulars.

### Phase 1: Log and see (usable from day one)

- Supabase project, sign-in, and the data model, including goal versions, logical day and day status.
- Setup: formula, pace, daily minimum, regulars, main Places.
- The Cut goal, weekly budget and the Today screen.
- Text logging → AI → review screen → diary; fixing estimates; time buttons.
- Weight logging and trend line.
- Morning check-in and day status.
- Manual export (JSON and CSV).
- **Done when:** a full day of real meals can be logged, and "left today" and "saved this week" are correct.

### Phase 2: Faster logging

- Places (with location pre-select), Usuals, and learning from repeated corrections.
- Economy-rice plate builder.
- Photo logging (photos kept).
- Pots and home-style dishes.
- Workouts with calorie add-back.
- Optional price.
- **Done when:** a repeat meal takes under 15 seconds and an economy-rice plate under 30.

### Phase 3: Timing and insights (after ~2 weeks of real logs)

- Timing measures, entry tags and the timing grid.
- Insight rules, top 3, evidence links and feedback buttons.
- Weekly review and this week's focus.
- Unlock progress and the day-14 top-dishes check.
- **Done when:** every insight opens its evidence and the Sunday review works.

### Phase 4: Suggestions, adaptive target, reminders and backups

- "What should I eat?" with 3 picks and Surprise me.
- Adaptive maintenance with the approve card.
- Gap nudges via web push.
- Backups screen: the export file with a monthly nudge, and restore from a file (the data backup is the synced copy plus that file; the weekly Google Drive backup of earlier drafts is superseded, and Drive is for photos, later).
- **Done when:** suggestions fit the budget, and a target suggestion shows its working.

### Phase 5: More goals and polish

- Festive maintain, Lean bulk and Pause templates; switching with a prorated week; viewing history under another goal.
- More robust offline sync and error handling.
- **Done when:** switching goals mid-week leaves meals unchanged and the week's budget is correct.

---

## 21. Scope

### Must have (Phases 0–3)

- Text logging with AI estimates, one review screen, easy fixes and ranges.
- Cut goal with a calculated target, weekly budget and daily minimum.
- Weigh-ins with a trend line; workouts with add-back.
- Places, Usuals, plate builder, photos, pots and home-style dishes.
- Day status, morning check-in and export.
- Timing measures, rule-based insights and the weekly review.

### Next (Phases 4–5)

- Suggestions, adaptive maintenance, gap nudges, backups (the export file and restore; Google Drive is for photos, later).
- Festive maintain, Lean bulk and Pause goals with switching.

### Later

- Barcode scanning (Open Food Facts).
- Native wrapper for Health Connect / Apple Health.
- Per-meal budgets (envelopes).
- AI-polished insight wording and AI-proposed swaps.
- Monthly photo backup zip.
- Fibre, sodium and micronutrients where data is reliable.

### Don't build

- Social feeds and public profiles.
- Meal-delivery integrations.
- A recipe marketplace.
- Gamification beyond counting complete days.
- Automatic target changes without approval.
- Multi-service infrastructure for hypothetical scale.

---

## 22. Success Measures

| Measure | Target |
|---|---|
| Repeat meal (Usual) | Logged in under 15 seconds |
| New mamak meal by text | Under 30 seconds, including review |
| Economy-rice plate | Under 30 seconds |
| Complete days | At least 6 of 7 a week for the first 4 weeks |
| Totals reconcile | Daily and weekly totals equal the sum of entries; budget maths is visible |
| Goal switching | Stored meals unchanged; prorated budget correct |
| Insight traceability | Every insight opens its evidence |
| Estimate accuracy | Tracked by dish type on the personal photo test set |
| Maintenance estimate | Settles (changes under ~100 kcal a week) after week 4 |
| Retention | Still logging after 8 weeks |

---

## 23. Cost and Operations

- AI is only called for text, photos and recipes containing **new** foods. Usuals, Place orders, the plate builder and pot servings need none.
- Cache AI results for repeated identical text.
- Insights, suggestions, budget and timing are plain code with no AI cost.
- Never rerun AI when switching goals.
- Track AI cost per logged meal.
- Photo storage is ~330 MB a year at 3 photos a day; check the Supabase plan limits for storage, scheduled jobs and backups.
- API keys stay on the server.

---

## 24. Open Items for Build Time

- Pick the exact Claude model and check current pricing in the documentation.
- Confirm defaults: daily minimum, protein target, trend smoothing, timing rule thresholds.
- Which workouts you usually do, so the MET table covers them.
- Check MyFCD and SG FoodID terms of use before copying values.
- Choose a Supabase plan (storage, scheduled jobs, backups).
- Later, with the Drive photo sync: set up the Google OAuth app. Google apps left in "Testing" status issue refresh tokens that expire after about 7 days, which would break a scheduled copy; publishing the app with only the `drive.file` scope should avoid this. Verify during setup. (The weekly Drive backup of the data this was first for is superseded by the synced copy and the export file.)

---

## Appendix A: Decision Log

Decisions made in the brainstorm on 18–19 October 2026.

| Area | Decision | Why |
|---|---|---|
| First goal | Cut (fat loss) | The user's priority |
| Platform | Installable web app (PWA); native wrapper only if needed | One user, any phone, no app store, fastest to improve |
| Estimation | AI estimation in Phase 1 | The user doesn't know calories |
| Calorie target | Calculated (Mifflin–St Jeor), then adaptive from day 21 | Weighs most days; estimated height is fine |
| Target changes | Suggested with working shown; user approves | Control and transparency |
| Budget | Weekly, Mon–Sun, with savings, daily minimum and a fresh start each week | Room for weekend makan |
| Weight | Daily weigh-ins shown as a trend | Water swings after salty weekends |
| Exercise | Adds net calories back; maintenance calculated without workouts | User's choice; avoids double counting |
| Timing | Not tied to the clock; 5am rollover; optional sleep tap | Wake and sleep times vary a lot |
| Logging | Many ways in, one review screen | Consistency and lower AI cost |
| Economy rice | Plate builder | A regular meal type |
| Places | Created on the fly; learn from repeated corrections | Mamak and hawker regulars |
| Location | Used when opening Log; only Place coordinates stored | Convenience without tracking |
| Price | Optional RM field | Expense-tracker bonus and estimate check |
| Photos | Kept, compressed | Visual diary and personal test set |
| Home cooking | Both pots and home-style dishes | The user and family both cook |
| Missed logs | Day status, morning check-in, gap nudges from day 14 | No fake savings or fake fasts |
| Reminders | Gap nudges plus morning check-in | User's choice |
| Suggestions | 3 picks with different jobs; plain-code scoring | Hard to decide what to eat |
| Insights | Feed plus Sunday review; top 3; numbers plus one suggestion; rule-based | User's choice |
| Food data | Four layers; Claude drafts the catalogue; user checks the top 30 dishes | No open Malaysian dish dataset exists |
| Goal templates | Cut, Festive maintain, Lean bulk, Pause | User's choice |
| Backups | The synced account copy, plus a manual export file you can restore from (Google Drive is for photos, later) | A copy outside the main provider |

---

## Appendix B: Reference Apps

Features and availability change; check current offerings before relying on them.

| App | What to learn from it |
|---|---|
| [Nibbs](https://www.nibbs.io/) | Malaysian/Asian food recognition, mixed-plate estimation, portion correction |
| [SiFit](https://sifit.app/) | Malaysia-focused AI food scanning and local context |
| [Cronometer](https://cronometer.com/) | Nutrient detail and transparent data sources |
| [MacroFactor](https://macrofactorapp.com/) | Adaptive maintenance from logged intake and weight trend |
| [MyFitnessPal](https://www.myfitnesspal.com/) | Standard diary patterns and fast repeat logging |

---

## Appendix C: Sources

- [MyFCD: Malaysian Food Composition Database](https://myfcd.moh.gov.my/)
- [MyFCD: History of the database](https://myfcd.moh.gov.my/index.php/about-us/history-of-food-composition-database.html)
- [HPB: SG FoodID](https://www.hpb.gov.sg/healthy-living/food-and-beverage/sgfoodid/)
- [INMU: Electronic ASEAN Food Composition Database](https://inmu.mahidol.ac.th/aseanfoods/composition_data.html)
- [USDA FoodData Central](https://fdc.nal.usda.gov/)
