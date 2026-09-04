# Documentation development plan — the operator layer

<!-- docstamp v1.7 | 2026-08-27 | sha=64772326 -->
**v1.7** · updated 27 August 2026

**Status:** ✅ all tiers built 2026-07-25 (this doc is now the tracker) · **Against:** `0.8.0-P7` (commit `6bf1b8b`)

This is the plan for building the documentation Peter needs for **his part** in the portal: generating new town/place maps, accepting new customers, maintaining the system and the marketing site, and managing the monthly updates. It is deliberately scoped to the **operator process layer** — the technical/reference docs already in the repo are strong and are *pointed to*, not rewritten.

---

## 1. Decisions locked

| # | Decision | Answer |
|---|---|---|
| 1 | Sequencing | **Complete reference set**, built in dependency order — no launch-date front-loading |
| 2 | Legal/governance docs | I **draft working starting points**, clearly marked as non-lawyer drafts for review |
| 3 | Audience | **You + Claude now**, but complete enough to **hand over** later without a rewrite |
| 4 | Private-doc home | **Local-only, no cloud** — customer PII never leaves the machine |

**Standing conventions that follow from these:**

- **Markdown**, consistent with the repo (and the "md-only" house style). Customer-facing and legal pieces get an HTML page under `public/` as well when they must be *served*.
- **Handover-capable runbook shape:** every runbook has *Purpose · Prerequisites · Steps (exact commands + paths) · Verification · What-if / rollback*, with **"Claude-assisted shortcut"** call-outs where a step is normally driven through a skill or Claude.
- **Non-lawyer caveat** stamped on every governance draft (as `LICENSING.md` already does).
- **No PII, no secrets, no customer names** in the code repo — those live only in the local-only ops folder (§5).

---

## 2. Current-state review — what already exists

Checked on disk at `0.8.0-P7`. This is the correction to the first-pass plan, which assumed a P4 codebase with little technical documentation. Reality: **P0–P7 are built** (place maps, monthly-change acceptance, public front, expert styles, ops hardening) and the reference docs below already exist.

| Existing doc | Covers | Verdict for this plan |
|---|---|---|
| `README.md` | dev overview, quick start, demo, layout | Keep — current (says P0–P7) |
| `docs/ROADMAP.md` | architecture, phases, safe subset, continuation notes | Keep — current (phase table shows P5–P7 ✅) |
| `docs/DEPLOY.md` | deploy, env, health, **backup + restore drill**, prune, upgrade/verify gate | **Strong — this is the maintenance reference.** No separate maintenance runbook needed; the Handbook's rhythm section points here |
| `docs/LICENSING.md` | attribution matrix (OSM/BODS/bustimes), where credits appear, **review table**, the **bustimes.org open question** | **This is the licensing doc.** Not "write" but **act**: fill the review + resolve bustimes.org (→ G1) |
| `public/legal.html` | privacy notice + attribution + map reuse (customer-facing) | **This is the privacy notice.** Working draft → **review + date** (→ G2) |
| `public/faq.html` | public FAQ | Keep; maintained via the marketing runbook (R5) |
| `engine/README.md`, `engine/place/README.md`, `engine/expert/README.md` | the deterministic renderer + place + expert styles | Keep; developer reference |
| `CHANGELOG.md` | per-phase lessons learned | Keep; the build record |
| `CLAUDE.md` | repo orientation auto-loaded by Claude Code: pilot status, determinism + the three gates, the vendored-engine trap | Added 2026-07-26 |
| `docs/PILOT.md` | what the pilot claims on every surface + **the one-switch removal checklist** | Added 2026-07-26, after this plan was written. Retire it when the pilot ends |

**Headline finding:** the **technical and reference documentation is largely complete**. What is missing is the **operator's process layer** — the step-by-step "how I actually do this recurring job" runbooks for the four roles — plus a **customer-facing user guide**, one **legal gap** (a customer agreement / terms of use, distinct from the privacy+attribution already written), and the **private registers** that record real customers and incidents.

**Housekeeping (verified 2026-07-25):** `README.md` and `docs/ROADMAP.md` were already brought up to P7 by the P5–P7 sessions — current, nothing to bump. The project **memory file** `project_bus_portal_planning.md` still lags at P4 vs the P7 index; the repo docs are authoritative. P5–P7 landed in other sessions, so treat this repo as **actively worked**.

---

## 3. The documentation set to develop

Only the genuine gaps. `NEW` = write from scratch · `ACTION` = complete/confirm an existing doc · `TEMPLATE` = create an empty structured register to populate in operation. Home: `docs/` = code repo (private, BUSL) · `public/` = served shopfront page · `ops/` = local-only private folder (§5).

### Foundation

| ID | Document | Purpose | Home | Kind |
|---|---|---|---|---|
| **H1** | **Operations Handbook** | The spine: shared vocabulary (customer/editor/approver/admin, area/place, draft/published, quota), the **role map**, the **operating rhythm** (daily/weekly/monthly/per-event, pointing to DEPLOY.md for backup/health), and a **single index** of every doc — technical *and* operator. Your continuity insurance. | `docs/` | NEW |

### Governance (mostly exists — small gaps + actions)

| ID | Document | Purpose | Home | Kind |
|---|---|---|---|---|
| **G1** | Licensing review + bustimes.org resolution | Fill the review table in `LICENSING.md`; bustimes.org terms question **resolved 2026-08-07** (site owner confirmed use acceptable, no attribution required — LICENSING.md §3). Remaining launch gate: the printed-sheet credit checks. | `docs/LICENSING.md` | ✅ DONE |
| **G2** | Privacy notice review | Confirm the `legal.html` wording, add a **"last reviewed" date**, keep an internal note of what was checked. | `public/legal.html` + `ops/` note | ACTION |
| **G3** | Terms of use / customer agreement | The **reciprocal** side `legal.html` doesn't cover: what an approved organisation agrees to — acceptable use, "you must have authority over the area you request," no implying operator/council endorsement, service is free with no SLA, we may suspend. Accuracy disclaimer already lives in `legal.html`. | `public/` page + `docs/` source | NEW |

### Operator runbooks (the core gap — your four roles)

| ID | Document | Role it serves | Purpose | Home | Kind |
|---|---|---|---|---|---|
| **R1** | Create a new area/place map | generating maps | End to end: choose area vs place → run `make-bus-leaflet` / `make-place-bus-leaflet` → stage → `import-map.mjs` (attach to customer) → **verify byte-identical baseline** → set outputs/expert styles → hand to review. Place maps **are** supported now. | `docs/` | NEW |
| **R2** | Customer onboarding | accepting customers | Application arrives → **vet** (against the policy) → approve in `/app/admin` (set area/place quota + first editor) → invite link (console today; email when `EMAIL_PROVIDER` set) → optional branding → welcome + hand over the user guide (C1). | `docs/` | NEW |
| **R3** | Review & publish (approver review) | managing updates | What each **checklist item actually means** to verify, how to inspect the print JPGs, publish vs send-back, and **why editor ≠ approver** (separation of duties). The judgement layer over the P4 mechanics in ROADMAP. | `docs/` | NEW |
| **R4** | Monthly update cycle | managing updates | The **P5** flow, now built: central refresh → `propose-update.mjs` → `proposed_update` → customer **accept/decline** (re-applies overrides) → re-render → notify. Includes the upcoming-changes mining and `prune:staged` housekeeping. | `docs/` | NEW |
| **R5** | Marketing site, public front & messages | maintaining website | Edit shopfront pages; **add a gallery example** (downscale + attribution); the per-map **public-listing** toggle and per-customer **branding**; `/o/<org>` pages; work the **contact + report-a-problem** message queues; keep the FAQ current. | `docs/` | NEW |
| **R6** | Incident response | managing updates | High-stakes, time-sensitive: a **published map is wrong in the wild** (retire/repair the published pointer), a sign-in/access failure, a data-source outage — who you tell, what you do, what you record (→ P3). | `docs/` | NEW |

### Customer-facing & policy

| ID | Document | Purpose | Home | Kind |
|---|---|---|---|---|
| **C1** | Customer user guide | What you hand each approved org: sign in (magic link) → recolour/toggle POIs → choose outputs → branding → save versions → **submit for publication** → download → **accept a monthly update** → request another map within quota. | `docs/` + optional served page | NEW |
| **Pol1** | Vetting & quota policy | Generic (no-PII) criteria: who qualifies, "does this org have authority over this area/place?", **default quotas by customer type**, when to decline. The rulebook R2 applies; the actual decisions go to P2. | `docs/` | NEW |

### Private registers — local-only, no cloud (§5)

| ID | Document | Purpose | Kind |
|---|---|---|---|
| **P1** | Customer register | The real customers: org, contacts, type, quota, status, maps held. The operational source of truth R2 feeds. | TEMPLATE |
| **P2** | Vetting decisions log | Who was approved/declined and **why** (applies Pol1; names real orgs → private). | TEMPLATE |
| **P3** | Incident log | Actual incidents + resolutions (R6 feeds it; may name customers → private). | TEMPLATE |
| **P4** | Business & pricing notes | The dormant `plan`/quota model, any future charging thinking, host/cost notes. | NEW |

---

## 4. Homes & conventions

- **`docs/` (code repo, private):** H1, R1–R6, C1, Pol1, and the `docs/` source of G3. These are *generic process* docs — they also help anyone self-hosting the source-available portal (BUSL — non-commercial/internal self-hosting is fine; a competing commercial service is not), and carry no PII.
- **`public/` (served, public):** G3 as a Terms page alongside `legal.html`; C1 optionally surfaced as a served page linked from the dashboard.
- **`ops/` — local-only private folder** (recommended: `C:\Claude\community-bus-maps-ops\`, a **sibling** of the code repo, **not** the code repo, **no git remote** — optionally `git init` with no remote for local history): P1–P4 and the G2 internal note. Nothing here ever syncs to GitHub.
- **This plan** lives at `docs/DOCUMENTATION-PLAN.md` — it is meta, carries no PII, and doubles as the tracker for the effort (tick items off as they land).

---

## 5. Dependency-ordered build sequence

"Complete reference set, dependency order" → foundational/vocabulary first, dependents after.

**Tier 0 — Foundation & workspace** ✅ *done 2026-07-25*
1. ✅ **H1 Operations Handbook** — skeleton written at [`H1-operations-handbook.md`](H1-operations-handbook.md) (vocabulary + role map + rhythm + systems map + doc index + continuity). Grows as docs land.
2. ✅ **`ops/` folder** created at `C:\Claude\community-bus-maps-ops\` (local-only, no cloud) with a README + **P1–P4** stubbed templates (customer register, vetting log, incident log, business notes).

**Tier 1 — Governance (defines the relationship the runbooks operate within)** ✅ *done 2026-07-25 — what remains is yours, noted below*
3. ✅ **G1** — `LICENSING.md`: web attribution **verified** on all public pages; bustimes.org **resolved** — site owner confirmed 2026-08-07 the use is acceptable with no attribution required. *Yours:* the printed-sheet paper checks.
4. ✅ **G2** — `legal.html` reviewed against the actual system, **dated**, ICO right added; internal cross-check note in `ops/`. ~~*Yours:* add the data-controller identity before launch.~~ **DONE** — `public/legal.html:38` names Peter Cooper as the data controller; verified 2026-08-27. G2 is fully closed.
5. ✅ **G3** — new `public/terms.html` customer agreement (non-lawyer draft), linked from `legal.html`. ~~propagate the footer Terms link to the other shopfront pages~~ **DONE** — all 15 shopfront pages carry it; verified 2026-08-27. **Still open, and now tracked as `OA-138` in `buses-data`:** confirm governing law (`terms.html:94` renders a visible `[To confirm.]` on the live site) and get the agreement reviewed before the first real customer. **Do not archive this document until OA-138 is closed** — until then this line is the only description of that work in either repo.

**Tier 2 — Core operator runbooks** ✅ *done 2026-07-25*
6. ✅ **R1** [`R1-create-map.md`](R1-create-map.md) — make → import → verify byte-identical → attach → hand to review. Covers fulfilling an approved request in place (`--request <id>`; the seam it used to flag was closed in `0.8.1`).
7. ✅ **Pol1** [`Pol1-vetting-and-quota-policy.md`](Pol1-vetting-and-quota-policy.md) + **R2** [`R2-onboarding.md`](R2-onboarding.md) — vet → approve (customer + editor + invite) → record → their maps.
8. ✅ **R3** [`R3-review-and-publish.md`](R3-review-and-publish.md) — submit → review (change summary + JPGs) → 5-item checklist → publish / send-back; the two pointers.

**Tier 3 — Customer-facing** ✅ *done 2026-07-25*
9. ✅ **C1** [`C1-customer-user-guide.md`](C1-customer-user-guide.md) — sign in → request → edit (colours/POIs/outputs) → branding → submit → list → download → accept monthly updates.
10. ✅ **R5** [`R5-marketing-and-messages.md`](R5-marketing-and-messages.md) — shopfront pages, adding an example, the self-generating public front (publish≠public), the branding whitelist, the two message queues.

**Tier 4 — Cyclical & exceptional** ✅ *done 2026-07-25*
11. ✅ **R4** [`R4-update-cycle.md`](R4-update-cycle.md) — mine upcoming changes → regenerate → `propose-update.mjs` (service-facts diff) → customer accept → review → prune.
12. ✅ **R6** [`R6-incident-response.md`](R6-incident-response.md) — severity; a wrong published map (unlist fast → re-publish fix); access / health / byte-parity / source-outage / PII; log it.

Registers **P1–P4** are stubbed in Tier 0 and **populated continuously** as you operate.

---

## 6. Maintenance & ownership model

The point of the effort is durability, so the docs must not rot:

- **Single index.** The **Operations Handbook (H1)** is the canonical "what docs exist and where." Every new doc is added to its index; nothing is discoverable only by memory.
- **Last-reviewed date + owner** at the top of every operator/governance doc.
- **Change-triggers (a release-gate discipline):**
  - When a **build phase changes behaviour**, the affected runbook is updated in the same change — the same rule as "update the skill + README," extended to the operator docs.
  - After any **incident**, update the incident log (P3) *and* the runbook that should have prevented or handled it (R6 / the relevant runbook).
  - When a **customer changes** (new, quota, status), update the register (P1) — it is the operational truth, not the DB alone.
- **Keep the code docs in step:** `README.md`/`ROADMAP.md` status lines track the current phase (both currently lag at P4 → P7 — a housekeeping fix to fold in early).

---

## 7. Assumptions & open items

Stated so you can veto rather than block:

1. **Forward-looking content:** everything above documents features that **now exist** (P5 monthly updates, place maps, expert styles, public front). No doc is speculative. If a future phase adds a feature, its runbook is extended then.
2. **No separate maintenance runbook** — `DEPLOY.md` already covers deploy/backup/restore/upgrade; the Handbook's rhythm section links to it rather than duplicating it. Say if you'd prefer a thin standalone "operator maintenance checklist" anyway.
3. **Legal drafts are starting points**, not legal advice; G1–G3 are for your review and, where you judge it worth it, a professional check before the public site is announced.
4. **`ops/` path** `C:\Claude\community-bus-maps-ops\` is a suggestion; name/place it wherever suits.
5. This repo is **actively developed** (P5–P7 landed today). This plan file is a new doc and left **uncommitted** for your review; the README/ROADMAP/memory staleness may already be in hand in another session.

---

### Suggested first move

Draft **H1 (the Operations Handbook skeleton)** — it frames everything and is immediately useful — then work down Tier 1. Or point me at any single runbook to draft first.
