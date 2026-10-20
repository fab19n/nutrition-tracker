# Deploying Kira Makan

This guide takes Kira Makan from your PC to your phone:

- **Vercel** hosts the app as static files, built from your GitHub repo.
- **Supabase** runs the sign-in (email and password), keeps the synced copy of your diary in its database, and runs the `estimate` Edge Function, which holds your Anthropic API key as a secret.
- **Anthropic** (Claude) reads typed meals and photos the offline catalogue can't.

```
Phone (installed app from Vercel)
  ├─ your diary: on the phone (IndexedDB), works offline, no account needed
  ├─ sync (signed in) ──► Supabase database: sync_* functions ──► your rows in sync_rows
  │                         a laptop restores from the same copy and stays in step
  └─ AI estimate ──► Supabase Edge Function "estimate" ──► Claude API
                       checks: signed-in user, email on ALLOWED_EMAILS, web origin on ALLOWED_ORIGIN
```

Sign-in protects two things: the synced copy of your diary and the AI function. The app works fully without an account. Signing in keeps a copy of your diary in your Supabase database, so a second device such as a laptop can restore it and stay in sync, and it unlocks AI estimates. The copy holds your meals, weights, goals, Places and settings as plain JSON: through the app only your own account can read it, and you can see it yourself in the Supabase dashboard (so can anyone else you give access to the project). Photos stay on the phone. You sign in with your email and a password, typed in the app (your password manager fills it in), and the phone stays signed in. Supabase sends no email at all. An emailed link would open Safari instead of the installed iPhone app, and new free Supabase projects can't change the built-in email to carry a code instead. New sign-ups are blocked: only the account you create yourself can sign in.

Plan on about 50 minutes. Steps are numbered straight through, so the troubleshooting table can point back at them.

## Before you start

- Node.js 20.19 or later (`node --version`; this project is developed on Node 24), Git, and this repo pushed to GitHub.
- A Vercel account connected to GitHub, a Supabase account (the free plan is enough) and an Anthropic Console account.
- The email address you'll sign in with on the phone, and a password manager to make and keep its password (on iPhone, the built-in Passwords app works). No email is ever sent to the address, so any address you own works.

Run every command from the project folder, `C:\GitHub\nutrition-tracker`, in PowerShell or Git Bash. Commands are the same in both unless a step says otherwise.

> If PowerShell answers `npx` with "running scripts is disabled on this system", use Git Bash instead, or type `npx.cmd` wherever this guide says `npx`.

Dashboards change their wording now and then. Where a label might differ, the step says what to look for instead.

---

## Part 1 · Anthropic API key, credit and spend limit

1. Go to [platform.claude.com](https://platform.claude.com) and sign in, or create an account.
2. Add credit. Open [Billing](https://platform.claude.com/settings/billing) (`platform.claude.com/settings/billing`), add a payment method and buy a small amount of credit; US$5–10 lasts months for one person (see [Costs](#costs)). If the label differs, look for **Buy credits** or **Add credits**. Leave automatic reload off, so the credit you bought is the most you can spend.
3. Set a monthly spend limit. On the same Billing page, in **Spend limits**, click **Set limit** (or **Adjust limit**), enter `10` and save. When usage reaches it, AI estimates stop until next month and the app falls back to offline estimates.
4. Create the key. Open [API keys](https://platform.claude.com/settings/keys) (`platform.claude.com/settings/keys`), click **Create key**, name it `kira-makan`, pick an expiration (with an expiring key you'll repeat step 29 when it runs out) and set **Linked account** to yourself. Copy the key (it starts with `sk-ant-`): the Console shows it only once. Keep it in your password manager.

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

## Part 3 · Supabase project, sign-in and sync storage

11. Open the [Supabase dashboard](https://supabase.com/dashboard) and click **New project**. Name it `kira-makan`, generate a database password and save it in your password manager (the app reaches the database only through Supabase's API and never needs this password, but Supabase asks for one), and set **Region** to **Southeast Asia (Singapore)**. Create the project and wait a minute or two until it's ready.
12. Note the **project ref**: the part after `/project/` in the dashboard's address bar, for example `abcdefghijklmnopqrst`. Your project URL is `https://<project-ref>.supabase.co`. (The **Connect** button at the top of the dashboard shows the URL too.)
13. Copy the public key. Go to **Settings → API Keys** and copy the **Publishable key** (`sb_publishable_...`). If your project shows only legacy keys, copy the **anon** key (a long `eyJ...` key) instead. Both are public by design; never copy a secret or `service_role` key into the app.
14. Add yourself as the only user. First make the password: in your password manager, generate a random one of 20 to 64 characters (Supabase refuses passwords over 72) and save it as "Kira Makan" with your email. Then go to **Authentication → Users**, click **Add user → Create new user**, enter that email and paste the password, tick **Auto Confirm User** and create the user. If the labels differ, look for the option that creates a user directly rather than sending an invitation. The tick matters: an unconfirmed user can't sign in. Supabase never emails this address, so any address you own works; step 29 puts the same one on the function's allow list.
15. Check that email sign-in is on. Go to **Authentication → Sign In / Providers** and open **Email**. Make sure it's enabled (password sign-in is part of it) and save. The **Email OTP** settings on that page don't matter: the app doesn't use codes.
16. Block new sign-ups. On the same page, turn off **Allow new users to sign up** and save. If the label differs, look for **Enable sign ups** or **User Signups**. Leave anonymous sign-ins off. Existing users (you) can still sign in.
17. Skip the email settings. The app never asks Supabase to send email, so leave **Emails** (templates) and **SMTP Settings** as they are. New free projects can't edit the built-in email templates anyway, and the built-in sender only reaches your Supabase team, about 2 emails an hour; none of that affects password sign-in.
18. Leave the rate limits alone. What stops anyone guessing your password is its length: a random 20-character password can't be guessed in any useful time. Supabase also limits how often one internet connection can sign in. Password sign-ins count against the **token** limit in **Authentication → Rate Limits** (it says token refreshes; signing in uses the same endpoint), not the "sign-ups and sign-ins" one. Leave both at their defaults: one person never comes close, and lowering the token limit would also slow the background refreshes that keep your phone signed in.
19. Create the sync storage. Open **SQL Editor**, start a new query (**New query**, or the **+** button), paste the whole of `supabase/sync.sql` from this repo and click **Run**. It should end with a success message and no rows. It creates two tables, `sync_accounts` and `sync_rows`, and the four functions the app calls (`sync_hello`, `sync_pull`, `sync_keys`, `sync_push`). Each signed-in user can read only their own rows, the tables can only be changed through those functions, and nothing is open to signed-out callers. If the editor warns about a destructive operation, that's the file's `drop policy if exists` lines, which make it safe to run again: confirm. Always paste it this way: don't move it into `supabase/migrations`, because `npx supabase db push` doesn't know it already ran and would run it again.
20. Check it. In a new query, paste the whole of `supabase/sync-selftest.sql` and click **Run**. It acts as the user from step 14, tries each sync rule against the real tables and then rolls everything back, so it changes nothing. A success message means every check passed. A failed check stops with an error that names it, such as `a new row applies`: run step 19 again, then this step. "Sign in to sync" means there's no user yet: do step 14 first. The file's first lines also describe an optional check that signed-out callers are refused.

## Part 4 · Vercel

21. Make sure the latest code, including `vercel.json` at the repo root, is pushed to GitHub. Never commit `.env.local`.
22. Go to [vercel.com/new](https://vercel.com/new). Under **Import Git Repository**, pick your repo and click **Import**. If the repo isn't listed, use the option to adjust the GitHub app's permissions and give Vercel access to it.
23. On **Configure Project**:
    - **Project Name**: `kira-makan`. The production address becomes `https://kira-makan.vercel.app` when that name is free; otherwise Vercel adds a suffix.
    - **Framework Preset**: Vite. `vercel.json` also sets it, along with the build command (`npm run build`) and output directory (`dist`), so leave **Build and Output Settings** as they are.
    - **Root Directory**: the repo root (`./`).
    - **Environment Variables**: add two variables for all environments:

      | Name | Value |
      |---|---|
      | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` (step 12, no trailing slash) |
      | `VITE_SUPABASE_KEY` | the publishable or anon key from step 13 |

      If Vercel asks for a type, **Config** is fine: both values are public. Don't add `VITE_ESTIMATE_URL`; the app derives `https://<project-ref>.supabase.co/functions/v1/estimate` itself. Never add `ANTHROPIC_API_KEY` to Vercel.
24. Click **Deploy** and wait for the build to finish. Open the project's **Domains** (or the production deployment) and note the production address, for example `https://kira-makan.vercel.app`. Use this exact origin, with no trailing slash, in steps 29 and 33. Also add it as the website of the "Kira Makan" entry in your password manager (step 14), so the phone offers the login when you sign in (step 37).
25. Check it on your PC: open `https://<your-app>.vercel.app/diary` directly. The app should load, not a 404. On the welcome screen, **Restore from your account** now sits under **Get started**: the build picked up Supabase. Tap **Explore with sample data**, then open **More → Settings**: the first group is **Account and sync**, and its **Account** row says "Sign in to sync and use AI estimates". Don't sign in on the PC yet. A diary set up here would become the account's copy before the phone's, and the phone would then ask which one to keep; step 42 brings the phone's diary to the PC instead. AI estimates also need part 5 first.

`vercel.json` serves every app route (such as `/diary` or `/more/pots/123`) from `index.html`, while real files (`/assets/…`, `sw.js`, `workbox-*.js`, `manifest.webmanifest`, `/icons/…`) are served as they are. It also sets caching (hashed assets for a year, `sw.js` and the manifest always revalidated) and security headers, including a Content-Security-Policy that allows network calls only to this site and `https://*.supabase.co`.

## Part 5 · The estimate Edge Function

26. Check the Supabase CLI runs through npx (answer `y` if npx offers to download the `supabase` package):

    ```
    npx supabase --version
    ```

27. Log in. A browser window opens; approve it and come back to the terminal:

    ```
    npx supabase login
    ```

28. Link this folder to your project (replace the ref with yours from step 12). If it asks for the database password, press Enter to skip, or paste the one from step 11:

    ```
    npx supabase link --project-ref abcdefghijklmnopqrst
    ```

29. Set the function's secrets. Create the file `supabase/.env.secrets` in your editor (git ignores every `.env.*` file except `.env.example`, so it stays on your PC) with your values:

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

30. Regenerate the catalogue the function bundles, so it matches the app's food list:

    ```
    npm run build:estimate-catalogue
    ```

    It prints `Wrote … catalogue entries to supabase/functions/estimate/catalogue.json`.

31. Deploy the function:

    ```
    npx supabase functions deploy estimate --no-verify-jwt --use-api
    ```

    `--use-api` bundles the function on Supabase's servers, so you don't need Docker. `--no-verify-jwt` matches `supabase/config.toml`: the function checks the signed-in user's token itself (this works with both publishable and legacy anon keys), so the platform's own check stays off.

32. Check it's guarding the door. In PowerShell use `curl.exe` (plain `curl` is a different command there); in Git Bash use `curl`:

    ```
    curl.exe -i -X POST https://abcdefghijklmnopqrst.supabase.co/functions/v1/estimate
    ```

    Expect `HTTP/… 401` and `{"error":"Sign in to use AI estimates.","code":"notSignedIn"}`. That answer comes from your function: it's deployed and refuses callers who aren't signed in. A 401 with a different message (such as "Invalid JWT") means the platform check is on: redeploy with step 31 exactly as written.

## Part 6 · Finish the Supabase settings

33. Go to **Authentication → URL Configuration** and set **Site URL** to your production address from step 24 (it starts as `http://localhost:3000`). Save. Sign-in sends no email, so this is a safety net: if Supabase ever does send one (say, from a button in its dashboard), any link in it points at your app instead of `localhost`.

## Part 7 · On the phone

34. Install the app:
    - **iPhone**: open the production address in **Safari** (not an in-app browser). Tap **Share** (the square with an arrow; on recent iOS it can sit behind the **⋯** button next to the address bar), scroll to **Add to Home Screen**, keep **Open as Web App** on, and tap **Add**.
    - **Android**: open it in **Chrome**, tap **⋮**, then **Add to Home screen** or **Install app**, and confirm. The welcome screen may also offer its own install button.
35. Open Kira Makan **from the Home Screen icon**, not from the browser. On iPhone the installed app keeps its own data, separate from Safari: anything entered in a Safari tab doesn't carry over.
36. Tap **Get started** and run setup (about 2 minutes). Or tap **Explore with sample data** to look around first; later, **More → Settings → Leave demo and start fresh** clears the sample data and opens setup. Sample data never syncs. If your account already holds a diary (from an earlier phone), tap **Restore from your account** instead, as in step 42.
37. Sign in: **More → Settings → Account and sync → Account → Sign in**. Enter your email and the password from step 14 and tap **Sign in**. On iPhone, tap the email field and pick the saved login above the keyboard to fill both; if it isn't offered, open the "Kira Makan" entry in your password manager, add the app's address (`https://<your-app>.vercel.app`) to it and try again. The row now shows "Signed in as …". The phone stays signed in; Supabase refreshes the session in the background, so you type the password about once per device. Signing in turns on sync and AI estimates.
38. Watch the first sync. The **Account and sync** card above the Account row reads **Backing up** with a count while the phone sends its diary to your account for the first time (a small diary shows **Syncing…** instead), then **Up to date**. Keep the app open until it does; if it closes first, it carries on next time. From then on the phone syncs by itself about 2 seconds after each change, when you open the app or come back to it, when it's back online, and every 5 minutes while it's open; **Sync now** on the card runs it straight away. If the card says "Sync isn't set up on the server", do steps 19 and 20, then tap **Try again**. "Sync is off in demo mode" means you're exploring sample data: sync starts once you leave demo and set up.
39. Leave **AI estimates** on **When needed** (the default and the cheapest): the AI runs only when the offline catalogue can't match everything you typed, and for photos. **Always** sends every typed meal and photo; **Off** keeps estimates on the phone.
40. Try a typed meal: tap **Log**, type something the catalogue may not know, such as `mee siput muar, kopi o kosong`, and tap **Estimate**. To see that the AI answered, open the Supabase dashboard → **Edge Functions → estimate** and look at its invocations or logs for a 200; the request also appears on the Anthropic Console's [Usage](https://platform.claude.com/usage) page.
41. Your diary lives on this phone, with a synced copy in your account; photos stay on the phone only. Save a backup now and then anyway: **More → Export → Full backup (JSON)**, and keep the file somewhere off the phone (the app has no import screen yet, but the file holds everything). The app asks the browser to keep its storage once setup is done, but on iPhone, removing the Home Screen app also removes its data. What had synced comes back with **Restore from your account** (step 42); photos and changes that hadn't synced yet don't, so export first.

## Part 8 · A second device

42. On the laptop (or a new phone), open the production address; install it as in step 34 if you like. On the welcome screen tap **Restore from your account**, sign in with the same email and password, and keep the app open while it shows **Restoring your diary**. Today then opens on your diary with "Restored · … meals", and the two devices sync from then on.
    - Use **Restore from your account**, not **Get started**. A device that runs its own setup and then signs in holds a second diary, and its Settings card says "Your account already has a diary". Tap **Choose**: **Use the account's data** replaces that device's data with the account's, and **Keep this device's data** replaces the account's copy, with your other devices following on their next sync. The two diaries can't be merged, and the replaced data is gone, so export a backup first if both matter. **Not now** turns sync off on that device until you tap **Turn on sync**.
    - Theme and location permission are set per device. Everything else, settings included, syncs.
    - When both devices are open, one can lag the other by up to 5 minutes; **Sync now** catches it up.
    - **More → Settings → Delete everything** removes the data on that device only and signs it out. The copy in your account stays, and **Restore from your account** brings it back.

### Testing locally against Supabase (optional)

To run the dev app against the deployed function, put `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` in `.env.local`, delete the `VITE_ESTIMATE_URL` line, make sure `ALLOWED_ORIGIN` includes `http://localhost:5173` (step 29), restart `npm run dev` and sign in from Settings. With Supabase set, the app always sends a sign-in token, so even `/api/estimate` needs you signed in.

The dev app then syncs too, with the same account. Signing in on `localhost` with a diary set up there would make it the account's copy if the account is still empty, or ask which copy to keep. On `localhost`, use **Restore from your account**, or **Explore with sample data** (sample data never syncs).

### Deleting the copy in your account

The app never deletes the account's copy. To wipe it, run this in the **SQL Editor** with your email:

```sql
begin;
update public.sync_accounts set dataset = gen_random_uuid(), rev = 0, updated_at = now()
 where user_id = (select id from auth.users where email = '<you>');
delete from public.sync_rows where user_id = (select id from auth.users where email = '<you>');
commit;
```

The update goes first because it locks your account's sync record: it waits for a sync that's already sending, and holds back new ones until the delete is done, so no device's changes land in the middle.

The data on each device stays as it is. Their Settings cards then say "The copy in your account was deleted": **Upload this device's data** makes that device's diary the account's copy again, and **Turn off sync** keeps it on that device only.

### Updating later

- Push to the production branch on GitHub (usually `main`): Vercel builds and deploys it. The installed app picks up the new version by itself; if it still looks old, close it fully and open it again (twice at most).
- Adding sync to a phone that already has a diary (installed before sync existed): do steps 19 and 20 first, then push the new build. The phone uploads its diary by itself the first time it opens the new version while signed in; watch for **Up to date** (step 38). Then restore the laptop (step 42).
- Changed the food catalogue in `src/data` or the server code in `supabase/functions/estimate`: repeat steps 30 and 31.
- Changed a Vercel environment variable: redeploy (Deployments → the latest one → **⋯ → Redeploy**). `VITE_` values are baked in at build time, so old builds keep the old values.
- Changed a Supabase secret: nothing else to do.

---

## Troubleshooting

Where the app says "estimates stay offline", it fell back to the catalogue and nothing was lost. Wherever sync is stuck, entries wait on the phone and nothing is lost either. Browser errors are in the developer tools console (on a PC, F12) or the Network tab.

| Symptom | Likely cause | Fix |
|---|---|---|
| Estimates stay offline and Settings says "Until you sign in, estimates stay offline." | Not signed in on this phone | Step 37. |
| Function answers **401** `notSignedIn` | No token, or the session expired and couldn't refresh | Sign out and in again in Settings. |
| **401** "Invalid JWT" or "Missing authorization header" | The platform's JWT check is on | Redeploy with `--no-verify-jwt` (step 31). |
| Function answers **403** `forbidden` | Your email isn't on `ALLOWED_EMAILS` | Fix the spelling and repeat step 29; no redeploy needed. |
| Console shows a **CORS** error, or the request has no response | The app's origin isn't on `ALLOWED_ORIGIN` | Add the exact origin from the address bar (`https://…`, no trailing slash), repeat step 29. Preview addresses need their own entry or a `*` pattern. |
| Console says "Refused to connect … Content Security Policy" | The app calls a host outside `https://*.supabase.co` (a Supabase custom domain, or `VITE_ESTIMATE_URL` pointing elsewhere) | Add that origin to `connect-src` in `vercel.json` and push. |
| Console says the Vercel feedback script was blocked (preview deployments only) | The Content-Security-Policy blocks Vercel's preview toolbar | Harmless; production deployments don't load it. |
| Function answers **500** `upstream`, or **429** | Anthropic key missing or wrong, credit used up, spend limit reached, or more than 30 estimates in an hour | Supabase → Edge Functions → estimate → logs; Anthropic Console Billing and Usage; `npx supabase secrets list` shows `ANTHROPIC_API_KEY`. |
| Function answers **503** `upstream` | The function couldn't check the sign-in with Supabase Auth | Try again in a minute. |
| "Wrong email or password." | A typo in either, or the email isn't a user. Supabase gives the same answer for both, so it doesn't reveal who has an account | Fill both from your password manager (step 37), or tap the eye icon to check the password. The email must match the user in **Authentication → Users** exactly. |
| Lost the password | The app has no "forgot password" flow. Don't use **Send password recovery** in the dashboard: its email link opens Safari, and the app ignores it. Don't delete the user either: Supabase refuses while the user has a synced copy, because the copy belongs to that user | Set a new password in place. Generate one in your password manager (20 to 64 characters), then run this in the **SQL Editor** with your values: `update auth.users set encrypted_password = extensions.crypt('<new>', extensions.gen_salt('bf')) where email = '<you>';` Delete that query from the editor afterwards so the password isn't kept there, and update the saved login. Your diary and its synced copy stay as they are; sign in with the new password wherever the app asks. If it's refused, check the email in the query matches the user in **Authentication → Users** exactly. |
| "This account isn't confirmed yet." | The user was created without **Auto Confirm User** | Delete the user in **Authentication → Users** and repeat step 14 with the box ticked. (An unconfirmed user never signed in, so it has no synced copy to lose.) |
| "Too many tries. Wait a few minutes and try again." | Too many sign-ins from your connection for Supabase's token limit (step 18) | Wait 5 minutes, then fill the password from your password manager rather than typing it. |
| "Email sign-in is turned off for this app." | The Email provider is disabled | Step 15. |
| "That email can't sign in to this app." | The user is banned in Supabase | In **Authentication → Users**, unban the user. Don't delete it: the synced copy belongs to it, and Supabase refuses. |
| Settings says "Sync isn't set up on the server" | `supabase/sync.sql` hasn't run in this project, or ran in another one | Steps 19 and 20 in the project whose URL is in `VITE_SUPABASE_URL`, then **Try again** on the card. |
| Settings says "Can't reach your account" | No connection to Supabase, Supabase is having trouble, or the project is paused (below) | Nothing to do: the app keeps trying, sooner when the phone comes back online or you reopen it. **Try again** runs it now. |
| Settings says "Your account refused the last sync" | Supabase answered but refused the whole sync (a database error), or something between the app and Supabase answered instead | The entries stay on the device and the app keeps trying. In the Supabase dashboard open **Logs** and look at the API Gateway and Postgres logs around that time for the `sync_push` or `sync_pull` error. If `supabase/sync.sql` has changed since you ran it, do steps 19 and 20 again. **Try again** on the card runs it now. |
| Settings says "Sync stopped on a problem" | Something other than your account stopped the sync: a problem on the device or on the way to Supabase, or another device linking to the account at the same moment | Usually nothing: the entries stay on the device and the app keeps trying. **Try again** on the card runs it now. If another device was linking, the next try asks which copy to keep (see "Your account already has a diary" below). If it stays for more than a day, export a backup (**More → Export → Full backup**) and check Supabase → **Logs** for errors from the `sync_` functions. |
| Settings says "Sign in again to keep syncing" | You're signed in on this device, but Supabase refused its session (for example after the project's JWT signing keys changed) | **Try again** first. If it stays, **Sign out** on the card, then sign in again (step 37); nothing waiting is lost. |
| Restore says "Your diary is still uploading" | Another device is part way through its first upload to the account | Keep that device open until its card says **Up to date** (step 38), then tap **Try again**. |
| Settings says "Your account already has a diary" | This device ran its own setup before it first synced | Step 42: **Choose**, after exporting a backup if both copies matter. |
| Settings says "This device syncs with another account" | You signed in with a different account from the one this device syncs with | **Switch to this account**, or **Sign out** and sign in with the other one. |
| Settings says "The copy in your account was deleted" | The account's copy was wiped ("Deleting the copy in your account") | **Upload this device's data**, or **Turn off sync**. |
| Settings says "… couldn't sync" under the card | The server refused those entries (for example one larger than 256 KB) | They stay on the phone and are tried again the next time the app starts. |
| Sign-in, sync and AI estimates stop after a quiet week or two | Supabase pauses free-plan projects after a stretch without activity | Open the Supabase dashboard and restore the project. Meanwhile the rest of the app works and sync waits, with everything kept on the phone; it catches up once the project is back. Using the app every day keeps the project awake. |
| A deep link such as `/diary` shows Vercel's 404 page | `vercel.json` isn't at the repo root, or the Root Directory points elsewhere | Step 23; check `vercel.json` is in the deployed commit. |
| The app looks old after a deploy | The service worker serves the previous version until it has fetched the new one | Close the app fully and reopen it, up to twice. In a desktop browser, a reload does the same. |
| Data missing on iPhone | Data entered in a Safari tab, private browsing, or the Home Screen app was removed | Use the Home Screen app only (step 35), and keep regular backups (step 41). If the phone was signed in, **Restore from your account** on the welcome screen brings back what had synced (step 42). |
| `npx` refuses to run in PowerShell | Script execution policy | Use Git Bash, or `npx.cmd`. |
| The Vercel build fails on the Node version | The project's Node.js version is older than Vite needs | Project **Settings → Build and Deployment → Node.js Version** (if the label differs, look for **Node.js Version** under **General**): pick 22.x or newer (24.x matches local development), then redeploy. |
| `npx supabase link` or `deploy` says you're not logged in or lack access | Logged in to another Supabase account, or the ref is wrong | Repeat steps 27 and 28 with the ref from the dashboard address bar. |

## Costs

**Vercel and Supabase**: the free plans cover one person comfortably (static hosting; a few Edge Function calls a day; one auth user; a synced diary of a few thousand rows, a few megabytes of database). Supabase pauses free projects that go unused for a while; restoring one from the dashboard takes a click, and sync waits meanwhile with nothing lost.

**Claude API** (`claude-sonnet-5-5`: US$2 per million input tokens, US$10 per million output tokens — about half of Opus 5.5):

- Each estimate sends a compact listing of the food catalogue (about 20,000 characters) plus your meal, about **12,000 input tokens** in all, and gets back a small structured answer (about 170 tokens) at low effort.
- Measured on a real call (`nasi goreng kampung, teh o ais limau`): **about US$0.026 per estimate**. A photo adds well under a cent.
- The prompt is deliberately not cached: a cache write costs 25% more and only pays off if the next estimate comes within 5 minutes, which rarely happens with meals hours apart. (With caching, the same call measured about US$0.043.)
- With **When needed**, the AI runs only for meals the offline catalogue can't fully match, so a typical day is 0–3 calls: roughly US$0–2.50 a month. **Always** with 4 meals a day is about 120 calls, roughly US$3 a month.
- The model is set in one place, `ESTIMATE_MODEL` in `supabase/functions/estimate/core.ts`. Change it there and redeploy the function (step 31) if you ever want a different one.
- The spend limit from step 3 (US$10 a month) is the real cap. The function also stops one user at 30 estimates an hour, but that guard lives in the function's memory and resets when Supabase restarts it.
- Your actual usage is on the Anthropic Console's [Usage](https://platform.claude.com/usage) page, and spend on the [Billing](https://platform.claude.com/settings/billing) page.

## What's public and what's secret

| Value | Where it lives | Public? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | Vercel environment variables, baked into the app | Yes, by design |
| `ANTHROPIC_API_KEY` | Supabase secrets, and `.env.local` on your PC | No: never in Vercel, a `VITE_` variable or Git |
| `ALLOWED_EMAILS`, `ALLOWED_ORIGIN` | Supabase secrets | Not secret, but only you set them |
| Your diary, weights, goals, Places and settings | IndexedDB on the phone and, once you sign in, the synced copy in your Supabase database (`sync_rows`) | No. Through the app only your account can read the copy. You, and anyone you give access to the Supabase project, can see it in the dashboard. The meal text and portion hints also go to the AI for an estimate |
| Your photos | IndexedDB on the phone | Never synced. A photo leaves the phone only when it's sent for an AI estimate |
