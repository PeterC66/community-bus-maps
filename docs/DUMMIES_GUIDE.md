# The Dummy's Guide — developing, testing, and demonstrating the portal

You know cmd/PowerShell, FTP and GitHub already. This guide fills the gap: the handful of
**git** and **node** commands you need, how to run the portal on your own laptop, and how to
show it to someone else without touching your 20i webspace.

It deliberately repeats nothing that's explained well elsewhere — each section says which of
the existing docs to read for the deeper version.

**One-time fact worth knowing:** your 20i package is standard shared hosting (FTP +
phpMyAdmin). 20i confirms Node.js apps only run on their separate *"Node.js Optimised Cloud
Server"* product — ordinary shared hosting can't run this app at all. So "demonstrate it live"
and "your 20i webspace" are two different things for this project (see Part F).

---

## 0. What's already on your laptop

Already installed and working — nothing to set up:

| Tool | Version found | What it's for |
|---|---|---|
| Node.js | v24.14.0 | runs the portal (it's a JavaScript program, not a website of static files) |
| npm | 11.9.0 | installs the portal's dependencies, and runs its scripts (`npm run dev`, `npm test`, …) |
| Git | 2.53.0 | tracks changes to the code, talks to GitHub |

The project already lives at `C:\Claude\community-bus-maps`, its `main` branch already tracks
`https://github.com/PeterC66/community-bus-maps` on GitHub, and the working copy is currently
clean (no uncommitted changes). You don't need to "install" or "clone" anything to get started.

---

## 1. The bare minimum git you actually need

You know GitHub (the website) already. Git is the *command-line tool* that talks to it. Four
commands cover almost everything you'll do yourself:

```powershell
git status              # "what's changed since the last commit?" — run this often, it's always safe
git add <file>           # "stage" a changed file, ready to commit (or: git add -A for everything)
git commit -m "message"  # save a snapshot of the staged files, with a short note about why
git push                 # send your commits up to GitHub
```

And one more for pulling down changes made elsewhere (e.g. by Claude in a different session,
or by you on another PC):

```powershell
git pull                 # fetch and merge the latest from GitHub into your local copy
```

That's genuinely most of it. A few things worth knowing so nothing surprises you:

- **`git status` is always safe to run** — it never changes anything, just reports.
- Run `git pull` before you start work if you think anything might have changed elsewhere; run
  `git status` before you *stop* work to make sure nothing's left uncommitted.
- **Never commit `.env` or anything under `data/`** — they hold secrets and real customer data
  and are already excluded via `.gitignore`, but double-check `git status` doesn't list them
  before you `git add -A`.
- When Claude Code does this for you in a session, it's running exactly these commands — nothing
  more mysterious happens. You can always ask it to show you the `git status`/`git log` output.

If you're ever unsure what a command will do, `git status` first and ask before anything that
sounds destructive (`reset`, `checkout`, `clean`, `push --force`) — those can throw away work.

---

## 2. Start a local server on your laptop

This runs the portal *only on your own PC*, reachable at a `127.0.0.1` address that nothing
outside your laptop can see.

```powershell
cd C:\Claude\community-bus-maps
npm install                     # only needed once, or after pulling changes that touch package.json
copy .env.example .env          # only needed once — creates your local config file
npm run dev
```

Then open **http://127.0.0.1:5180** in your browser. Leave that PowerShell window open — the
server keeps running there; **Ctrl+C** in that window stops it. `npm run dev` also
**auto-reloads** when you save a code change, so you don't need to stop/start it while editing.

This is exactly the "Quick start" in [`README.md`](../README.md) — see that file for what the
shopfront actually shows once it's up.

---

## 3. Set up test/demo data on your laptop

A fresh `npm run dev` shows an empty shopfront — no customers, no maps. To get something worth
looking at (sample councils, maps, pending approvals, a public gallery), seed the demo data.
**Stop the server first** (Ctrl+C) — the seed script and the server both write to the same
database file, and only one thing can write at a time:

```powershell
$env:BUSES_DIR = "C:\u3a St Ives\Using AI\Buses"
node scripts/seed-demo.mjs
npm run dev
```

(`$env:BUSES_DIR = "..."` is PowerShell's way of setting an environment variable for the current
window only — it's gone once you close it. Adjust the path if your Buses data folder moves.)

Now open **http://127.0.0.1:5180/app** — you'll be asked to sign in. Because there's no email
service configured locally, **the sign-in link is printed in the PowerShell window running the
server**, not emailed. Scroll that window to find it. The seeded people to sign in as, and what
each one can do, are listed in [`README.md`](../README.md#set-up-the-multi-customer-demo-p2--p3--p4--p5)
— worth reading once.

To reset back to empty, delete the database file and start again:

```powershell
Remove-Item .\data\portal.sqlite* -ErrorAction SilentlyContinue
node scripts/seed-demo.mjs
```

---

## 4. Everyday development loop

1. `git pull` (pick up anything changed elsewhere).
2. `npm run dev` (leave it running — it auto-reloads on save).
3. Edit code, check it in the browser.
4. **Before trusting a change to the map renderer specifically**, read
   [`docs/DEVELOPING.md`](DEVELOPING.md) — it explains the "byte-identical" rule this whole
   product depends on, and lists the exact `npm run verify...` / `npm test` commands to run.
5. `git status` → `git add` the files you meant to change → `git commit -m "..."` → `git push`.

If you're working *with* Claude Code in a session, it will normally do steps 4–5 for you and
tell you what it ran — you can always ask it to show `git status`/`git diff` before it commits.

---

## 5. Testing checklist before you call something "done"

- `npm test` — the quick checks (public front, lifecycle, etc.)
- `npm run verify` — **only meaningful if `FIXTURE_DIR`/`PLACE_FIXTURE_DIR` are set in `.env`**
  to real fixture folders; otherwise it silently reports "skipping" and proves nothing. See
  `.env.example` for what those paths should point at.
- A quick look in the browser at the page you changed — the automated tests don't check what
  things look like.

---

## 6. Demonstrating it to someone else (without touching 20i)

Your current 20i package **cannot run this app** (see the note at the top). The simplest way to
give someone else a link to click, at no cost, is a free Node-friendly host. **Render.com** is a
reasonable default — no separate server to manage, deploys straight from your GitHub repo.

**One-time setup:**

1. Make sure your latest work is pushed: `git push` (from §1).
2. Create a free account at render.com and connect your GitHub account to it (this is the one
   step that involves creating an account — do that part yourself in the browser).
3. **New → Web Service** → pick the `PeterC66/community-bus-maps` repo.
4. Settings:
   - **Build command:** `npm ci`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Add environment variables (Render's dashboard has a form for this — one per row, same names
   as in `.env.example`):

   | Key | Value |
   |---|---|
   | `PORT` | `10000` (Render sets its own `PORT`; leave this out and the app will use Render's) |
   | `HOST` | `0.0.0.0` |
   | `DATA_DIR` | `/opt/render/project/data` |
   | `PUBLIC_BASE_URL` | *(the `https://your-app.onrender.com` URL Render gives you)* |

6. Deploy. Once it's up, you can run the seed script **once** via Render's dashboard "Shell" tab
   (`node scripts/seed-demo.mjs` — you'll need to get a copy of the Buses data folder onto that
   box first, or just import a couple of specific maps with `import-map.mjs` instead, see
   [`README.md`](../README.md)).

**Two honest caveats with the free tier** (Render's own docs):

- It **spins down after 15 minutes with no visitors**, and takes about a minute to wake back up
  when someone next opens the link. Fine for "here's a demo," annoying for anything you want
  instantly responsive.
- The free tier's disk is **not persistent** — every restart/redeploy wipes it, which means your
  seeded demo database disappears too and needs re-seeding. If you want a demo that keeps its
  data between visits, that needs a **paid** instance with a persistent disk attached (check
  Render's current pricing) — worth it only once you're past "does this work" and into
  "let people poke at it over several days."

For anything beyond a demo — a real public site on your own domain, running continuously — the
full production path (a proper Linux VM or container, backups, a restore drill) is
[`docs/DEPLOY.md`](DEPLOY.md). That's also the path if you ever do upgrade 20i to their Node.js
Optimised Cloud Server product instead of using Render.

---

## 7. Map of the other docs — read them when you need to go deeper

| Doc | Read it when... |
|---|---|
| [`README.md`](../README.md) | you want the full picture: what the product does, the demo walkthrough in more detail, the file layout |
| [`docs/DEVELOPING.md`](DEVELOPING.md) | **before changing any code** — the determinism rule, the three approval gates, which test commands to run and why `verify` can lie to you |
| [`docs/DEPLOY.md`](DEPLOY.md) | you're moving from "demo" to "real production hosting somewhere" — persistence, backups, the restore drill, upgrading |
| [`docs/OPERATIONS-HANDBOOK.md`](OPERATIONS-HANDBOOK.md) + `runbook-*.md` | the service is live and you're running day-to-day: onboarding a customer, publishing, handling an incident |
| [`docs/LICENSING.md`](LICENSING.md) | before announcing anything publicly — the OSM/BODS attribution and terms sign-off |
| [`CHANGELOG.md`](../CHANGELOG.md) | "what changed and when" |

---

## Cheat sheet

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
