# Operations Handbook — BusMaps.uk portal

<!-- docstamp v1.1 | 2026-08-02 | sha=a4bd6c84 -->
**v1.1** · updated 2 August 2026

**For:** the operator (Peter today; anyone running the service later), working with Claude.
**Last reviewed:** 2026-07-25 · **Against:** `0.8.1`.

This is the spine: the shared vocabulary, who does what, the operating rhythm, a map of where
everything lives, and the **single index** of every document. It links to the detailed runbooks
rather than repeating them; several are still to be written (marked *planned* below — see
[`DOCUMENTATION-PLAN.md`](DOCUMENTATION-PLAN.md)). Start here when you pick the service up.

---

## 1. What the service is

> **It is a pilot.** The system is feature-complete and works end to end, but it has no customers —
> every organisation in the database is seeded demo data and every published map is one of ours.
> Everything below describes how the service is *built to run*, not a track record. While pilot mode
> is on, every page and every rendered sheet says so. See [`PILOT.md`](PILOT.md) for what it claims
> and how to switch it off; §5's operating rhythm is the **intended** rhythm, not an established one.

A self-serve portal that lets **approved organisations** (councils first, then shops, schools,
event organisers, the National Trust…) generate and maintain **printable bus maps**. Two map kinds
— **area** and **place** — from one deterministic engine, each able to produce four outputs.

**The load-bearing split** (this is what makes self-serve safe):

- **Deterministic tier (the portal).** Given a map's prepared data + a customer's overrides, the
  engine renders SVG/JPG with **no AI and no external calls** — same input, same output. This is
  what customers self-serve against, and what the byte-identical `verify` gate protects.
- **Central pipeline (expert, run by you).** Fetching bus/map data, onboarding a new area/place, and
  the monthly "what changed?" refresh use judgement and live sources. They run centrally and produce
  *proposed updates* a customer accepts. **Every map is signed off by a human before it can be printed.**

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Customer** | An approved organisation. Has a `type` (council/shop/school/…), a `status`, and a `quota`. |
| **Editor** | A customer's user. Signs in, edits the safe subset, saves versions, submits for publication. **Cannot publish.** |
| **Approver** | A *platform* reviewer. Signs off submissions at `/app/review`. Can **read/inspect any** map but **never edit** one. |
| **Admin** | The *platform* operator (you). Approves applications + map requests, sets quotas, runs the console, and can do everything. |
| **Area map** | A whole town / parish / part of a town (e.g. *St Ives*, *March*). |
| **Place map** | Centred on a single point — a shop, school, station, centre (e.g. *High Wycombe Aldi*). |
| **Output** | One of four renderings a map can produce: **internal geographic**, **internal schematic** (octolinear), **internal diagram** (tube-map), **external** (where the buses go). A customer chooses which are on. |
| **Overrides / safe subset** | The *only* edits a customer can make: **recolour a route** (from the palette) and **toggle a POI** on/off. Rebuilt from scratch and validated on every save — server-enforced in `safeSubset.js`, not just hidden in the UI. Everything else (geometry, pins, straightening, curation) is expert-only. |
| **Baseline (v1.0)** | The imported version with **empty overrides** ⇒ **byte-identical** to the shipped desktop leaflet. The guarantee the whole system rests on. |
| **Version review state** | `draft` → `pending` (submitted) → `published`; a superseded public version becomes `superseded`; a sent-back one `rejected`. |
| **Two pointers** | `current_version_id` = the **working head** (moves on every save). `published_version_id` = the **public-current** official version (moves only on sign-off). They are deliberately separate. |
| **Proposed update** | A staged monthly refresh (`propose-update.mjs`) a customer **accepts** (re-applies their overrides onto fresh data as a new major draft) or **declines**. |
| **Quota** | How many area + place maps a customer may hold (default 1 area + a few places; per-customer, editable). |
| **Magic link** | Passwordless sign-in: a one-time link (printed to the **server console** in dev; needs `EMAIL_PROVIDER` in production) → an httpOnly session cookie. No passwords are ever held. |
| **Object store** | Per-map data at `DATA_DIR/maps/<id>/` — `data/` (generators + inputs), `overrides.json`, `renders/v*/`. **Never in git.** |

## 3. Roles & who does what

At launch **you wear three hats** — Admin, Approver, and central map-maker. The system keeps them
as *separate roles* on purpose, so any one can be handed to someone else later without rework.

| Job | Role | Where |
|---|---|---|
| Approve/decline applications, set quotas, run the console | **Admin** | `/app/admin` |
| Approve/decline map requests (queue for central build) | **Admin** | `/app/admin` → Map requests |
| **Make** a new area/place map centrally, import it | **Admin / map-maker** (you + Claude + the skills) | scripts + `make-bus-leaflet` / `make-place-bus-leaflet` |
| Sign off a submitted version → publish | **Approver** | `/app/review` |
| Recolour/toggle, choose outputs, save, submit, download | **Editor** (the customer) | `/app`, `/app/maps/:id` |
| Per-customer branding of public pages | Customer (or you) | `/app/branding` |
| Expert diagram pin editing | **Admin** | `/app/maps/:id/diagram` |

**Separation of duties (do not collapse it):** the editor who makes a change never publishes it. Even
when you are both, submit as the editor, then switch to the approver view and sign off — the audit
trail depends on it.

## 4. The three approval gates

1. **Organisation** — a public application → **admin approves** → a customer + first editor + invite.
2. **Map request** — an approved customer requests an area/place map (within quota) → **admin approves** → queued for central build.
3. **Publish** — a rendered version stays a **draft** until an **approver signs it off** (a required
   checklist + the deterministic change summary as evidence) → the public-current pointer advances.

## 5. The operating rhythm

Point of reference for "what do I do, and how often." Detail lives in the linked runbook / doc.

| Cadence | Task | How | Runbook |
|---|---|---|---|
| **Daily** (mostly automated) | Backup runs; glance at readiness | cron `npm run backup`; `curl /health?deep=1` | [DEPLOY.md §5](DEPLOY.md), [§4](DEPLOY.md) |
| **Daily/weekly** | Clear the queues | `/app/admin` badges: **Applications**, **Messages** (contact + report-a-problem) | R2, R5 *(planned)* |
| **Weekly** | Sign off submitted maps | `/app/review` | R3 *(planned)* |
| **Monthly** | Run the update cycle after the BODS refresh; then prune | `propose-update.mjs` per map; `npm run prune:staged` | R4 *(planned)*, [DEPLOY.md §6](DEPLOY.md) |
| **Per-event** | Onboard a customer | application arrives → vet → approve | R2, Pol1 *(planned)* |
| **Per-event** | Create a map | request approved → make → import → verify → hand to sign-off | R1 *(planned)* |
| **Per-event** | Handle an incident | a published map is wrong / access fails / a source outage | R6 *(planned)* |
| **On upgrade** | Release gate | `npm test` **and** `npm run verify` (byte-identical) before deploy | [DEPLOY.md §7](DEPLOY.md) |
| **Before launch** | Close the licensing gate | fill the sign-off, resolve bustimes.org | [LICENSING.md](LICENSING.md) → G1 |

**One-writer rule (operational gotcha):** the SQLite file has a single writer. **Stop the server**
before any script that writes it — `seed-demo.mjs`, `import-map.mjs`, `propose-update.mjs`, and before
a restore.

## 6. Where everything is

**Public site** (no sign-in): `/` shopfront · `/apply.html` · `/faq.html` · `/contact.html` ·
`/examples.html` · **`/maps`** gallery · **`/m/<slug>`** a published map · **`/o/<slug>`** an org page ·
`/legal.html` privacy & attribution.

**App** (magic-link sign-in): **`/app`** dashboard · **`/app/maps/:id`** editor (recolour/toggle,
outputs, versions, **Publish** panel) · **`/app/admin`** console (Applications · Map requests ·
Customers · Messages · Proposed updates · Audit · Ops) · **`/app/review`** approver sign-off ·
**`/app/branding`** customer branding · **`/app/maps/:id/diagram`** expert diagram pins.

**Ops endpoints:** **`/health?deep=1`** readiness (DB + disk + engine + a sharp raster; 503 on fail) ·
**`/metrics`** Prometheus text (gated by `METRICS_TOKEN` or an admin session).

**Scripts** (`scripts/`, run with the server **stopped** where they write): `import-map.mjs` (seed one
map → v1.0 baseline, or `--request <id>` to build an approved request in place) · `seed-demo.mjs` (multi-customer demo) · `propose-update.mjs` (stage a monthly
refresh) · `backup.mjs` (`VACUUM INTO` + renders) · `prune-staged.mjs` (settled refreshes) ·
`fix-badge-contrast.mjs` (re-ink route numbers that a recolour made invisible, on sheets already
stored — a one-off catch-up; renders made now are fixed as they are produced) ·
`verify-reproduce.mjs` / `verify-reproduce-place.mjs` (byte-identical gate) · `test-p6.mjs` /
`test-p7.mjs` / `test-lifecycle.mjs` (`npm test`).

**Data & secrets** (never in git): everything under **`DATA_DIR`** — `portal.sqlite` + `maps/<id>/…`.
Config via env (`DATA_DIR`, `HOST`/`PORT`, `PUBLIC_BASE_URL`, `EMAIL_PROVIDER`/`EMAIL_FROM`,
`METRICS_TOKEN`) — see [`.env.example`](../.env.example) and [DEPLOY.md §2](DEPLOY.md).

**Private ops folder** (local-only, no cloud): **`C:\Claude\community-bus-maps-ops\`** — the customer
register, vetting log, incident log and business notes. **Never** synced to GitHub. Back it up yourself.

## 7. Document index — the canonical list

Everything, and where it lives. Keep this current: a new doc that isn't here is a doc no one will find.

| Doc | Home | What it's for | Status |
|---|---|---|---|
| **This handbook** | `docs/OPERATIONS-HANDBOOK.md` | the operator spine | ✅ |
| **Repo orientation for a new session** | `CLAUDE.md` | pilot status + the non-negotiables, loaded automatically by Claude Code | ✅ added 2026-07-26 |
| **Pilot mode** | `docs/PILOT.md` | what the pilot claims on every surface + **the one-switch removal checklist** | ✅ added 2026-07-26 |
| Documentation plan | `docs/DOCUMENTATION-PLAN.md` | what docs to build + order | ✅ |
| README | `README.md` | dev overview + quick start | ✅ (current, P0–P7) |
| Roadmap & architecture | `docs/ROADMAP.md` | phases, safe subset, continuation | ✅ |
| **Developing (change the code)** | `docs/DEVELOPING.md` | determinism contract, the 3 approval gates, vendored-engine hand-off, generator env contract, which gates to run | ✅ added 2026-07-25 |
| Deploy & run | `docs/DEPLOY.md` | deploy, env, **backup/restore**, upgrade gate | ✅ **maintenance reference** |
| Licensing & attribution | `docs/LICENSING.md` | attribution + **sign-off** + bustimes.org question | ✅ doc; ◑ web attribution verified + bustimes.org researched 2026-07-25; **paper checks + decision pending (G1)** |
| Privacy & attribution (public) | `public/legal.html` | customer-facing privacy notice | ✅ reviewed + dated 2026-07-25 (G2); controller identity to add |
| Public FAQ | `public/faq.html` | public questions | ✅ |
| Engine references | `engine/README.md`, `engine/place/README.md`, `engine/expert/README.md` | the renderer + place + expert styles | ✅ |
| Changelog | `CHANGELOG.md` | per-phase lessons | ✅ |
| **Terms of use / customer agreement** | `public/terms.html` | the customer's side of the deal | ✅ draft (G3); governing law + review to confirm |
| **R1** create a new area/place map | `docs/runbook-create-map.md` | generating maps | ✅ |
| **R2** customer onboarding | `docs/runbook-onboarding.md` | accepting customers | ✅ |
| **R3** review & publish | `docs/runbook-review-and-publish.md` | approver sign-off | ✅ |
| **R4** monthly update cycle | `docs/runbook-update-cycle.md` | managing updates | ✅ |
| **R5** marketing site & messages | `docs/runbook-marketing-and-messages.md` | maintaining the website | ✅ |
| **R6** incident response | `docs/runbook-incident-response.md` | when a live map is wrong | ✅ |
| **C1** customer user guide | `docs/customer-user-guide.md` | hand to each customer | ✅ |
| **Pol1** vetting & quota policy | `docs/vetting-and-quota-policy.md` | who qualifies, default quotas | ✅ |
| **P1–P4** register / logs / notes | `ops/` (local-only) | customers, vetting, incidents, business | ⏳ templates created (Tier 0) |

## 8. Continuity — resuming cold

If someone (or a future session) has to pick this up:

1. Read this handbook, then `docs/ROADMAP.md` (architecture) and `CHANGELOG.md` (why things are as
   they are). The code is at **github.com/PeterC66/community-bus-maps** (public, Apache-2.0).
2. **The code is not the service.** The service also needs, and git does **not** contain: the runtime
   data under `DATA_DIR` (customers, maps, published bytes) and the **local-only ops folder** (PII +
   business). Both must be restored from their own backups — confirm they exist before you need them
   ([DEPLOY.md §5](DEPLOY.md) restore drill; the ops folder you back up yourself).
3. **The promise is byte-identical output.** After any dependency/host change, `npm run verify` must
   pass before you serve anything — a different `sharp`/libvips build silently breaks "the file we
   serve is the file that was approved."
4. Remember the **one-writer rule** (§5) and the **separation of duties** (§3).

---

## Appendix — quick command reference

```bash
npm run dev              # run locally → http://127.0.0.1:5180  (shopfront) and /app
npm test                 # P6 + P7 + lifecycle-seam tests
npm run verify           # byte-identical gate (needs FIXTURE_DIR + PLACE_FIXTURE_DIR)
npm run backup -- --out /backups --keep 14      # server may stay up (VACUUM INTO)
npm run prune:staged -- --days 90 --dry-run     # then without --dry-run
# server STOPPED for these (one writer):
node scripts/import-map.mjs --src "<S5-render dir>" --name "…" --slug … --kind area|place --customer "…"
node scripts/import-map.mjs --list-requests      # approved requests awaiting a build
node scripts/import-map.mjs --request <id> --src "<S5-render dir>"   # build one IN PLACE
node scripts/propose-update.mjs …               # stage a monthly refresh
node scripts/fix-badge-contrast.mjs             # dry run; --apply to repair stored sheets
```
