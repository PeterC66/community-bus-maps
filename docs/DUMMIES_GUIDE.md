# The Dummy's Guide — developing, testing, and demonstrating the portal

<!-- docstamp v1.8 | 2026-08-12 | sha=65debeca -->
**v1.8** · updated 12 August 2026

You know cmd/PowerShell, FTP and GitHub already. This guide fills the gap: the handful of **git** and **node** commands you need, how to run the portal on your own laptop, and how to show it to someone else without touching your 20i webspace.

It deliberately repeats nothing that's explained well elsewhere — each section says which of the existing docs to read for the deeper version.

**Before you show it to anyone:** the system is a **pilot** — it has no customers, and every map on it is one of ours. Every page carries a banner saying so and every map sheet a red band. That is deliberate, and it is one env var (`PILOT_MODE=0`) to switch off when the time comes. See [`PILOT.md`](PILOT.md).

**One-time fact worth knowing:** your 20i package is standard shared hosting (FTP + phpMyAdmin). 20i confirms Node.js apps only run on their separate *"Node.js Optimised Cloud Server"* product — ordinary shared hosting can't run this app at all. So "demonstrate it live" and "your 20i webspace" are two different things for this project (see Part 6).

---

## Which folder do I need to be in?

**Short answer: one folder, almost the whole time —**

```
C:\Claude\community-bus-maps
```

Open PowerShell, `cd` into it once, and every `git`, `npm` and `node` command in Parts 1–5 below is run from there (or a subfolder under it — git and npm both find the project root automatically, so being one level down, e.g. in `src\`, is fine too). You don't switch folders to go from "editing code" to "running git" to "starting the server" — it's the same window, same place, the whole time.

Two things that break that rule, both called out where they happen:

- **Opening a brand-new PowerShell window** — it starts you somewhere else (usually your home folder), so the very first command in that window needs to be `cd C:\Claude\community-bus-maps` again. Every code block below starts with that `cd` line so it works even pasted into a fresh window — if you're already there, `cd` to the folder you're in is harmless.
- **Part 6's Render.com steps** — after the first `git push`, everything else happens in your **web browser** on render.com, not in a PowerShell folder at all.

---

## 0. What's already on your laptop

Already installed and working — nothing to set up:

| Tool | Version found | What it's for |
|---|---|---|
| Node.js | v24.14.0 | runs the portal (it's a JavaScript program, not a website of static files) |
| npm | 11.9.0 | installs the portal's dependencies, and runs its scripts (`npm run dev`, `npm test`, …) |
| Git | 2.53.0 | tracks changes to the code, talks to GitHub |

The project already lives at `C:\Claude\community-bus-maps`, its `main` branch already tracks `https://github.com/PeterC66/community-bus-maps` on GitHub, and the working copy is currently clean (no uncommitted changes). You don't need to "install" or "clone" anything to get started.

---

## 1. The bare minimum git you actually need

You know GitHub (the website) already. Git is the *command-line tool* that talks to it. All of it runs **from `C:\Claude\community-bus-maps`** (see "Which folder do I need to be in?" above). Four commands cover almost everything you'll do yourself:

```powershell
cd C:\Claude\community-bus-maps
git status              # "what's changed since the last commit?" — run this often, it's always safe
git add <file>           # "stage" a changed file, ready to commit (or: git add -A for everything)
git commit -m "message"  # save a snapshot of the staged files, with a short note about why
git push                 # send your commits up to GitHub
```

And one more for pulling down changes made elsewhere (e.g. by Claude in a different session, or by you on another PC) — same folder:

```powershell
cd C:\Claude\community-bus-maps
git pull                 # fetch and merge the latest from GitHub into your local copy
```

That's genuinely most of it. A few things worth knowing so nothing surprises you:

- **`git status` is always safe to run** — it never changes anything, just reports.
- Run `git pull` before you start work if you think anything might have changed elsewhere; run `git status` before you *stop* work to make sure nothing's left uncommitted.
- **Never commit `.env` or anything under `data/`** — they hold secrets and real customer data and are already excluded via `.gitignore`, but double-check `git status` doesn't list them before you `git add -A`.
- When Claude Code does this for you in a session, it's running exactly these commands — nothing more mysterious happens. You can always ask it to show you the `git status`/`git log` output.

If you're ever unsure what a command will do, `git status` first and ask before anything that sounds destructive (`reset`, `checkout`, `clean`, `push --force`) — those can throw away work.

---

## 2. Start a local server on your laptop

This runs the portal *only on your own PC*, reachable at a `127.0.0.1` address that nothing outside your laptop can see. Same folder as always.

```powershell
cd C:\Claude\community-bus-maps
npm install                     # only needed once, or after pulling changes that touch package.json
copy .env.example .env          # only needed once — creates your local config file
npm run dev
```

Then open **http://127.0.0.1:5180** in your browser. Leave that PowerShell window open — the server keeps running there; **Ctrl+C** in that window stops it. `npm run dev` also **auto-reloads** when you save a code change, so you don't need to stop/start it while editing.

**Exception: `package.json`-only changes don't auto-reload.** The version badge in the footer (and anything else that reads `package.json` directly, like the app version) is only re-read when the server process restarts — and auto-reload only watches actual code files (`.js` files that get `import`ed), not `package.json` itself. So if you bump the version number, or change a dependency, and the page still shows the old value after a refresh, that's why. Fix it either by going to that PowerShell window and pressing **Ctrl+C**, then `npm run dev` again — or, without touching that window, force a reload from anywhere by "touching" a real code file so `--watch` notices a change:

```powershell
cd C:\Claude\community-bus-maps
(Get-Item src\server.js).LastWriteTime = Get-Date
```

That's a no-op edit (the file's content doesn't change, just its saved-at time), enough to make the running server restart and pick up the new `package.json`.

This is exactly the "Quick start" in [`README.md`](../README.md) — see that file for what the shopfront actually shows once it's up.

---

## 3. Set up test/demo data on your laptop

A fresh `npm run dev` shows an empty shopfront — no customers, no maps. To get something worth looking at (sample councils, maps, pending approvals, a public gallery), seed the demo data. **Stop the server first** (Ctrl+C) — the seed script and the server both write to the same database file, and only one thing can write at a time. This can be the *same* PowerShell window you just ran `npm run dev` in (Ctrl+C stops it and gives you the prompt back — no need to `cd` again), or a fresh one if you'd rather keep the server's window untouched:

```powershell
cd C:\Claude\community-bus-maps
$env:BUSES_DIR = "C:\u3a St Ives\Using AI\Buses"
node scripts/seed-demo.mjs
npm run dev
```

(`$env:BUSES_DIR = "..."` is PowerShell's way of setting an environment variable for the current window only — it's gone once you close it. Adjust the path if your Buses data folder moves.)

Now open **http://127.0.0.1:5180/app** — you'll be asked to sign in. Because there's no email service configured locally, **the sign-in link is printed in the PowerShell window running the server**, not emailed. Scroll that window to find it (or read the token from the database — §3a below).

### Who you can sign in as

There are no passwords anywhere — sign-in is an emailed one-time link, so an address in this list plus that link is the whole of it. These five are created by `seed-demo.mjs`; the only real person among them is you.

| Sign in as | Role | Sees |
|---|---|---|
| `peter@pcooper.me.uk` | **admin** | Everything: every organisation's maps, plus the **Admin** console and **Review** |
| `approver@busmaps.example` | **approver** | The review queue at **/app/review** — can inspect any map's print files, but not edit them |
| `clerk@broadmeadow-pc.example` | editor | Broadmeadow Parish Council (demo) — **0 maps**, the empty-dashboard state |
| `clerk@fenmarsh-dc.example` | editor | Fenmarsh District Council (demo) — **1 map** (March) |
| `coordinator@oakfield-ctt.example` | editor | Oakfield Community Transport Trust (demo) — **the rest**: St Ives, the High Wycombe Aldi place map, and the requested St Ives Waitrose map |

Each editor sees **only** their own organisation's maps — that's enforced on the server, not just hidden in the page, so it is worth signing in as two of them to see the difference. The admin and approver belong to no organisation: they are the platform side of the flow. [`README.md`](../README.md#set-up-the-multi-customer-demo-p2--p3--p4--p5) explains what each one is *for* and is worth reading once.

To check who actually exists in your database right now (roles change, and you may have added people), run this with the server up or down — it only reads:

```powershell
cd C:\Claude\community-bus-maps
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('./data/portal.sqlite',{readOnly:true});for(const r of db.prepare('SELECT u.id,u.email,u.role,u.status,c.name AS org FROM user u LEFT JOIN customer c ON c.id=u.customer_id ORDER BY u.id').all())console.log([r.id,r.email,r.role,r.status,r.org||'(platform)'].join('  |  '))"
```

Same quoting rule as §3a: **single quotes, never backticks.** This lists the **local** database only — the live site has its own users, which you read through the live Admin console, not from here.

To reset back to empty, delete the database file and start again (server stopped, same folder):

```powershell
cd C:\Claude\community-bus-maps
Remove-Item .\data\portal.sqlite* -ErrorAction SilentlyContinue
node scripts/seed-demo.mjs
```

---

## 3a. "EADDRINUSE" / I can't find the sign-in link

If `npm run dev` fails with `listen EADDRINUSE: address already in use 127.0.0.1:5180`, that's not
a real error — it means a server from an **earlier** PowerShell window is still running and already
serving the portal. The new window can't also bind port 5180. That's fine: the old one is the live
one, just use it at **http://127.0.0.1:5180** as normal.

The snag is that the sign-in link is only ever printed to that earlier window's console (see Part 3),
and you may not be able to find it — it's scrolled off, minimised, or Claude started it and you never
saw the window at all. You don't need to hunt for it. Read the token straight out of the database
instead, in a **fresh** PowerShell window (this doesn't disturb the running server):

```powershell
cd C:\Claude\community-bus-maps
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('./data/portal.sqlite',{readOnly:true});const row=db.prepare('SELECT token FROM magic_link WHERE used_at IS NULL ORDER BY rowid DESC LIMIT 1').get();console.log(row ? row.token : 'no unused token yet - submit the sign-in form first')"
```

1. In the browser, go to `http://127.0.0.1:5180/app` and submit the sign-in form with your email
   (`peter@pcooper.me.uk` for the admin account) as normal.
2. Run the command above — it prints the newest unused token.
3. Navigate the browser to `http://127.0.0.1:5180/auth/verify?token=<that token>` — you're signed in.

It also prints two lines about SQLite being "an experimental feature" — that is normal Node noise,
not a problem. The token is the long line of letters and numbers.

**Do not put backticks in that command.** An earlier version wrapped the SQL in `` ` `` … `` ` ``
(JavaScript template quotes) and it failed with `SyntaxError: missing ) after argument list`, because
the backtick is **PowerShell's escape character** — PowerShell eats it before Node ever sees it, and
the SQL arrives as bare, invalid JavaScript. Single quotes are safe: PowerShell passes them through
untouched, and JavaScript accepts them as string quotes.

No need to track down the other window, and no need to stop/restart the server to see console output.

---

## 4. Everyday development loop

All of this is one PowerShell window, `cd C:\Claude\community-bus-maps`, staying put:

1. `git pull` (pick up anything changed elsewhere).
2. `npm run dev` (leave it running — it auto-reloads on save).
3. Edit code, check it in the browser.
4. **Before trusting a change to the map renderer specifically**, read [`docs/DEVELOPING.md`](DEVELOPING.md) — it explains the "byte-identical" rule this whole product depends on, and lists the exact `npm run verify...` / `npm test` commands to run.
5. `git status` → `git add` the files you meant to change → `git commit -m "..."` → `git push`.

If you're working *with* Claude Code in a session, it will normally do steps 4–5 for you and tell you what it ran — you can always ask it to show `git status`/`git diff` before it commits.

---

## 5. Testing checklist before you call something "done"

Same folder again:

```powershell
cd C:\Claude\community-bus-maps
npm test       # the quick checks (public front, lifecycle, etc.)
npm run verify # only meaningful once FIXTURE_DIR/PLACE_FIXTURE_DIR are set in .env — see below
```

- `npm run verify` **only means something if `FIXTURE_DIR`/`PLACE_FIXTURE_DIR` are set in `.env`** to real fixture folders; otherwise it silently reports "skipping" and proves nothing. See `.env.example` for what those paths should point at.
- A quick look in the browser at the page you changed — the automated tests don't check what things look like.

---

## 6. Demonstrating it to someone else (without touching 20i)

Your current 20i package **cannot run this app** (see the note at the top). The simplest way to give someone else a link to click, at no cost, is a free Node-friendly host. **Render.com** is a reasonable default — no separate server to manage, deploys straight from your GitHub repo.

**Already have a Render account for something else? Use it — don't create a second one.** Each Render *service* is fully isolated: its own URL, environment variables, logs and disk, so this project can't see or interfere with your other one. Two things are genuinely **shared across your whole account** ("workspace"), worth knowing before you add a second free service to it:

- **750 free instance-hours per month, shared by every free service in the workspace.** A single service running flat-out is ~720 hours in a 30-day month, so two free services both seeing real traffic *could* jointly bump the cap — and Render then pauses **all** your free services until next month, not just the one that used the most. For an occasional demo (spins down after 15 minutes idle, see below) this is very unlikely to bite; it'd only matter if your other project's free service already runs close to continuously.
- **A 25-service cap on the free "Hobby" plan**, counted across everything in the account — only relevant if you're already close to that from other work.

Neither is a reason to avoid reusing the account for a low-traffic demo like this one — just give the new service a clearly different name from your other project so they're easy to tell apart in the dashboard. (The only case for a genuinely separate Render account is wanting this kept administratively distinct from the other project — different owner, different billing — not a technical requirement.)

**One-time setup:**

1. Make sure your latest work is pushed — same folder, same as always:
   ```powershell
   cd C:\Claude\community-bus-maps
   git push
   ```
2. Everything from here on happens in your **web browser** at render.com, not in PowerShell — there's no folder to be "in" for these steps. Sign in to your existing account (or create one if you don't have one yet — that's the only step that involves creating an account, do it yourself in the browser) and make sure it's connected to your GitHub account.
3. **New → Web Service** → pick the `PeterC66/community-bus-maps` repo.
4. Settings:
   - **Name:** something distinct from your other project (e.g. `community-bus-maps-demo`) — this becomes part of its `onrender.com` URL and how you tell the two apart in the dashboard.
   - **Build command:** `npm ci`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Add environment variables (Render's dashboard has a form for this — one per row, same names as in `.env.example`):

   | Key | Value |
   |---|---|
   | `PORT` | `10000` (Render sets its own `PORT`; leave this out and the app will use Render's) |
   | `HOST` | `0.0.0.0` |
   | `DATA_DIR` | `/opt/render/project/data` |
   | `PUBLIC_BASE_URL` | *(the `https://your-app.onrender.com` URL Render gives you)* |

6. Deploy. Once it's up, you can run the seed script **once** via Render's dashboard "Shell" tab (`node scripts/seed-demo.mjs` — you'll need to get a copy of the Buses data folder onto that box first, or just import a couple of specific maps with `import-map.mjs` instead, see [`README.md`](../README.md)).

**Two honest caveats with the free tier** (Render's own docs):

- It **spins down after 15 minutes with no visitors**, and takes about a minute to wake back up when someone next opens the link. Fine for "here's a demo," annoying for anything you want instantly responsive.
- The free tier's disk is **not persistent** — every restart/redeploy wipes it, which means your seeded demo database disappears too and needs re-seeding. If you want a demo that keeps its data between visits, that needs a **paid** instance with a persistent disk attached (check Render's current pricing) — worth it only once you're past "does this work" and into "let people poke at it over several days."

For anything beyond a demo — a real public site on your own domain, running continuously — the full production path (a proper Linux VM or container, backups, a restore drill) is [`docs/DEPLOY.md`](DEPLOY.md). That's also the path if you ever do upgrade 20i to their Node.js Optimised Cloud Server product instead of using Render.

---

## 8. Managing a change across laptop, GitHub, and the live site

This section exists because the portal now has a **real live site** (the actual BusMaps.uk, on a
VPS, with 13 real published maps) as well as your laptop. Before that existed, "commit and push"
was the whole story. Now there are three separate copies of the code, and it matters which one
you're changing. See [`docs/DEVELOPING.md`](DEVELOPING.md#three-separate-copies-of-the-code--none-of-them-update-each-other-automatically)
for the full table; here's what it means for what you actually do, day to day.

**The one fact that makes everything else make sense: pushing to GitHub never touches the live
site.** The live VPS only updates when someone deliberately logs into it and runs a pull + rebuild
(`docs/DEPLOY.md` §9) — a manual step, done on purpose, not a side-effect of `git push`. So almost
everything in Parts 1–5 of this guide is safe by default: it only ever reaches your laptop and
GitHub, never the public.

**The pattern this project actually uses is a branch + a Pull Request, not committing straight to
`main`** — every merged change so far (`gh pr list --state all`) came in this way. So for a piece of
work like a plan document's Part A/B items:

```powershell
cd C:\Claude\community-bus-maps
git checkout -b my-change-name     # once, at the start of the work
# ... edit, test locally with npm run dev ...
git add <files>
git commit -m "..."                # as many small commits as you like, this only touches your laptop
git push -u origin my-change-name  # sends the BRANCH to GitHub — main is untouched, live site is untouched
```

Answers to the two things you asked directly:

- **"Should I commit but not push?"** Commit as often as you like — a commit only ever touches your
  laptop, so there's no reason to hold back. Pushing the *branch* is also safe (it can't reach the
  live site and doesn't change `main`), and it's the only way to get the work backed up off your
  laptop or opened as a PR, so there's little reason to delay that either. The one step worth
  treating as a deliberate decision is **merging the branch into `main`** — not because it's
  dangerous (it still doesn't touch the live site), but because `main` is the shared, canonical
  history and once a PR is merged, un-merging it is more friction than not merging yet. In this
  session, Claude will open the PR but check with you before merging.
- **"Can I view a portal on a branch before merging?"** Yes — and it's the normal way to check work,
  not a special trick. `git checkout my-change-name` then `npm run dev` runs that branch's code as a
  complete local portal at `127.0.0.1:5180`, using your own local database. There's no separate
  "preview URL" per branch (that would need a hosting setup this project doesn't have) — the
  laptop *is* the preview environment. It's fully isolated: nothing you do there can affect the live
  site, GitHub, or any other branch.

What never happens without you explicitly asking for it, in this or any session:

- **Deploying to the live VPS** (`docs/DEPLOY.md` §9's `git pull && docker compose up -d --build`
  on the actual server) — that's the step that reaches real visitors and real published maps.
- **Force-pushing, or anything that rewrites history already on GitHub.**
- **Merging a PR into `main`** without confirming with you first, for the "shared history" reason
  above — even though it's technically reversible and doesn't deploy anything.

## 9. Map of the other docs — read them when you need to go deeper

| Doc | Read it when... |
|---|---|
| [`README.md`](../README.md) | you want the full picture: what the product does, the demo walkthrough in more detail, the file layout |
| [`docs/DEVELOPING.md`](DEVELOPING.md) | **before changing any code** — the determinism rule, the three approval gates, which test commands to run and why `verify` can lie to you |
| [`docs/DEPLOY.md`](DEPLOY.md) | you're moving from "demo" to "real production hosting somewhere" — persistence, backups, the restore drill, upgrading |
| [`docs/H1-operations-handbook.md`](H1-operations-handbook.md) + `R1`–`R6-*.md` | the service is live and you're running day-to-day: onboarding a customer, publishing, handling an incident |
| [`docs/LICENSING.md`](LICENSING.md) | before announcing anything publicly — the OSM/BODS attribution and terms review |
| [`CHANGELOG.md`](../CHANGELOG.md) | "what changed and when" |

---

## Cheat sheet

Everything here is one folder (`cd` there once, stay put — re-run the `cd` if you open a fresh PowerShell window):

```powershell
# Start working
cd C:\Claude\community-bus-maps
git pull
npm run dev                       # http://127.0.0.1:5180 — Ctrl+C to stop

# Seed demo data (server must be stopped first)
$env:BUSES_DIR = "C:\u3a St Ives\Using AI\Buses"
node scripts/seed-demo.mjs

# Save your work
git status
git add -A
git commit -m "describe what changed and why"
git push

# Before trusting a render change
npm test
npm run verify
```
