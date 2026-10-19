# Deploying Kira Makan

This guide takes Kira Makan from your PC to your phone:

- **Vercel** hosts the app as static files, built from your GitHub repo.
- **Supabase** runs the email sign-in and the `estimate` Edge Function, which holds your Anthropic API key as a secret.
- **Anthropic** (Claude) reads typed meals and photos the offline catalogue can't.

```
Phone (installed app from Vercel)
  ├─ everything else: on the phone only (IndexedDB), works offline, no account
  └─ AI estimate ──► Supabase Edge Function "estimate" ──► Claude API
                       checks: signed-in user, email on ALLOWED_EMAILS, web origin on ALLOWED_ORIGIN
```

Sign-in exists only to protect the AI function. The app works fully without an account; only AI estimates need you to sign in. Sign-in is a 6-digit code by email rather than a link, because an emailed link opens Safari instead of the installed iPhone app. New sign-ups are blocked: only the account you create yourself can sign in.

Plan on about 45 minutes. Steps are numbered straight through, so the troubleshooting table can point back at them.

## Before you start

- Node.js 20.19 or later (`node --version`; this project is developed on Node 24), Git, and this repo pushed to GitHub.
- A Vercel account connected to GitHub, a Supabase account (the free plan is enough) and an Anthropic Console account.
- The email address you'll sign in with on the phone. Use the one you sign in to Supabase with, so the codes arrive without extra setup (see step 18).

Run every command from the project folder, `C:\GitHub\nutrition-tracker`, in PowerShell or Git Bash. Commands are the same in both unless a step says otherwise.

> If PowerShell answers `npx` with "running scripts is disabled on this system", use Git Bash instead, or type `npx.cmd` wherever this guide says `npx`.

Dashboards change their wording now and then. Where a label might differ, the step says what to look for instead.

---

## Part 1 · Anthropic API key, credit and spend limit

1. Go to [platform.claude.com](https://platform.claude.com) and sign in, or create an account.
2. Add credit. Open [Billing](https://platform.claude.com/settings/billing) (`platform.claude.com/settings/billing`), add a payment method and buy a small amount of credit; US$5–10 lasts months for one person (see [Costs](#costs)). If the label differs, look for **Buy credits** or **Add credits**. Leave automatic reload off, so the credit you bought is the most you can spend.
3. Set a monthly spend limit. On the same Billing page, in **Spend limits**, click **Set limit** (or **Adjust limit**), enter `10` and save. When usage reaches it, AI estimates stop until next month and the app falls back to offline estimates.
4. Create the key. Open [API keys](https://platform.claude.com/settings/keys) (`platform.claude.com/settings/keys`), click **Create key**, name it `kira-makan`, pick an expiration (with an expiring key you'll repeat step 27 when it runs out) and set **Linked account** to yourself. Copy the key (it starts with `sk-ant-`): the Console shows it only once. Keep it in your password manager.

The key goes in exactly two places: `.env.local` on your PC (part 2) and the Supabase secrets (part 5). Never in a `VITE_` variable, on Vercel, or in a commit.

## Part 2 · Try AI estimates locally

5. Install dependencies:

   ```
   npm install
   ```

6. Create `.env.local` from the example:

   ```
   # PowerShell
   Copy-Item .env.example .env.local
   # Git Bash
   cp .env.example .env.local
   ```

   Open it (`notepad .env.local` or `code .env.local`) and set these two lines, leaving `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` empty for now:

   ```
   VITE_ESTIMATE_URL=/api/estimate
   ANTHROPIC_API_KEY=sk-ant-...your key...
   ```

   `.env.local` is git-ignored and stays on your PC. With the Supabase lines empty, the dev server answers `/api/estimate` itself, without sign-in.

7. Start the app:

   ```
   npm run dev
   ```

   Open <http://localhost:5173>.

8. Tap **Explore with sample data**. Go to **More → Settings → AI estimates**: the note reads "AI estimates run through the dev server." Pick **Always** for this test.
9. Tap the round **Log** button in the middle of the bottom bar, type `nasi goreng kampung, teh o ais limau` and tap **Estimate**. The terminal running `npm run dev` prints a line starting with `[estimate]` with the item count and token counts: the AI answered.
10. Set **AI estimates** back to **When needed**, then stop the dev server with Ctrl+C.

## Part 3 · Supabase project and sign-in

11. Open the [Supabase dashboard](https://supabase.com/dashboard) and click **New project**. Name it `kira-makan`, generate a database password and save it in your password manager (the app doesn't use the database, but Supabase asks for one), and set **Region** to **Southeast Asia (Singapore)**. Create the project and wait a minute or two until it's ready.
12. Note the **project ref**: the part after `/project/` in the dashboard's address bar, for example `abcdefghijklmnopqrst`. Your project URL is `https://<project-ref>.supabase.co`. (The **Connect** button at the top of the dashboard shows the URL too.)
13. Copy the public key. Go to **Settings → API Keys** and copy the **Publishable key** (`sb_publishable_...`). If your project shows only legacy keys, copy the **anon** key (a long `eyJ...` key) instead. Both are public by design; never copy a secret or `service_role` key into the app.
14. Add yourself as the only user. Go to **Authentication → Users**, click **Add user → Create new user**, enter your email and a long random password (the app never uses it; sign-in is by code) and tick **Auto Confirm User**. Create the user. If the labels differ, look for the option that creates a user directly rather than sending an invitation. An unconfirmed user gets a sign-up confirmation email instead of a code, so the tick matters.
15. Check the email settings. Go to **Authentication → Sign In / Providers** and open **Email**. Make sure it's enabled, and that **Email OTP Length** is `6`: the app takes exactly 6 digits. **Email OTP Expiration** can stay at the default of 3600 seconds. Save. If the label differs, look for the code length in the Email provider settings.
16. Block new sign-ups. On the same page, turn off **Allow new users to sign up** and save. If the label differs, look for **Enable sign ups** or **User Signups**. Leave anonymous sign-ins off. Existing users (you) can still sign in.
17. Make the email show a code. Go to **Authentication → Emails** (or **Email Templates**) and open the **Magic link** template (the docs call it "Magic link or OTP"). Set the subject to `Your Kira Makan code` and replace the body with:

    ```html
    <h2>Your Kira Makan sign-in code</h2>
    <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
    <p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
    ```

    Make sure `{{ .ConfirmationURL }}` is gone, so the email has no link. Save.

18. Check email delivery. Supabase's built-in email service only sends to members of your Supabase organisation's team, and only about 2 emails an hour. If you sign in with the email you use for Supabase, that's enough for one person. For any other address, add it to the team (the organisation's settings, **Team** tab), or set up your own email provider in the Authentication settings (look for **SMTP Settings**); with custom SMTP you can also raise the email limit in the Authentication **Rate Limits** settings.

## Part 4 · Vercel

19. Make sure the latest code, including `vercel.json` at the repo root, is pushed to GitHub. Never commit `.env.local`.
20. Go to [vercel.com/new](https://vercel.com/new). Under **Import Git Repository**, pick your repo and click **Import**. If the repo isn't listed, use the option to adjust the GitHub app's permissions and give Vercel access to it.
21. On **Configure Project**:
    - **Project Name**: `kira-makan`. The production address becomes `https://kira-makan.vercel.app` when that name is free; otherwise Vercel adds a suffix.
    - **Framework Preset**: Vite. `vercel.json` also sets it, along with the build command (`npm run build`) and output directory (`dist`), so leave **Build and Output Settings** as they are.
    - **Root Directory**: the repo root (`./`).
    - **Environment Variables**: add two variables for all environments:

      | Name | Value |
      |---|---|
      | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` (step 12, no trailing slash) |
      | `VITE_SUPABASE_KEY` | the publishable or anon key from step 13 |

      If Vercel asks for a type, **Config** is fine: both values are public. Don't add `VITE_ESTIMATE_URL`; the app derives `https://<project-ref>.supabase.co/functions/v1/estimate` itself. Never add `ANTHROPIC_API_KEY` to Vercel.
22. Click **Deploy** and wait for the build to finish. Open the project's **Domains** (or the production deployment) and note the production address, for example `https://kira-makan.vercel.app`. Use this exact origin, with no trailing slash, in steps 27 and 31.
23. Check it on your PC: open `https://<your-app>.vercel.app/diary` directly. The app should load, not a 404. In **More → Settings → AI estimates** the **Account** row now says "Sign in for AI estimates": the build picked up Supabase. Sign-in already works, but AI estimates need part 5 first.

`vercel.json` serves every app route (such as `/diary` or `/more/pots/123`) from `index.html`, while real files (`/assets/…`, `sw.js`, `workbox-*.js`, `manifest.webmanifest`, `/icons/…`) are served as they are. It also sets caching (hashed assets for a year, `sw.js` and the manifest always revalidated) and security headers, including a Content-Security-Policy that allows network calls only to this site and `https://*.supabase.co`.

## Part 5 · The estimate Edge Function

24. Check the Supabase CLI runs through npx (answer `y` if npx offers to download the `supabase` package):

    ```
    npx supabase --version
    ```

25. Log in. A browser window opens; approve it and come back to the terminal:

    ```
    npx supabase login
    ```

26. Link this folder to your project (replace the ref with yours from step 12). If it asks for the database password, press Enter to skip, or paste the one from step 11:

    ```
    npx supabase link --project-ref abcdefghijklmnopqrst
    ```

27. Set the function's secrets. Create the file `supabase/.env.secrets` in your editor (git ignores every `.env.*` file except `.env.example`, so it stays on your PC) with your values:

    ```
    ANTHROPIC_API_KEY=sk-ant-...your key...
    ALLOWED_EMAILS=you@example.com
    ALLOWED_ORIGIN=https://kira-makan.vercel.app,http://localhost:5173
    ```

    Then push it and check the names are there (values show as hashes):

    ```
    npx supabase secrets set --env-file supabase/.env.secrets
    npx supabase secrets list
    ```

    - `ALLOWED_EMAILS`: who may use AI estimates, comma-separated, case doesn't matter. Empty means nobody.
    - `ALLOWED_ORIGIN`: the web origins allowed to call the function, comma-separated, exactly as the browser shows them (`https://`, no trailing slash). `http://localhost:5173` is only needed if you run the dev app against the deployed function (see "Testing locally against Supabase" below). A `*` stands for part of one host label, so `https://kira-makan-*-yourteam.vercel.app` covers Vercel preview addresses.
    - New secret values apply right away; no redeploy needed.

    You can also set them inline, but the key then lands in your shell history. Quote each `NAME=value`, because PowerShell can split an unquoted comma list:

    ```
    npx supabase secrets set "ANTHROPIC_API_KEY=sk-ant-..." "ALLOWED_EMAILS=you@example.com" "ALLOWED_ORIGIN=https://kira-makan.vercel.app"
    ```

28. Regenerate the catalogue the function bundles, so it matches the app's food list:

    ```
    npm run build:estimate-catalogue
    ```

    It prints `Wrote … catalogue entries to supabase/functions/estimate/catalogue.json`.

29. Deploy the function:

    ```
    npx supabase functions deploy estimate --no-verify-jwt --use-api
    ```

    `--use-api` bundles the function on Supabase's servers, so you don't need Docker. `--no-verify-jwt` matches `supabase/config.toml`: the function checks the signed-in user's token itself (this works with both publishable and legacy anon keys), so the platform's own check stays off.

30. Check it's guarding the door. In PowerShell use `curl.exe` (plain `curl` is a different command there); in Git Bash use `curl`:

    ```
    curl.exe -i -X POST https://abcdefghijklmnopqrst.supabase.co/functions/v1/estimate
    ```

    Expect `HTTP/… 401` and `{"error":"Sign in to use AI estimates.","code":"notSignedIn"}`. That answer comes from your function: it's deployed and refuses callers who aren't signed in. A 401 with a different message (such as "Invalid JWT") means the platform check is on: redeploy with step 29 exactly as written.

## Part 6 · Finish the Supabase settings

31. Go to **Authentication → URL Configuration** and set **Site URL** to your production address from step 22 (it starts as `http://localhost:3000`). Save. Codes don't use links, but this keeps any address Supabase puts in its emails pointing at your app.

## Part 7 · On the phone

32. Install the app:
    - **iPhone**: open the production address in **Safari** (not an in-app browser). Tap **Share** (the square with an arrow; on recent iOS it can sit behind the **⋯** button next to the address bar), scroll to **Add to Home Screen**, keep **Open as Web App** on, and tap **Add**.
    - **Android**: open it in **Chrome**, tap **⋮**, then **Add to Home screen** or **Install app**, and confirm. The welcome screen may also offer its own install button.
33. Open Kira Makan **from the Home Screen icon**, not from the browser. On iPhone the installed app keeps its own data, separate from Safari: anything entered in a Safari tab doesn't carry over.
34. Tap **Get started** and run setup (about 2 minutes). Or tap **Explore with sample data** to look around first; later, **More → Settings → Leave demo and start fresh** clears the sample data and opens setup.
35. Sign in for AI estimates: **More → Settings → AI estimates → Account → Sign in**. Enter your email and tap **Send code**. Open the email (check spam the first time), type the 6-digit code and tap **Sign in**. The row now shows "Signed in as …". The phone stays signed in; Supabase refreshes the session in the background.
36. Leave **AI estimates** on **When needed** (the default and the cheapest): the AI runs only when the offline catalogue can't match everything you typed, and for photos. **Always** sends every typed meal and photo; **Off** keeps everything on the phone.
37. Try a typed meal: tap **Log**, type something the catalogue may not know, such as `mee siput muar, kopi o kosong`, and tap **Estimate**. To see that the AI answered, open the Supabase dashboard → **Edge Functions → estimate** and look at its invocations or logs for a 200; the request also appears on the Anthropic Console's [Usage](https://platform.claude.com/usage) page.
38. Your diary lives only on this phone. Save a backup now and then: **More → Export → Full backup (JSON)**, and keep the file somewhere off the phone (the app has no restore screen yet, but the file holds everything). The app asks the browser to keep its storage once setup is done, but on iPhone, removing the Home Screen app also removes its data, so export first.

### Testing locally against Supabase (optional)

To run the dev app against the deployed function, put `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` in `.env.local`, delete the `VITE_ESTIMATE_URL` line, make sure `ALLOWED_ORIGIN` includes `http://localhost:5173` (step 27), restart `npm run dev` and sign in from Settings. With Supabase set, the app always sends a sign-in token, so even `/api/estimate` needs you signed in.

### Updating later

- Push to the production branch on GitHub (usually `main`): Vercel builds and deploys it. The installed app picks up the new version by itself; if it still looks old, close it fully and open it again (twice at most).
- Changed the food catalogue in `src/data` or the server code in `supabase/functions/estimate`: repeat steps 28 and 29.
- Changed a Vercel environment variable: redeploy (Deployments → the latest one → **⋯ → Redeploy**). `VITE_` values are baked in at build time, so old builds keep the old values.
- Changed a Supabase secret: nothing else to do.

---

## Troubleshooting

Where the app says "estimates stay offline", it fell back to the catalogue and nothing was lost. Browser errors are in the developer tools console (on a PC, F12) or the Network tab.

| Symptom | Likely cause | Fix |
|---|---|---|
| Estimates stay offline and Settings says "Until you sign in, estimates stay offline." | Not signed in on this phone | Step 35. |
| Function answers **401** `notSignedIn` | No token, or the session expired and couldn't refresh | Sign out and in again in Settings. |
| **401** "Invalid JWT" or "Missing authorization header" | The platform's JWT check is on | Redeploy with `--no-verify-jwt` (step 29). |
| Function answers **403** `forbidden` | Your email isn't on `ALLOWED_EMAILS` | Fix the spelling and repeat step 27; no redeploy needed. |
| Console shows a **CORS** error, or the request has no response | The app's origin isn't on `ALLOWED_ORIGIN` | Add the exact origin from the address bar (`https://…`, no trailing slash), repeat step 27. Preview addresses need their own entry or a `*` pattern. |
| Console says "Refused to connect … Content Security Policy" | The app calls a host outside `https://*.supabase.co` (a Supabase custom domain, or `VITE_ESTIMATE_URL` pointing elsewhere) | Add that origin to `connect-src` in `vercel.json` and push. |
| Console says the Vercel feedback script was blocked (preview deployments only) | The Content-Security-Policy blocks Vercel's preview toolbar | Harmless; production deployments don't load it. |
| Function answers **500** `upstream`, or **429** | Anthropic key missing or wrong, credit used up, spend limit reached, or more than 30 estimates in an hour | Supabase → Edge Functions → estimate → logs; Anthropic Console Billing and Usage; `npx supabase secrets list` shows `ANTHROPIC_API_KEY`. |
| Function answers **503** `upstream` | The function couldn't check the sign-in with Supabase Auth | Try again in a minute. |
| "That email can't sign in to this app." | The address isn't a user (sign-ups are off, so a mistyped address can't create one), or Supabase's built-in email refuses it because the address isn't on your Supabase organisation's team | Check the spelling; step 14 creates the user. If the user exists in **Authentication → Users**, step 18: add the address to the team, or set up your own email provider. |
| "Too many codes asked for. Wait a minute and try again." | One code per address a minute, and the built-in email sends only about 2 emails an hour for the whole project | Wait, and use the newest code you already have; codes last an hour. Step 18 (your own email provider) raises the hourly limit. |
| The code email never arrives | Spam filtering, or a slow delivery from the built-in email | Check spam, wait a few minutes, and use the newest email. If it keeps happening, step 18. |
| Sign-in and AI estimates stop after a quiet week or two | Supabase pauses free-plan projects after a stretch without activity | Open the Supabase dashboard and restore the project. The rest of the app keeps working meanwhile. |
| The email has a link and no code | The template still uses `{{ .ConfirmationURL }}`, or the user is unconfirmed (that sends the sign-up template) | Steps 17 and 14. |
| "That code is wrong or has expired." every time, and the email's code is longer than 6 digits | The project's code length is above 6. The code field takes 6 digits, so the rest are cut off and a new code fails the same way | Step 15: set **Email OTP Length** to 6 and save, then send a new code. |
| "That code is wrong or has expired." | Typo, a code older than an hour, or an older code after a newer one was sent | Tap **Send a new code** and use the newest email. |
| A deep link such as `/diary` shows Vercel's 404 page | `vercel.json` isn't at the repo root, or the Root Directory points elsewhere | Step 21; check `vercel.json` is in the deployed commit. |
| The app looks old after a deploy | The service worker serves the previous version until it has fetched the new one | Close the app fully and reopen it, up to twice. In a desktop browser, a reload does the same. |
| Data missing on iPhone | Data entered in a Safari tab, private browsing, or the Home Screen app was removed | Use the Home Screen app only (step 33), and keep regular backups (step 38). |
| `npx` refuses to run in PowerShell | Script execution policy | Use Git Bash, or `npx.cmd`. |
| The Vercel build fails on the Node version | The project's Node.js version is older than Vite needs | Project **Settings → Build and Deployment → Node.js Version** (if the label differs, look for **Node.js Version** under **General**): pick 22.x or newer (24.x matches local development), then redeploy. |
| `npx supabase link` or `deploy` says you're not logged in or lack access | Logged in to another Supabase account, or the ref is wrong | Repeat steps 25 and 26 with the ref from the dashboard address bar. |

## Costs

**Vercel and Supabase**: the free plans cover one person comfortably (static hosting; a few Edge Function calls a day; one auth user). Supabase pauses free projects that go unused for a while; restoring one from the dashboard takes a click.

**Claude API** (`claude-sonnet-5-5`: US$2 per million input tokens, US$10 per million output tokens — about half of Opus 5.5):

- Each estimate sends a compact listing of the food catalogue (about 20,000 characters) plus your meal, about **12,000 input tokens** in all, and gets back a small structured answer (about 170 tokens) at low effort.
- Measured on a real call (`nasi goreng kampung, teh o ais limau`): **about US$0.026 per estimate**. A photo adds well under a cent.
- The prompt is deliberately not cached: a cache write costs 25% more and only pays off if the next estimate comes within 5 minutes, which rarely happens with meals hours apart. (With caching, the same call measured about US$0.043.)
- With **When needed**, the AI runs only for meals the offline catalogue can't fully match, so a typical day is 0–3 calls: roughly US$0–2.50 a month. **Always** with 4 meals a day is about 120 calls, roughly US$3 a month.
- The model is set in one place, `ESTIMATE_MODEL` in `supabase/functions/estimate/core.ts`. Change it there and redeploy the function (step 29) if you ever want a different one.
- The spend limit from step 3 (US$10 a month) is the real cap. The function also stops one user at 30 estimates an hour, but that guard lives in the function's memory and resets when Supabase restarts it.
- Your actual usage is on the Anthropic Console's [Usage](https://platform.claude.com/usage) page, and spend on the [Billing](https://platform.claude.com/settings/billing) page.

## What's public and what's secret

| Value | Where it lives | Public? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | Vercel environment variables, baked into the app | Yes, by design |
| `ANTHROPIC_API_KEY` | Supabase secrets, and `.env.local` on your PC | No: never in Vercel, a `VITE_` variable or Git |
| `ALLOWED_EMAILS`, `ALLOWED_ORIGIN` | Supabase secrets | Not secret, but only you set them |
| Your diary, weights, photos | IndexedDB on the phone | Never leaves the phone, except the meal text, photo and portion hints sent for an AI estimate |
