# Developing the portal — how to change it safely

<!-- docstamp v1.23 | 2026-09-02 | sha=6c44135f -->
**v1.23** · updated 2 September 2026

This is the **developer** counterpart to the operator documentation. The [Operations Handbook](H1-operations-handbook.md) and the runbooks tell you how to *run* the service; this tells you how to *change* it without breaking the two things the product rests on: the deterministic render, and the approval gates.

`README.md` covers architecture and quick start — read that first. Start here when you are about to edit code.

## Three separate copies of the code — none of them update each other automatically

This section didn't exist in earlier drafts of this doc, written before there was a live host. There now are **three distinct places** code can be, and moving between them is always a deliberate, manual step — never automatic:

| Copy | Where | Who can see it | How it gets updated |
|---|---|---|---|
| **Your working copy** | `C:\Claude\community-bus-maps` on the laptop | only you, and only while `npm run dev` is running (`127.0.0.1:5180`) | you edit files directly |
| **GitHub `main`** (+ other branches) | `github.com/PeterC66/community-bus-maps` | anyone with repo access; it's the shared history | `git push` from the laptop, or merging a PR on GitHub |
| **The live VPS** | OVHcloud, serves the real public site with 13 real published maps (`docs/DEPLOY.md` §9) | the public, once DNS/Caddy is pointed at it | someone runs `git pull && docker compose up -d --build` **on the VPS itself**, by hand |

The important consequence: **`git push` does not deploy anything.** Pushing a branch, or even merging a PR into `main`, only changes what's stored on GitHub. The live VPS keeps running whatever was last pulled onto it until a person logs in and pulls again — there is no CI/CD hook, no webhook, no auto-deploy. That gap is deliberate at this stage (pilot, one operator, no customers depending on zero-downtime rollout) but it means you cannot reason about the live site from `git log` alone — check `docs/DEPLOY.md` §9 for what's actually been pulled onto the VPS, or ask before assuming a merged change is live.

Practically, this makes ordinary git operations lower-risk than they'd otherwise be: pushing a branch, or opening/merging a PR, cannot break the public site by itself — that only happens at the separate, manual VPS deploy step. It also means **there is no "preview URL per branch."** To see what a branch looks like running, `git checkout` it on the laptop and `npm run dev` — that's a full working portal, just local to you, using your own local `data/portal.sqlite` (empty until you seed it, see `DUMMIES_GUIDE.md` Part 3). It cannot affect the live site or anyone else's laptop.

See [`docs/DUMMIES_GUIDE.md`](DUMMIES_GUIDE.md#8-managing-a-change-across-laptop-github-and-the-live-site) for the plain-language walkthrough of what to commit, push, and merge when, and what never happens without being asked.

> **The system is a PILOT.** It is feature-complete but has **no customers** — every organisation in the database is seeded demo data and every published map is one of ours. Every page carries a banner and every rendered sheet a band saying so, gated on one env var. Two consequences for you: the render path has a post-generation step you need to know about (see *The gates you must run*), and **you must not write copy that claims customers, uptime or response times**. Read [`PILOT.md`](PILOT.md) before touching the render path, the public copy or the seed script.

---

## The two things you must not break

### 1. Determinism

Given a map's data + config + a customer's overrides, the engine must produce **byte-identical** output every time, with **no network access and no AI**. Everything else in the product is built on that promise: customers self-serve edits, the server re-renders untrusted input, and a print file is reproducible months later.

Concretely, in any engine or render code:

- No timestamps, no `Math.random`, no locale-dependent formatting, no reliance on filesystem ordering in anything that reaches the SVG.
- No `fetch`/network at render time. Everything a map needs is baked into its payload at import.
- **Absent config ⇒ previous behaviour.** Every new feature is opt-in via a config key and must be byte-identical when the key is missing. This is what lets a new capability ship without re-validating every existing map.

The pilot band is the worked example of doing this *without* touching the engine: it is applied to the finished SVG in `src/render/renderMap.js` **after** the generator has run, so the generator's own bytes are unchanged and the determinism gate still tests determinism. If you need to add something to every sheet, copy that pattern rather than editing generators — they are vendored per-map (below), so editing `engine/` would not change a single existing map anyway. `src/render/badgeContrast.js` is the second one (a route number must stay readable on a recoloured badge), and it shows the other half of the discipline: a post-generation fix must be a **no-op on a sheet that does not have the fault**, so an untouched map is still byte-for-byte what the generator produced. Both have a companion `scripts/*.mjs` that applies them to sheets already in the object store, because a fix at render time reaches nothing that was rendered before it landed.

### 2. The three approval gates

Nothing reaches the public without a human. Don't add a code path that routes around these:

| Gate | Where | What it enforces |
|---|---|---|
| **Organisation approval** | application → pending account → admin approve | only vetted orgs get in |
| **Map request + quota** | `src/db` map-request lifecycle, server-enforced quota | a customer can't mint unlimited maps |
| **Publish review** | `src/publish` — draft/published two-pointer, approver checklist, audit | no draft becomes a published/printable map without a reviewed approver |

Note also that **publish ≠ public**. A published map only appears on the public front when the customer's own `map.public_listed` switch is on, the customer is active, and the map is published — all three enforced in SQL in `src/public/`.

---

## The engine is vendored, not imported

The map generators are **maintained in a separate authoring toolchain** (the "skill" side, which also does the data fetching, area onboarding and monthly refresh — the judgement-heavy work that deliberately does not live in this repo). This repo holds **byte-for-byte copies**.

| Location | What | Who owns it |
|---|---|---|
| `engine/` | `render.js`, `icons.js` — the shared rasteriser and icon paths | copied from the authoring toolchain |
| `engine/place/` | the place engine, copied into each place map's `data/` at import, plus the portal's `gen_internal_place.js` wrapper | two copied, one portal-owned |
| `engine/expert/` | the schematic + diagram pre-stages, plus the portal's two wrappers | two copied, two portal-owned |
| *(not vendored)* | area generators — these travel **with each map's data** in the object store | per-map |

Each of those folders has its own `README.md` explaining the provenance and why it is arranged that way. Read the relevant one before touching anything in it.

**Consequence:** if the authoring toolchain's engine changes, this repo keeps running the old code until someone re-copies the files and re-runs the gates. There is no automated drift check. When you re-vendor, re-run every gate below and note it in `CHANGELOG.md`.

### The generator env contract

All generators, vendored or per-map, are driven the same way:

| Variable | Meaning |
|---|---|
| `LEAFLET_DIR` | the folder holding the map's data — all inputs read from here, SVG written here. **Preferred over cwd.** |
| `SKILL_ASSETS` | where `icons.js` resolves from (falls back to a sibling `icons.js`) |
| `OVERRIDES_FILE` | the customer's saved safe-subset edits. **Absent or empty ⇒ byte-identical baseline.** |
| `EDITOR_KEYS` | editor-support keys emitted into the SVG |
| `LEAFLET_SHEET_VERSION` | the version printed in the footer band. **Overrides** `design.sheetVersion` in the map's own `routes.json`. Absent ⇒ whatever the data says, which is what the reproduce gates rely on. |

**The `LEAFLET_DIR` trap.** The schematic and diagram pre-stages spawn `gen_internal.js` with `cwd` set to a workspace and an inherited environment. Because `gen_internal.js` prefers `LEAFLET_DIR` over `cwd`, an inherited value sends that render back to the parent folder and **silently produces the ordinary geographic map** under the expert style's filename. The wrappers in `engine/expert/` delete it for the child and pass everything else through. If you write a new pre-stage or wrapper, do the same. Symptom: an expert sheet that looks exactly like the plain internal map.

### The printed sheet version — three states, one line

A sheet has to say which version it is, and **where the reader got it decides which answer is right** (Peter's review item 6). The engine prints one line in the footer band beside the QR; a bare number gets the words `Map version` in front of it and anything else prints verbatim, so one string covers all three cases:

| The sheet came from | It prints | Set by |
|---|---|---|
| the skill, before it ever reached the portal | `build 6.54 · 19 Aug 2026` | `rollout.js`, into the run's own `routes.json` |
| this portal, rendered | `Map version 5.0` | `renderVersion()` → `generateSvg({ sheetVersion })` |
| this portal, downloaded before it is published | `Draft 5.0 · 19 Aug 2026 14:02` | `src/render/draftStamp.js`, at download time |
| the editor's live preview | `Preview — unsaved` | `previewFrom()` |

**Why the state is added on the way out and not baked into the render.** A version is always a draft at the moment it is rendered, and **publishing does not re-render** — approving a publish request flips `review_state` and moves the map's pointer, and the bytes the approver signed off are the bytes that go public. So the render can only carry what is true in *both* states, which is the plain number. Baking in "Draft" would make every published sheet lie, and the two ways round that are both worse: re-rendering on publish means the reviewed artwork is not the published artwork, and rewriting the stored file in place puts a new failure mode inside the publish transaction.

So the marking is derived at download time on the **authenticated per-version route** (`/api/maps/:id/versions/:key/:file`) — the only route that serves versions other than the published one — cached beside the source and never written over it, the same contract as the public watermark. `/api/public/maps/:slug/:file` serves the reviewed bytes untouched.

**If you touch `draftStamp.js`, key its cache on the LABEL.** `watermark.js` keys on the source's mtime alone, which is right there because its overlay never changes. A version's `review_state` *does* change while the render sits untouched, so an mtime-only cache serves the first state's file for ever. That was the first cut, it passed every happy-path check, and `npm run test:sheet-version` exists because of it — it asks for three states in a row.

---

## Conventions

Flag names, exit codes, which stream carries what, how a mutating script asks permission, the naming rule and the Node pin are all settled in one place: [`docs/CONVENTIONS.md`](CONVENTIONS.md). Read it before writing a new script in `scripts/`.

## The gates you must run

```bash
npm run verify:area     # area map reproduces a shipped leaflet byte-for-byte
npm run verify:place    # same for a place map
npm run test:p7         # expert styles (schematic + diagram), 6 gated outputs
npm run test:lifecycle  # request → build → publish → revert lifecycle
npm run check:vendored  # engine/ still matches what it was vendored from
npm test                # the whole suite - it prints its own count and timings
```

### `npm test` discovers its tests - adding one means adding the file

`npm test` runs [`scripts/run-tests.mjs`](../scripts/run-tests.mjs), which **globs `scripts/test-*.mjs` and `scripts/prove-red-*.mjs`** and runs every one of them. Until 2026-09-02 it was a 36-command `&&` chain in `package.json`, and that chain had three faults the runner exists to remove. It stopped at the first failure, so one red test hid every test after it. Nothing tied it to the files on disk, and four of the thirty-seven had drifted out of it unnoticed. And it named each invocation a second time, so a chain entry that forgot `--env-file-if-exists=.env` would have run a different command under the same name - which is why the runner takes each file's command **from the `package.json` script that owns it** rather than rebuilding it.

So **adding a test is adding the file**. Give it an npm script too (`test:<thing>`), because that script is what the runner invokes and what you will want when running it alone; the runner names any file that has no script, in case that was an oversight rather than a choice.

**A test that cannot run here needs an entry in the runner's `EXCLUDED` map with a reason that says where it DOES run** - the two current entries need `BUSES_DIR` and run in `verify.yml`. The runner refuses to start (exit 2) on an exclusion with no reason or one naming a file that is no longer there, so an exclusion cannot quietly become a hole. Exit codes are the house rule: 0 ok, 1 a test failed, 2 the runner was used wrongly.

The runner is itself falsified by [`scripts/prove-red-run-tests.mjs`](../scripts/prove-red-run-tests.mjs) (`npm run test:prove-red-run-tests`), which runs FIRST in `test.yml` for the usual reason: a bug in the thing that decides whether the suite is green does not make one test wrong, it makes the whole verdict wrong in the reassuring direction. Six cases on scratch repositories plus two controls, ~3 s.

### Re-stamp a document you edited BEFORE you commit it — and a hook now refuses if you forget

The docstamp is written by a **Stop hook**, which by definition runs at the *end* of a turn. So a commit made **during** the turn carries the new content and the **old** `sha=`, and the `status` job's *Committed docstamps describe their committed content* step correctly calls it stale. Whether a given commit goes red depends only on where the turn boundary fell, which is why it looks intermittent and why it is not. It has already happened here — the commit *"Docstamp: three committed stamps did not describe their committed content"* (#149) is exactly this fault, three documents' worth, caught by CI after the push rather than before it. In the sibling `buses-data` repo the same fault took 10 of 15 gates runs red in a single day.

Re-stamp first, then `git add` the document **and** its stamp together. Run this from the repository root; the path is a real path on this machine, not a placeholder:

```bash
python "C:/Users/Peter/.claude/skills/stamp-docs/scripts/docstamp.py" --all
```

`.githooks/pre-commit` refuses the commit if you forget. It checks **only the `.md` files in the commit in front of you** — a document that was already stale is not this commit's fault, and a hook that blocks unrelated work gets `--no-verify`'d within a week. It exits 0 when the `stamp-docs` skill tree is absent, because that tree is not part of this repository and a hook that dies on someone's laptop teaches them to bypass it.

**`core.hooksPath` is local git config and does not travel with a clone**, so every clone and every worktree has to opt in once, from the repository root, with no placeholders:

```bash
git config core.hooksPath .githooks
```

That is also why CI keeps its own full audit rather than trusting the hook: the hook guards whoever installed it, CI is the one that is always there.

**One behaviour to expect, because it looks like the hook failing and is not.** The Stop hook restamps the working tree between turns, so a document you staged with a stale stamp can become *self-consistent* on its own — and the same commit that was refused will then be accepted. That is correct (the stamp now does describe the staged content) but it means **the refusal is not a durable veto on the content**: it is a veto on the mismatch. If the hook refuses you, re-stamp and re-add deliberately rather than simply retrying the commit.

### The inlined SVG is allowlisted, and adding to the artwork means adding to the list

`src/public/svgSanitise.js` keeps eight elements and 38 attributes — a census of what the generators actually draw — and removes everything else, counting what it removed. If the engine starts emitting something new (a `<tspan>`, a gradient, a `style` attribute), the web view will silently lose it and `scripts/test-inline-svg.mjs` will go red on the fixture corpus. That is the intended prompt: widen the allowlist deliberately, in that file, and re-run `npm run test:svg`. Do **not** widen it to `style` or to any URL-valued attribute without saying why in the Caddyfile's CSP block, which reasons about exactly this sink.

### `engine/` is vendored, and `engine/vendored.json` is the list

Every `.js` file under `engine/` is either a byte-for-byte copy of a file in one of the two map skills or a portal-owned wrapper, and `engine/vendored.json` says which, with a hash. `npm test` runs `scripts/test-vendored.mjs`, which fails on an edited copy, a missing one, or a file the manifest does not name — so vendoring something new means classifying it, not just copying it. After a deliberate re-vendor run `node scripts/check-vendored.mjs --update` from the repository root and commit the manifest with the file. Run `npm run check:vendored` with no flags on a machine that also has the skill trees and it additionally tells you whether the SOURCE has moved on; in CI that half is skipped and says so. See [`../engine/README.md`](../engine/README.md).

**Adding a file to the vendored set is a command, not a hand-edit** (2026-09-02, OA-224 Tier 3.6). When a vendored generator starts requiring a module the portal has never been given, `check-vendored` reports it `UNRESOLVED` and now prints the exact command to fix it, run from the repository root: `node scripts/vendor-engine.mjs --add <engine/path.js> --source <path under the skill root>`. It writes the manifest row, copies the file, and lets `restampManifest()` fill in the SHA-256 from the bytes that landed — the hash is never typed, which matters because a hash is the one thing in this repository nobody can check by eye. It refuses a `--source` the skill tree does not have (exit 3) and a path that already has a row (exit 2). Where the skill trees are present it resolves the source by looking; where they are not it offers the likely paths and says the source is unverified, because a guess printed as a fact is how a wrong `source` gets committed, and a wrong `source` makes `DRIFTED` mean nothing for that row for ever.

**Where the skill trees are is `SKILL_ROOT` in `.env`**, documented in `.env.example`, and `npm run check:vendored` and `npm run vendor:engine` load `.env` so they can see it. Until 2026-09-02 it was `skillRootDefault` inside `engine/vendored.json` — one laptop's absolute path, tracked into a repository that also runs on a VPS and in CI.

### Which pack `verify` gates, and the per-machine `.env` keys that change it

**You do not have to set anything.** `scripts/lib/fixtures.mjs` resolves a COMMITTED fixture — `Areas/_portal-fixture/<Town>` and `Places/_portal-fixture/<Place>` in the buses-data repo — from `BUSES_DIR` or from a buses-data checkout sitting beside this one, and when it can find nothing at all the gate **fails** rather than skipping. It used to print "skipping" and exit 0, which is how a fresh clone, a CI run and a second developer all got a green result from a gate that had never executed (technical-audit_2026-08-19, finding V2); `npm run verify -- --allow-skip` is the one remaining way to get a green board without proving anything, and it says so in capitals. The committed fixture is what `verify.yml` gates in CI.

**`FIXTURE_DIR` and `PLACE_FIXTURE_DIR` in `.env` override that pack, and are per-machine.** `.env` is git-ignored, so this is a step every clone and every laptop does for itself; `.env.example` carries the full form of both keys. Point `FIXTURE_DIR` at a live `Areas/<Town>/S5-render/<version>` folder and the local gate becomes **stronger** than CI's — that tree is where a real regression surfaces first — which is why the environment wins over the committed fixture rather than the other way round. It may be a `;`-separated list (`;`, not `:`, because these are Windows absolute paths): `verify:area` takes the first entry, and `verify:defaults` needs all three towns, because no single town exercises all thirteen escape hatches.

**The catch is that those paths carry a version number, so they go stale at every rollout, and until 2026-08-30 nothing read them.** This laptop gated `St Ives/S5-render/v6.55_2026-08-24_1603` for six days after the committed fixture was refreshed from `v6.59` — same `npm run verify`, two machines, two different packs, no message (OA-180). The resolver now compares the two packs' `build-meta.json` and prints a `⚠ … is BEHIND the committed fixture` block naming both `builtAt` stamps whenever the env entry is the older one. It is a warning and not a failure, because aiming at the live tree is a legitimate choice; what failed was the silence. It stays quiet when the env entry is newer (the normal state between a rollout and the next fixture refresh), and it says *cannot tell* out loud rather than nothing when a pack has no `build-meta.json` to compare.

**Since 2026-09-01 you do not have to repoint it at all, because the entry names the TOWN (OA-211).** A warning is not a guard: this one was accurate, prominent and ignorable, the run went red afterwards anyway, and that trains a reader to skip a red on the one gate whose whole job is to be believed. The evidence is that it recurred inside a day — `.env` was repointed at three current renders on the morning of 2026-09-01, and the landmark-chooser rollout had made all three stale again by that evening. So an entry shaped `Areas/<Town>/S5-render/<version>` is now read as naming that town, and the resolver gates the town's **current** render, taken from its `manifest.json` (`stages.S5.latest`) and never from a directory listing sorted as strings — `v6.9` sorts after `v6.67` that way, and that bug has already shipped twice. The substitution is **printed**, because a verification tool that swaps its own input without saying so is a check that lies about what it read. Nothing in `.env` needs editing after a rollout any more, and the version left in the path is now inert.

**It only ever moves forward, and only inside the live render tree the env variable already chose** — which is what preserves the property the override exists for. It is not a fallback to the committed pack. Everything it cannot place is passed through exactly as written and still reaches the `BEHIND` warning above: no `manifest.json`, a `latest` the manifest lists no folder for, a run folder that is not on this disk (`S5-render/` is gitignored, so a fresh clone has none), or a path with no `S5-render` segment at all — which is why `PLACE_FIXTURE_DIR`, pointing straight at a committed `_portal-fixture` pack, is untouched. The first two say out loud why they could not resolve; the last two are correct silences.

Run the gate from the repository root (`C:\Claude\community-bus-maps`), with no placeholders:

```bash
npm run verify:area
```

Confirm the output names the fixture you expect, says `source : $FIXTURE_DIR`, and ends in PASS with byte counts. Both halves share one falsification harness — `npm run test:prove-red-fixture-drift`, run from the same folder, **thirteen** scratch trees, no fixture repository needed. It requires the warning to fire on a stale path and stay silent on the five shapes that do not deserve it, and the resolution to advance an entry on exactly one of its six trees while leaving the other five alone.

### The post-generation sheet fixes and the reproduce gates

`generateSvg()` post-processes the finished SVG unless you pass `stamp: false` — badge contrast (`src/render/badgeContrast.js`) then the pilot band (`src/render/pilotStamp.js`). The two `verify-reproduce*` scripts pass it, because they compare the **generator's** output against a shipped fixture — they test determinism, not presentation.

**If `verify` suddenly reports the SVG DIFFERS by a few hundred bytes, check that first.** The fix is never to disable the stamp globally: if a verify script has lost its `stamp: false`, restore it; if it still differs with the stamp off, the generator genuinely changed and the section below applies.

Sheets already in the object store keep whatever band they were rendered with — `node scripts/restamp-renders.mjs` (add `--apply`) brings them into line, in either direction.

### When a gate legitimately fails

If output changed *on purpose*, the shipped fixture is now stale. Re-render the fixture from the new engine, re-import it, and record why in `CHANGELOG.md`. **Never relax a gate's expectation to make it pass** — the gate is the product's core claim.

---

## Where things live

`README.md` has the full layout. The parts you're most likely to need:

| I want to change… | Start in |
|---|---|
| How a map is rendered / which outputs exist | `src/render/renderMap.js`, `src/maps/store.js` (`resolveGen`, `engine:` tags) |
| What a customer is allowed to edit | `src/maps/engine.js` + the safe-subset validation — **server-enforced; never trust the client** |
| Which outputs a customer may switch | `chooseOutputs()` in `src/maps/engine.js` — pure, so `test-p7.mjs` asserts the rules without a server. The tube-map diagram is `requestOnly` (hand-pinned, priced separately): a non-admin PATCH asking for it is **403**, not a silent no-op |
| The publish gate / review checklist | `src/publish/` (pure functions — unit-testable) |
| A review-and-publish route (the queue, approve, reject, published history, revert) | `src/routes/review.js` — a Fastify plugin under `/api/review` with ONE plugin-level approver guard, the same shape as the admin console. `scripts/test-review-plugin.mjs` asserts the door on every route in the live table, and `scripts/prove-red-review-plugin.mjs` breaks that guard three ways so the suite has been seen to go red |
| An admin-console route | `src/routes/admin.js` — a Fastify plugin under `/api/admin` with ONE plugin-level guard, so a route added there is admin-only without saying so; declare an exception as route config (`GET /worklist` and the operator token are the only one). `scripts/test-admin-plugin.mjs` asserts the door on every route in the live table |
| A guard or a small request helper (`str`, `parseJson`, `baseUrl`, `requireUser`, `requireStepUp`, `operatorRead`) | `src/http/helpers.js` — the route files import these rather than closing over `server.js`'s scope (OA-231) |
| What the signed-in app is told about one map (`mapDetail()`), or how a route loads a map it may edit or read | `src/maps/detail.js` — shared by the editor, review and monthly-refresh routes, moved out before those sections are cut into their own files |
| The set of routes the app registers | `scripts/route-table.json`, recorded from the app itself; `test-admin-plugin.mjs` fails on a route gained or lost, so a deliberate change to the table means re-recording it with `node scripts/test-admin-plugin.mjs --record` from the repository root and committing the file with the route |
| Monthly change acceptance (accept/decline a proposed update) | `src/refresh/` + `scripts/propose-update.mjs` |
| Auth / sessions | `src/auth/` (magic link, server-side sessions, hand-rolled cookies, no deps) |
| Public pages and listings | `src/public/` — a **read model** over the publish gate, PII-free by construction |
| Per-customer branding | `src/branding/` — a server-enforced whitelist. It decorates the **page**, not the printed sheet |
| The diagram pin editor | `src/expert/` + `public/app/diagram.js` (admin-only). Handles are drawn in the **sheet's** frame, not the solver's — `measureHandleFrame()` recovers the difference by fitting the tagged stop ticks; don't re-derive the generators' transforms by hand |
| Badge legibility after a recolour | `src/render/badgeContrast.js` (+ the mirrored rule in `public/app/editor.js`), `scripts/fix-badge-contrast.mjs` |
| Contrast of a tinted chip on a web page (badges, pills, the organisation badge) | `public/css/styles.css` tokens `--accent-tint-ink` / the `.org-badge` ink, gated by `scripts/test-contrast.mjs` |
| Ops: health, metrics, backup | `src/ops/`, `scripts/backup.mjs`, `scripts/prune-staged.mjs` |
| **Pilot mode** (banner, sheet band, robots block) | `src/config.js`, `src/render/pilotStamp.js`, the `/js/site-banner.js` route in `src/server.js` — see [`PILOT.md`](PILOT.md) |
| Whether a demo org is labelled "Sample" | `customer.is_demo` → `src/branding/index.js` → `src/public/` → `public/js/public-*.js` |
| Importing a finished map | `scripts/import-map.mjs` (`--request <id>` builds an approved request in place) |
| A static per-map extra that isn't a render output (e.g. `disagreements.pdf`) | Add it to `OUTPUT_FILES` in `src/maps/store.js` as one extra entry (outside the `OUTPUTS`-driven list) so the existing generic download/serve routes pick it up for free; copy it into the version folder at the end of `renderVersion()` (`src/maps/engine.js`); add it to `carryExpertTuning()`'s file list so a staged monthly refresh that doesn't bring its own still carries the old one forward |

## House rules

- **No secrets or map/customer data in git.** The portal is a public-facing service — see README "Data hygiene". Configuration comes from `.env`.
- **Pure functions where the decisions are.** `publish/`, `refresh/`, `branding/` are deliberately side-effect-free so the rules can be tested directly. Keep them that way.
- **Server-enforced, always.** Every safe-subset restriction, quota, and visibility condition is checked on the server (and in SQL where it's a visibility condition). Client-side checks are UX, not security.
- **Attribution is not optional.** Maps derive from OpenStreetMap (ODbL) and BODS (OGL). See `NOTICE`. Don't ship an output path that drops the credit.
- **Don't claim what isn't true.** While the pilot is on there are no customers, no SLA and no guaranteed refresh cadence. Copy that says otherwise has been removed once already; don't reintroduce it. If you add a public page, give it the `/js/site-banner.js` `<script>` tag — that is what puts the pilot banner on it.
- **Update `CHANGELOG.md`** with the version and what changed — including re-vendoring.

## Stacked PRs: merge without deleting the base branch

This repo is branch → PR → merge, and merges are **squashes**. That combination breaks a stack, and
it is not obvious until it happens (it did, on 12 August 2026, merging #18 → #19 → #20):

- Squashing #18 makes a *new* commit on `main`. The branch behind #19 still carries #18's original
  commit, which is now unrelated to anything in `main`, so #19 goes **CONFLICTING** until you rebase
  it: `git rebase --onto main <old-base-tip> <branch>`.
- Worse, `gh pr merge --delete-branch` deletes the branch #19 was *based on*, and GitHub then
  **auto-closes #19** instead of retargeting it. A PR whose base branch no longer exists **cannot be
  reopened** — the only route back is to raise a fresh PR from the same branch.

So, merging a stack: **merge each PR without `--delete-branch`**, rebase the next branch onto the new
`main`, re-point its base with `gh pr edit <n> --base main`, and delete the leftover branches by hand
at the end. Re-run `npm test` (and `npm run verify` if the change goes anywhere near a render) **after
each rebase**, not just before the first one — a rebase can silently drop or duplicate a hunk.

Expect one casualty: the docstamp Stop hook restamps documents *after* your commit, so a stack often
carries a stamp-only commit that conflicts on rebase. Drop it (`git rebase --skip`) — the hook
regenerates it. **Largely avoidable since the pre-commit hook landed**: re-stamp before you commit
(see *Re-stamp a document you edited BEFORE you commit it* under [The gates you must run](#the-gates-you-must-run))
and the stamp rides inside its own content commit, so there is no stamp-only commit to conflict. The
advice above still applies to a stack cut before that, and to stamps on documents you did not edit.

## Known rough edge

The vendored-engine duplication above is maintained by hand with no drift detection. If you are changing the engine often, that is the first thing worth fixing.

## The update/publish flow has already been reviewed — read it first

Before touching the editor, the review screen or anything in the proposed-update → accept → submit → approve → public chain, read **`Buses/Development Docs/portal-update-flow-findings_2026-08-11.md`** in the private `buses-data` repo (operator-only, outside this repo — same convention as the host details in [`DEPLOY.md`](DEPLOY.md) §9). It walks the whole flow against a real instance with every screen quoted, ranks the fixes, and its **section J** is written for someone starting cold: a file map per item, the isolated-instance recipe, and the traps.

Two things from it that change how you work here:

- **The whole backlog (items 1–13) is done — the document describes the flow as it was on 11 August 2026.** Merged 12 August: **H6, A2, E** (#18), **A1** (#23), the **status strip** (#20, which also closed C1, C2, B3, B4, H1 and half of H3), then **H4+H3+D**, **B2**, **H5**, **H1**, **B1**, **H8** and **B5** in `0.9.3-pilot`, and finally **H9** — the admin's editor's-eye view toggle (`public/js/editor-eye-view.js`) plus the status-strip wording fix it exposed. Read the findings' *Suggested order of work* first: it carries the per-item status, and the body text above it deliberately still describes the pre-fix behaviour.
- **None of that backlog should alter a rendered sheet.** Every item is wording, presentation or a query. If `npm run verify` fails, you have gone wrong — don't relax the gate.

Five facts about the shipped work, because they are not obvious from the file tree:

- **A version's data diff lives on the version.** Accepting a refresh writes `map_version.data_change_json` (`{ proposedId, sourceNote, summary }`); `dataChangesSince(mapId, since, until)` reads the refreshes a head carries. `changeSummary()`'s **`unchanged` means both halves are empty** — overrides *and* data. Don't reintroduce a check that looks at overrides alone; `scripts/test-change-summary.mjs` will catch you.
- **`public/app/changes.js` is shared by the editor and the review screen** — a plain script tag on both pages, no build step, exposed as `window.PortalChanges`. It renders the data-change account and the date/ageing helpers. Change it and you change both screens.
- **The status strip is a read-out, not a state machine.** `stripState()` in `public/app/editor.js` derives the five states purely from what `mapDetail` already returns. If you need a new state, the fix is almost certainly there and not in the API.
- **Emails never fail the thing they describe.** `src/email/notify.js` is fire-and-forget: it logs and swallows, so a mail outage cannot fail a publish. It sends nothing without `EMAIL_PROVIDER`, and skips RFC 2606 reserved domains (`.example`, `.invalid`) — every seeded demo organisation uses one, and bouncing at them would cost the sending reputation the magic links depend on.
- **The worklist gained a "nobody is blocked" item.** `listUnsubmittedDrafts()` + the `draft-unsubmitted` item exist because every other queue is defined by somebody being blocked, and the one state nothing surfaced was a draft that will never publish itself. Keep it a query — it must stay derived from live state, never a flag someone has to clear.

### The vocabulary — one word per thing

Settled 12 August 2026 (findings **D**), applied across the app, the public pages and `terms.html`. Use these words in any new copy; grep before inventing a synonym.

| Concept | The word | Never |
|---|---|---|
| The rebuilt map offered to a customer | **update** | monthly update, refresh, proposed update *(customer-facing — `refresh` remains the pipeline's own word for the staged payload: `propose-update.mjs`, the admin Refreshes tab, `proposed_update`)* |
| A saved state of a map | **version** (`v2.0`) | edition |
| Where a version is | **draft** → **awaiting review** → **published** | locked for review, sent for approval, submitted |
| What the customer does with a draft | **send it for review** | submit, submit for publication |
| What only an approver does | **publish** | — |
| The party that reviews | **BusMaps.uk** (to a customer), **approver** (to an operator) | we, the reviewer, the operator |
| The two geographic sheets | area: *Within the area* / *To nearby places*; place: *Serving this place* / *Where those buses go* | area wording on a place map |

Its companion, `portal-update-flow-walkthrough_2026-08-11.md`, is the same flow written for a customer's admin person, and is the better starting point if you need to understand what the screens are *for* before changing them.

## Table-like grids: use `.grid-table`, not `<table>`

`public/app/admin.js`, `public/app/review.js` and `public/app/app.css` build every data table (admin
console: applications, map requests, awaiting-build, customers, messages, refreshes, audit, ops
store; review console: publication history) as a **CSS Grid**, not an HTML `<table>`. This was not
a style preference — it replaced a real `<table>` that had a genuine, reproducible Chrome bug.

**The bug (2026-08-07):** `table.grid` used `table-layout: fixed` with an explicit `<colgroup>` —
the standard, textbook-correct way to force table columns to stay put. In real Chrome (reproduced in
Incognito with all extensions off), the header row's columns silently stopped sharing widths with
the body rows once a body row held content the header didn't — specifically, a `<button>` or a
pill/badge sitting in a column whose header cell had `white-space: nowrap`. Headers rendered
bunched at their own intrinsic width; data columns spread to fill the table, with no relationship
between the two. Diagnosis (all confirmed against the real, non-injected page, not just a test
harness):

- Toggling `table-layout: auto` vs `fixed` on a live clone produced **byte-identical** (wrong)
  `getBoundingClientRect()` results — evidence the fixed-column algorithm wasn't being applied at
  all in that render path, despite `getComputedStyle(table).tableLayout` reporting `"fixed"`.
- `getComputedStyle(colEl).width` read back as `"0px"` for every `<col>`, even though
  `col.style.width` correctly showed the set percentage.
- An automated bisection (clone the real table, mutate one property at a time, measure) ruled out
  `td.wrap`'s `min-width`/`max-width`, `white-space: pre-wrap`, the `.tag` badge, the `.sub` div,
  `overflow: hidden` on cells, and `border-collapse` — none of them, alone, fixed or explained it.
- It reproduced with plain inline styles (no site CSS at all) once the row included a real
  `<button>` element under a `nowrap` header — but not with plain text, not with `<div>`s, not with
  `min-width` alone. It needed the specific combination.

**The fix:** stop depending on `<table>`'s column-sync guarantee. `.grid-table` (in `app.css`) is a
`display: grid` container; each row is `.gt-row { display: contents }` so its `.gt-cell` children
become direct grid items sharing the **one** `grid-template-columns` declared on `.grid-table`
itself (set inline per table, e.g. `style="grid-template-columns:20% 16% 28% 11% 10% 15%"`). Because
there is only one column-track definition for the whole component — not one resolved per row the
way `<table>` does it — header and body cannot drift apart; there's no separate algorithm to
disagree. `gtOpen(colWidths, headers)` in `admin.js` builds the opening markup; `gtClose` closes it.
Roles (`role="table"/"row"/"columnheader"/"cell"`) preserve table semantics for assistive tech since
these are no longer real `<table>` elements.

**If you add a new admin/review table:** use `gtOpen()` / `.gt-row` / `.gt-cell`, not `<table>`. If
you're tempted to use a real `<table>` for something else in this codebase, it's probably fine for
plain-text content — the bug needs unbreakable content (buttons, badges) under a nowrap header to
trigger — but there's no known safe subset, so default to the grid pattern for anything with actions
or status pills in a cell.
