# Operations Handbook (H1) — BusMaps.uk portal

<!-- docstamp v1.18 | 2026-08-25 | sha=296cb6a1 -->
**v1.18** · updated 25 August 2026

**For:** the operator (Peter today; anyone running the service later), working with Claude. **Last reviewed:** 2026-07-25 · **Against:** `0.8.1`.

This is the spine: the shared vocabulary, who does what, the operating rhythm, a map of where everything lives, and the **single index** of every document. It links to the detailed runbooks rather than repeating them — all are written (see [`DOCUMENTATION-PLAN.md`](DOCUMENTATION-PLAN.md) and §7's index). Start here when you pick the service up.

> **Doing the routine week or month? Don't start here — start with the work.** `/app/admin` opens on the **To do** tab: every queue in one list, ranked by who is blocked, each row carrying the exact next command (`GET /api/admin/worklist` is the same list for tooling). On the operator's machine the **`bus-work` skill** prints that list plus what only the laptop can see — engine-stale renders, missing S6 verification, failing byte-identical gates — and carries an item through to done. These runbooks are the *why* behind each step; you should not need to open one to do an ordinary month.

---

## 1. What the service is

> **It is a pilot.** The system is feature-complete and works end to end, but it has no customers — every organisation in the database is seeded demo data and every published map is one of ours. Everything below describes how the service is *built to run*, not a track record. While pilot mode is on, every page and every rendered sheet says so. See [`PILOT.md`](PILOT.md) for what it claims and how to switch it off; §5's operating rhythm is the **intended** rhythm, not an established one.

A self-serve portal that lets **approved organisations** (councils first, then shops, schools, event organisers, the National Trust…) generate and maintain **printable bus maps**. Two map kinds — **area** and **place** — from one deterministic engine, each able to produce four outputs.

**The load-bearing split** (this is what makes self-serve safe):

- **Deterministic tier (the portal).** Given a map's prepared data + a customer's overrides, the engine renders SVG/JPG with **no AI and no external calls** — same input, same output. This is what customers self-serve against, and what the byte-identical `verify` gate protects.
- **Central pipeline (expert, run by you).** Fetching bus/map data, onboarding a new area/place, and the monthly "what changed?" refresh use judgement and live sources. They run centrally and produce *proposed updates* a customer accepts. **Every map is reviewed by a human before it can be printed** — a reasonableness check against the checklist, not a routine re-verification of routes/timings against source data.

## 2. Vocabulary

**One glossary, and it is not in this repo.** `Documentation/README - Glossary of terms.md` in **buses-data** (`C:\u3a St Ives\Using AI\Buses\Documentation\`) is the shared vocabulary for the whole system — every part of every sheet, the pipeline stages, the portal's own words, and the phrase to use instead when writing to a customer. Read it there. Every term this section used to define is in it, with more detail and an audience label saying who the word is safe with.

**This section was a second, shorter glossary of fifteen terms until 26 August 2026, and the reason it is gone is that it had drifted.** It said a map produces *four* outputs; there are **five** — `boarding_plan` landed on 2026-08-23 and `src/maps/OUTPUTS` in `src/maps/store.js` is the authority. Six other terms it defined (*Editor*, *Approver*, *Admin*, *Area map*, *Place map*, *Proposed update*) had been reworded in the glossary and not here. **Two vocabularies that overlap by half do not stay in step**, and the drift is invisible from either side, because each document stays perfectly consistent with itself.

Nothing was lost. The eight terms that lived **only** here — *customer*, *quota*, *overrides and the safe subset*, *baseline (v1.0)*, *review state*, *the two pointers*, *magic link* and *object store* — were moved into the glossary's §8, which is its portal section. The glossary's *review state* entry was corrected in the same pass: there are five states, not the three it claimed.

Where the **code** is the authority rather than either document, this handbook says so and names the file: `src/maps/safeSubset.js` decides what an editor may actually change, `src/maps/store.js` lists the outputs, and §4 below has the approval gates.

## 3. Roles & who does what

At launch **you wear three hats** — Admin, Approver, and central map-maker. The system keeps them as *separate roles* on purpose, so any one can be handed to someone else later without rework.

| Job | Role | Where |
|---|---|---|
| Approve/decline applications, set quotas, run the console | **Admin** | `/app/admin` |
| Approve/decline map requests (queue for central build) | **Admin** | `/app/admin` → Map requests |
| **Make** a new area/place map centrally, import it | **Admin / map-maker** (you + Claude + the skills) | scripts + `make-bus-leaflet` / `make-place-bus-leaflet` |
| Review a submitted version → publish | **Approver** | `/app/review` |
| Recolour/toggle, choose outputs, save, submit, download | **Editor** (the customer) | `/app`, `/app/maps/:id` |
| Per-customer branding of public pages | Customer (or you) | `/app/branding` |
| Expert diagram pin editing | **Admin** | `/app/maps/:id/diagram` |

**Separation of duties (do not collapse it):** the editor who makes a change never publishes it. Even when you are both, submit as the editor, then switch to the approver view and review — the audit trail depends on it. **This is now enforced, not just asked for.** `POST /api/review/:id/approve` refuses when the approver is the submitter, unless `ALLOW_SELF_APPROVAL=1` is set on the host — which it currently is, because with one operator the alternative is that nothing can be published at all. Every publication made under that override is stamped `selfApproved: true` in the decision evidence and the audit row, so the trail says which publications had a second pair of eyes and which did not. Unset it the day a second person holds `approver` — item 1 of §3b below, and the only entry there that no amount of work closes.

### 3b. Before the first real customer

A short list kept deliberately apart from `open-actions.md`. Each of these is something a paying customer's first week would expose, and the backlog is where such items go to be postponed (`technical-audit_2026-08-25` N15).

| # | What | Why it cannot wait on the backlog | State |
|---|---|---|---|
| 1 | **A second person holds `approver`**, and `ALLOW_SELF_APPROVAL` is unset on the host | The control above has never operated: every publication to date is stamped `selfApproved: true`. A customer publishing their own map is precisely when a second pair of eyes starts to matter, and it is the first thing an acquirer's reviewer tests. Recruiting a person is not a code change and cannot be done in the week it is noticed. | ☐ **open — needs a person, not a commit** |
| 2 | **The privacy statement is out of draft** and names a data controller | It read "Working draft — to be confirmed before the service opens publicly" while the apply form was already asking organisations for names, emails and phone numbers. | ☑ 2026-08-25 (audit N8) |
| 3 | **Retention and erasure actually run** for `application` and `message` | A UK erasure request needs a code path and a runbook that reaches the backups too, not a sentence promising one. | ☑ 2026-08-25 (audit N8) |
| 4 | **Backups are encrypted before they leave the VPS** | Until 2026-08-25 an unencrypted copy of every name, email and phone number in the database was pulled to a laptop and kept indefinitely. | ☑ 2026-08-25 (audit N3) |
| 5 | **The S6 correctness waivers are cleared**, by running S6 rather than by moving the dates | Seven of the eight live towns are published under one (`scripts/s6-waivers.json`, `until` 15 Sept – 6 Oct), so every live map has passed a reproducibility check and not a correctness check since its data last moved. | ☐ open — six S6 runs (audit N16) |

**Sessions and step-up.** Sign-in sessions last **7 days** and slide forward on use, so an unused account loses its credential within a week (they were fixed 30-day sessions until 2026-08-20). Three actions need a sign-in from the **last 30 minutes** whatever the session's own age: publishing a version, changing an organisation's settings or quota, and changing a user's role or organisation. If one is refused with `step-up-required`, sign out and follow a fresh sign-in link. **Admin → Sessions** lists everyone signed in and revokes any of them on the spot; that is the tool for a lost laptop or a token that has been somewhere it should not, and it replaces keeping a live admin cookie in a file.

## 4. The three approval gates

1. **Organisation** — a public application → **admin approves** → a customer + first editor + invite.
2. **Map request** — an approved customer requests an area/place map (within quota) → **admin approves** → queued for central build.
3. **Publish** — a rendered version stays a **draft** until an **approver reviews it** (a required checklist + the deterministic change summary as evidence) → the public-current pointer advances.

### 4b. The tube-map diagram is request-only

The other three outputs are generated: the same data always draws the same sheet. The diagram is solved and then **pinned by hand**, and those pins are ours to re-judge every time the network moves — so it is a *priced* output, not a tick-box, and it costs drawing time in the updates as well as in the first build.

- A customer sees it in the editor's Outputs panel, **locked**, with an **Ask us** button.
- Pressing it writes a `diagram-request` message (with the map attached) into **Messages** in the admin console. It switches nothing on. Reply with what it would involve.
- The lock is **server-enforced** in `chooseOutputs()` (`src/maps/engine.js`); a non-admin PATCH to `/api/maps/:id/outputs` asking for `internal_diagram` gets **403** and the stored set is unchanged. Hiding the checkbox is only the UX of it. Once granted, a customer cannot switch it *off* either.
- **To grant it:** as admin, open the map's editor and tick it (admins are not subject to the lock), or simply save a layout in `/app/maps/:id/diagram` — the pin editor switches the output on itself. Either way the result is a new draft version that still needs the P4 review.
- It is only *available* at all when the map's `routes.json` carries an `internalDiagram` config, which is set when the map is built.

## 5. The operating rhythm

Point of reference for "what do I do, and how often." Detail lives in the linked runbook / doc.

| Cadence | Task | How | Runbook |
|---|---|---|---|
| **Daily** (mostly automated) | Backup runs; readiness is watched **for** you now | cron `npm run backup`; **Uptime Robot** polls `/health?deep=1` every 5 min and emails on failure (since 2026-08-20) — so this row is a glance, not the safety net it used to be | [DEPLOY.md §5](DEPLOY.md), [§4](DEPLOY.md) |
| **Daily/weekly** | Clear the queues | `/app/admin` badges: **Applications**, **Messages** (contact + report-a-problem + diagram requests, §4b) | R2, R5 |
| **Weekly** | Review submitted maps | `/app/review` | R3 |
| **Monthly** | Run the update cycle after the BODS refresh; then prune | `propose-update.mjs` per map; `npm run prune:staged` | R4, [DEPLOY.md §6](DEPLOY.md) |
| **Per-event** | Onboard a customer | application arrives → vet → approve | R2, Pol1 |
| **Per-event** | Create a map | request approved → make → import → verify → hand to review | R1 |
| **Per-event** | Handle an incident | a published map is wrong / access fails / a source outage | R6 |
| **On upgrade** | Release gate | `npm test` **and** `npm run verify` (byte-identical) before deploy | [DEPLOY.md §7](DEPLOY.md) |
| **Before launch** | Close the licensing gate | fill the review, resolve bustimes.org | [LICENSING.md](LICENSING.md) → G1 |

**One-writer rule (operational gotcha):** the SQLite file has a single writer. **Stop the server** before any script that writes it — `seed-demo.mjs`, `import-map.mjs`, `propose-update.mjs`, and before a restore.

## 6. Where everything is

**Public site** (no sign-in): `/` shopfront · `/apply.html` · `/faq.html` · `/contact.html` · `/examples.html` · `/pricing.html` · **`/maps`** gallery · **`/m/<slug>`** a published map · **`/o/<slug>`** an org page · `/opportunity.html` the CIC hand-over pitch ("Take this on", footer link only, not in the nav) · `/legal.html` privacy & attribution · `/terms.html`.

**App** (magic-link sign-in): **`/app`** dashboard · **`/app/maps/:id`** editor (recolour/toggle, outputs, versions, **Publish** panel) · **`/app/admin`** console (Applications · Map requests · Customers · Messages · Proposed updates · Audit · Ops) · **`/app/review`** approver review · **`/app/branding`** customer branding · **`/app/maps/:id/diagram`** expert diagram pins.

**Ops endpoints:** **`/health?deep=1`** readiness (DB + disk + engine + a sharp raster; 503 on fail) · **`/metrics`** Prometheus text (gated by `METRICS_TOKEN` or an admin session) · **`POST /api/admin/status`** the laptop's `push-status.mjs` sends status.js's byte-identical gate + engine/S6 staleness here, gated by `STATUS_TOKEN` or an admin session — it then shows up at ranks 0/8 of the To-do tab / `/api/admin/worklist` alongside the portal's own queues.

**Scripts** (`scripts/`, run with the server **stopped** where they write): `import-map.mjs` (seed one map → v1.0 baseline, or `--request <id>` to build an approved request in place) · `delete-map.mjs` (retire a map — row, versions, publish/proposed-update rows and its `data/maps/<id>/` dir; dry run by default, `--yes` to act — e.g. freeing a demo-held town's slug for a real customer, R1) · `seed-demo.mjs` (multi-customer demo) · `propose-update.mjs` (stage a monthly refresh) · `backup.mjs` (`VACUUM INTO` + renders) · `prune-staged.mjs` (settled refreshes) · `fix-badge-contrast.mjs` (re-ink route numbers that a recolour made invisible, on sheets already stored — a one-off catch-up; renders made now are fixed as they are produced) · `test-contrast.mjs` (WCAG AA gate over the tinted chips in `styles.css`, including every organisation accent; part of `npm test`) · `verify-reproduce.mjs` / `verify-reproduce-place.mjs` (byte-identical gate) · `test-p6.mjs` / `test-p7.mjs` / `test-lifecycle.mjs` (`npm test`).

**Data & secrets** (never in git): everything under **`DATA_DIR`** — `portal.sqlite` + `maps/<id>/…`. Config via env (`DATA_DIR`, `HOST`/`PORT`, `PUBLIC_BASE_URL`, `EMAIL_PROVIDER`/`EMAIL_FROM`, `METRICS_TOKEN`, `STATUS_TOKEN`) — see [`.env.example`](../.env.example) and [DEPLOY.md §2](DEPLOY.md).

**Private ops folder** (local-only, no cloud): **`C:\Claude\community-bus-maps-ops\`** — the customer register, vetting log, incident log and business notes. **Never** synced to GitHub. Back it up yourself.

## 7. Document index — the canonical list

Everything, and where it lives. Keep this current: a new doc that isn't here is a doc no one will find.

| Doc | Home | What it's for | Status |
|---|---|---|---|
| **This handbook** | `docs/H1-operations-handbook.md` | the operator spine | ✅ |
| **Daily To-do quickstart** | `docs/H2-todo-quickstart.md` | steps-only guide for working the `/app/admin` To-do tab, day to day | ✅ added 2026-08-08 |
| **Repo orientation for a new session** | `CLAUDE.md` | pilot status + the non-negotiables, loaded automatically by Claude Code | ✅ added 2026-07-26 |
| **Pilot mode** | `docs/PILOT.md` | what the pilot claims on every surface + **the one-switch removal checklist** | ✅ added 2026-07-26 |
| Documentation plan | `docs/DOCUMENTATION-PLAN.md` | what docs to build + order | ✅ |
| README | `README.md` | dev overview + quick start | ✅ (current, P0–P7) |
| Roadmap & architecture | `docs/ROADMAP.md` | phases, safe subset, continuation | ✅ |
| **Developing (change the code)** | `docs/DEVELOPING.md` | determinism contract, the 3 approval gates, vendored-engine hand-off, generator env contract, which gates to run | ✅ added 2026-07-25 |
| Deploy & run | `docs/DEPLOY.md` | deploy, env, **backup/restore**, upgrade gate | ✅ **maintenance reference** |
| Licensing & attribution | `docs/LICENSING.md` | attribution + **review** + bustimes.org question | ✅ doc; ✅ web attribution verified 2026-07-25; ✅ bustimes.org resolved 2026-08-07 (no attribution required); **printed-sheet paper checks pending (G1)** |
| Privacy & attribution (public) | `public/legal.html` | customer-facing privacy notice | ✅ reviewed + dated 2026-07-25 (G2); controller identity to add |
| Public FAQ | `public/faq.html` | public questions | ✅ |
| Engine references | `engine/README.md`, `engine/place/README.md`, `engine/expert/README.md` | the renderer + place + expert styles | ✅ |
| Changelog | `CHANGELOG.md` | per-phase lessons | ✅ |
| **Terms of use / customer agreement** | `public/terms.html` | the customer's side of the deal | ✅ draft (G3); governing law + review to confirm |
| **R1** create a new area/place map | `docs/R1-create-map.md` | generating maps | ✅ |
| **R2** customer onboarding | `docs/R2-onboarding.md` | accepting customers | ✅ |
| **R3** review & publish | `docs/R3-review-and-publish.md` | approver review | ✅ |
| **R4** monthly update cycle | `docs/R4-update-cycle.md` | managing updates | ✅ |
| **R5** marketing site & messages | `docs/R5-marketing-and-messages.md` | maintaining the website | ✅ |
| **R6** incident response | `docs/R6-incident-response.md` | when a live map is wrong | ✅ |
| **C1** customer user guide | `docs/C1-customer-user-guide.md` | hand to each customer | ✅ |
| **Pol1** vetting & quota policy | `docs/Pol1-vetting-and-quota-policy.md` | who qualifies, default quotas | ✅ |
| **P1–P4** register / logs / notes | `ops/` (local-only) | customers, vetting, incidents, business | ⏳ templates created (Tier 0) |

**And the half of the system that is not in this repo.** The index above called itself canonical while listing nothing at all from **buses-data**, which is where the maps, the map-making guides and the shared vocabulary actually live — so a reader following it would never find them. Paths below are under `C:\u3a St Ives\Using AI\Buses\`.

| Doc | Home (buses-data) | What it's for | Status |
|---|---|---|---|
| **Glossary of terms** | `Documentation/README - Glossary of terms.md` | **the one vocabulary** — every part of every sheet keyed to two annotated examples, plus the pipeline, portal, repo and failure words, each with an audience label and the phrase to use with a customer | ✅ the authority; §2 above points here |
| **Failure shapes we have named** | `Documentation/README - Failure shapes we have named.md` | twenty-nine ways this system has run, reported success and been wrong — read it before trusting a gate | ✅ split out of the glossary 2026-08-26 |
| Folder structure | `Documentation/README - Folder structure.md` | what is tracked, what is generated, and why | ✅ |
| How to enhance the system | `Documentation/README - How to enhance the system.md` | changing the engine, the layout logic or the data sources | ✅ |
| How to make a bus leaflet / a place leaflet / audit one | `Documentation/README - How to make a bus leaflet.md` and its two siblings | using the system through Claude, in plain English | ✅ |
| How to publish a map to the portal | `Documentation/README - How to publish a map to the portal.md` | the laptop end of deliver → accept → publish | ✅ |
| Retention and pruning | `Documentation/README - Retention and pruning.md` | what is kept, what is deleted, and when | ✅ |
| **Open actions** | `Development Docs/open-actions.md` | the strategic backlog — only what is genuinely still outstanding | ✅ live |

## 8. Continuity — resuming cold

If someone (or a future session) has to pick this up:

1. Read this handbook, then `docs/ROADMAP.md` (architecture) and `CHANGELOG.md` (why things are as they are). The code is at **github.com/PeterC66/community-bus-maps** (private, Business Source License 1.1 — converts to Apache-2.0 on 2030-08-09).
2. **The code is not the service.** The service also needs, and git does **not** contain: the runtime data under `DATA_DIR` (customers, maps, published bytes) and the **local-only ops folder** (PII + business). Both must be restored from their own backups — confirm they exist before you need them ([DEPLOY.md §5](DEPLOY.md) restore drill; the ops folder you back up yourself).
3. **The promise is byte-identical output.** After any dependency/host change, `npm run verify` must pass before you serve anything — a different `sharp`/libvips build silently breaks "the file we serve is the file that was approved."
4. Remember the **one-writer rule** (§5) and the **separation of duties** (§3).

---

## Appendix — quick command reference

```bash
npm run dev              # run locally → http://127.0.0.1:5180  (shopfront) and /app
npm test                 # P6 + P7 + lifecycle-seam tests
npm run verify           # byte-identical gate (needs FIXTURE_DIR + PLACE_FIXTURE_DIR)
npm run backup -- --out /backups --keep 14      # server may stay up (VACUUM INTO)
npm run prune:staged -- --days 90               # dry run by default; add --yes to delete
# server STOPPED for these (one writer):
node scripts/import-map.mjs --src "<S5-render dir>" --name "…" --slug … --kind area|place --customer "…"
node scripts/import-map.mjs --list-requests      # approved requests awaiting a build
node scripts/import-map.mjs --request <id> --src "<S5-render dir>"   # build one IN PLACE
node scripts/delete-map.mjs --slug <slug>                            # dry run — shows what would go
node scripts/delete-map.mjs --slug <slug> --yes                      # retire a map (row, versions, dir)
node scripts/propose-update.mjs …               # stage a monthly refresh
node scripts/fix-badge-contrast.mjs             # dry run; --apply to repair stored sheets
```
