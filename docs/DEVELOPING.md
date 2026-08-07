# Developing the portal — how to change it safely

<!-- docstamp v1.4 | 2026-08-07 | sha=49a3fbf4 -->
**v1.4** · updated 7 August 2026

This is the **developer** counterpart to the operator documentation. The [Operations Handbook](OPERATIONS-HANDBOOK.md) and the runbooks tell you how to *run* the service; this tells you how to *change* it without breaking the two things the product rests on: the deterministic render, and the approval gates.

`README.md` covers architecture and quick start — read that first. Start here when you are about to edit code.

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

**The `LEAFLET_DIR` trap.** The schematic and diagram pre-stages spawn `gen_internal.js` with `cwd` set to a workspace and an inherited environment. Because `gen_internal.js` prefers `LEAFLET_DIR` over `cwd`, an inherited value sends that render back to the parent folder and **silently produces the ordinary geographic map** under the expert style's filename. The wrappers in `engine/expert/` delete it for the child and pass everything else through. If you write a new pre-stage or wrapper, do the same. Symptom: an expert sheet that looks exactly like the plain internal map.

---

## The gates you must run

```bash
npm run verify:area     # area map reproduces a shipped leaflet byte-for-byte
npm run verify:place    # same for a place map
npm run test:p7         # expert styles (schematic + diagram), 6 gated outputs
npm run test:lifecycle  # request → build → publish → revert lifecycle
npm test                # public front (P6)
```

### `verify` skips silently — this has caught people out

`verify-reproduce.mjs` and `verify-reproduce-place.mjs` **exit 0 with a "skipping" message when `FIXTURE_DIR` / `PLACE_FIXTURE_DIR` are unset or missing.** That is deliberate — a fresh clone without the separate data repo should still pass `npm test` — but it means **a green run in a clean checkout proves nothing about the renderer.** Set both in `.env` (git-ignored; see `.env.example`) and confirm the output says PASS with byte counts, not "skipping", before you trust a render change.

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
| Monthly change acceptance (accept/decline a proposed update) | `src/refresh/` + `scripts/propose-update.mjs` |
| Auth / sessions | `src/auth/` (magic link, server-side sessions, hand-rolled cookies, no deps) |
| Public pages and listings | `src/public/` — a **read model** over the publish gate, PII-free by construction |
| Per-customer branding | `src/branding/` — a server-enforced whitelist. It decorates the **page**, not the printed sheet |
| The diagram pin editor | `src/expert/` + `public/app/diagram.js` (admin-only). Handles are drawn in the **sheet's** frame, not the solver's — `measureHandleFrame()` recovers the difference by fitting the tagged stop ticks; don't re-derive the generators' transforms by hand |
| Badge legibility after a recolour | `src/render/badgeContrast.js` (+ the mirrored rule in `public/app/editor.js`), `scripts/fix-badge-contrast.mjs` |
| Ops: health, metrics, backup | `src/ops/`, `scripts/backup.mjs`, `scripts/prune-staged.mjs` |
| **Pilot mode** (banner, sheet band, robots block) | `src/config.js`, `src/render/pilotStamp.js`, the `/js/site-banner.js` route in `src/server.js` — see [`PILOT.md`](PILOT.md) |
| Whether a demo org is labelled "Sample" | `customer.is_demo` → `src/branding/index.js` → `src/public/` → `public/js/public-*.js` |
| Importing a finished map | `scripts/import-map.mjs` (`--request <id>` builds an approved request in place) |
| A static per-map extra that isn't a render output (e.g. `disagreements.pdf`) | Add it to `OUTPUT_FILES` in `src/maps/store.js` as one extra entry (outside the `OUTPUTS`-driven list) so the existing generic download/serve routes pick it up for free; copy it into the version folder at the end of `renderVersion()` (`src/maps/engine.js`); add it to `carryExpertTuning()`'s file list so a staged monthly refresh that doesn't bring its own still carries the old one forward |

## House rules

- **No secrets or map/customer data in git.** This is a public repo — see README "Data hygiene". Configuration comes from `.env`.
- **Pure functions where the decisions are.** `publish/`, `refresh/`, `branding/` are deliberately side-effect-free so the rules can be tested directly. Keep them that way.
- **Server-enforced, always.** Every safe-subset restriction, quota, and visibility condition is checked on the server (and in SQL where it's a visibility condition). Client-side checks are UX, not security.
- **Attribution is not optional.** Maps derive from OpenStreetMap (ODbL) and BODS (OGL). See `NOTICE`. Don't ship an output path that drops the credit.
- **Don't claim what isn't true.** While the pilot is on there are no customers, no SLA and no guaranteed refresh cadence. Copy that says otherwise has been removed once already; don't reintroduce it. If you add a public page, give it the `/js/site-banner.js` `<script>` tag — that is what puts the pilot banner on it.
- **Update `CHANGELOG.md`** with the version and what changed — including re-vendoring.

## Known rough edge

The vendored-engine duplication above is maintained by hand with no drift detection. If you are changing the engine often, that is the first thing worth fixing.
