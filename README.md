# Kira Makan

A personal, goal-driven calorie tracker that works like an expense tracker: a weekly calorie budget that savings and makan days move around, Malaysian food (mamak, economy rice, home cooking) estimated as honest ranges, and a short morning check-in. It's a local-first PWA: your data lives on your phone, it works offline and needs no account. Signing in adds two optional extras: a synced copy of your diary in your own Supabase project, so a laptop can restore it and stay in step, and AI estimates through a Supabase Edge Function that calls Claude.

## Run it locally

Needs Node.js 20.19 or later (developed on Node 24).

```
npm install
npm run dev
```

Open <http://localhost:5173> and tap **Explore with sample data** to load the demo week (the clock is pinned to Fri 16 Oct 2026, 7:10pm), or **Get started** to run setup. Leave the demo later from **More → Settings**.

AI estimates are off until you add an Anthropic API key: copy `.env.example` to `.env.local`, set `ANTHROPIC_API_KEY` and `VITE_ESTIMATE_URL=/api/estimate`, and restart `npm run dev`. The dev server then answers `/api/estimate` itself. [DEPLOY.md](DEPLOY.md) part 2 walks through it.

## Tests and checks

```
npm test              # Vitest, once
npm run test:watch    # Vitest, watching
npm run typecheck     # type-check the whole project
npm run build         # typecheck, then the production build in dist/
npm run preview       # serve dist/ locally
```

`npm run build:estimate-catalogue` regenerates the food catalogue the Edge Function bundles; run it whenever `src/data` changes.

## Docs

| Read | For |
|---|---|
| [personal_food_tracker_product_plan.md](personal_food_tracker_product_plan.md) | What the app does and why: behaviour, maths, data rules |
| [design_handoff.md](design_handoff.md) | Every component and screen, with all their states |
| [design/](design/) | The final visual design: [design/README.md](design/README.md) (tokens, sizes) and the prototype |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the code is built: stack, layout, contracts, conventions, decisions |
| [DEPLOY.md](DEPLOY.md) | Putting it on your phone: Vercel, Supabase sign-in and sync, the AI estimate function, a second device, costs, troubleshooting |

## Stack

React 19, TypeScript, Vite and vite-plugin-pwa; Dexie (IndexedDB) for local data, synced two ways with your Supabase Postgres database through the functions in `supabase/sync.sql` (`src/sync`); Zustand for UI state; react-router. Sign-in for sync and AI estimates uses Supabase Auth with email and password (no email is sent); the estimate function (`supabase/functions/estimate`) runs on Supabase Edge Functions and calls the Claude API with the key it keeps as a secret.
