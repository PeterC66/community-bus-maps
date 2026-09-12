# Pilot mode — what it claims, and how to switch it off

<!-- docstamp v1.9 | 2026-09-12 | sha=dec9a546 -->
**v1.9** · updated 12 September 2026

**For:** the operator. **Status:** pilot mode is **ON**.

BusMaps.uk was built as if it were a running service. It isn't. There are no customers, no organisation has signed up, and every map on the site is one we made ourselves. The copy said otherwise — "maps **our customers** have published", "those are live, kept up to date", "**our team** then builds the map data" — and anyone reading it, a council clerk or a colleague, would have concluded there was an established service behind it.

Pilot mode is the correction. It is deliberately loud, and deliberately easy to remove: **one environment variable turns all of it off.**

## Why "pilot"

Considered and rejected: *experimental* (reads as "may break your data" — wrong signal for a deterministic print product), *beta* (software jargon; means little to a parish clerk), *prototype* (undersells finished sheets), *preview* (vague).

**Pilot** is the word a council understands: real work, real output, early stage, small scale, no promises yet. What is *not* provisional — and the wording is careful about this — is that every map is built from official open data and reviewed by a person before publication. That review is a check that it looks right, not an independent verification against timetables — see [`LICENSING.md`](LICENSING.md) §5 for what it does and doesn't cover. The pilot label is about the **service around them**.

## What it does

| Surface | What appears | Where |
|---|---|---|
| Every web page (17 static files + the 404) | Amber banner above the header; `[Pilot]` prefix on the tab title | `/js/site-banner.js`, generated in `src/routes/public.js` |
| Every rendered sheet **of a SAMPLE map** | Red band across the top: *PILOT — SAMPLE MAP · Made to test the system…* | `src/render/pilotStamp.js` |
| FAQ | The `#pilot` entry — the banner's link target, and the honest long version | `public/faq.html` |

**The sheet band is no longer on that list either — it is per CUSTOMER, and the other two rows are not** (2026-09-11, buses-data OA-320). The band's own words are *"Not published by any organisation"*, which is a claim about the **map**, not about the site; gated on `PILOT_MODE` alone it would have printed above the badge of the first organisation ever to register. It is now gated on `PILOT_MODE` **and** on `customer.is_sample` — are this organisation's maps ours, made to show what the system produces? — with `customer.is_demo` forcing it on regardless, because the invented councils in `scripts/seed-demo.mjs` must stay labelled after the pilot ends. `isSampleCustomer()` in `src/render/pilotStamp.js` is the whole rule, and every way of not knowing (no customer row, an unjoined column, a caller that passed nothing) answers **sample**, for the same reason `PILOT.on` defaults to on: forgetting must fail towards the honest state.

**The banner and the `[Pilot]` title prefix stay site-wide, deliberately.** They say *the service around these maps is a pilot*, and that remains true on the day one organisation publishes — it is exactly the claim this file was written to make. Only the sheet band was ever a claim about an individual map. An admin turns `is_sample` off in the admin console's **Sample maps** column, at the same moment as **Watermark downloads** beside it: both are per-customer opt-outs flipped when an organisation stops being ours and starts being theirs.

**The answer is baked into the stored bytes, and one event can stale it.** Reassigning a map to another organisation is that event, and `src/routes/admin.js` reconciles that map's stored renders as part of the reassignment — see [Switching it off](#switching-it-off) for the same reconciler run by hand. Baking it in is the right call *here* and the wrong one for its two neighbours: `src/render/draftStamp.js` had to move to serve time because a version's state changes every time somebody publishes, and `src/render/watermark.js` because the answer differs between two viewers at the same instant. A map's publishing organisation changes on one audited admin action, so the bytes can hold it.

**Search engines are no longer on that list.** Until 2026-08-21 `PILOT_MODE` also served `Disallow: /`, and that conflated two different claims: the banner and the sheet band say *"this is a pilot"*, which is honest and worth keeping for as long as it is true, while `Disallow: /` says *"nobody may find this at all"*. Tying them to one switch meant the only way to become discoverable was to stop admitting it was a pilot. Indexing is now its own flag, `ALLOW_INDEXING` (default off, see `src/config.js` §INDEXING and `scripts/test-indexing.mjs`), so the two can be set independently — including the useful middle state of an indexed site that still says plainly that it is a pilot.

The banner is injected by one generated script rather than pasted into seventeen hand-written HTML files, because there is no template engine here. Each page carries a single `<script src="/js/site-banner.js" defer>` tag.

The sheet band **reserves space** rather than overlaying. The sheets have no reliable whitespace — the corners are taken by the title, the Services panel and the credits line — so the artwork is shrunk ~4% and slid down, and the band sits in space that belongs to nothing. That works for all four outputs and for any output added later. It is applied *after* the generator runs, which is why the byte-identical reproduce gate is unaffected (see below).

## Switching it off

**Folder:** doesn't matter — this is an environment variable, set wherever the service is configured, not a command run from anywhere in particular.

```bash
PILOT_MODE=0
```

That is the whole switch — restart and every item in the table above is gone. It does **not** enable indexing; that is `ALLOW_INDEXING=1`, and the two are deliberately independent. Then, in this order:

1. **Set `PILOT_MODE=0`** in the deployment environment (and `.env`).
2. **Restamp the stored sheets.** Renders in the object store keep whatever band they were rendered with, including versions already reviewed and published. Run it from the repository root — `C:\Claude\community-bus-maps` on the laptop, `/opt/community-bus-maps` (`DEPLOY_APP_DIR`) on the host — with no placeholders:
   ```bash
   node scripts/restamp-renders.mjs --apply
   ```
With `PILOT_MODE=0` this *strips* the band and re-rasterises each JPG. The transform is lossless — a stamped sheet stripped again is byte-identical to the original. Run it without `--apply` first for a dry run. **Since OA-320 it asks the question once per MAP rather than once for the whole site**, so it is also the tool for reconciling a store after a customer's `is_sample` has been turned off by hand, and the reconciliation the reassignment route performs automatically. It opens the database — deliberately, and unlike the two scripts beside it — because reading a customer is the whole point; the reasoning is at the head of the file.
3. **Delete the code.** `grep -rn "PILOT:" --include=* . | grep -v node_modules` finds every gated block. Whole files: `src/render/pilotStamp.js`, `src/render/pilotReconcile.js`, `scripts/restamp-renders.mjs`, `scripts/test-sample-band.mjs`, `scripts/prove-red-sample-band.mjs` (and the two `package.json` scripts that own the last two). The `customer.is_sample` column goes too — the migration in `src/db/index.js`, the `is_sample` line in `updateCustomerAdmin()`, the two joins in `getMap()`/`listMaps()`, the admin console's *Sample maps* column, and `isSampleCustomer()`'s callers in `src/routes/`, `src/server.js` and `scripts/import-map.mjs`; leave the column itself in the database rather than writing a migration to drop it, the way `is_demo` is kept. Everything else is a marked block or a one-line `<script>` tag. Three things sit close to the pilot code and **must survive it**: `src/render/badgeContrast.js` and `scripts/fix-badge-contrast.mjs` (they sit next to the band in `renderMap.js` but are a correctness fix), and — since 2026-08-21 — **`src/config.js` is no longer a whole-file delete**: it also exports `INDEXING`, which has nothing to do with the pilot. Delete the `PILOT` export from it and keep the rest, or the site silently stops being indexable at the moment it stops being a pilot.
4. **Revisit the copy.** See below — most of it should *stay*.

Leaving the `<script>` tags in place after `PILOT_MODE=0` is harmless: the route serves an empty file.

## What must NOT come back when the pilot ends

Two things changed in this work that are corrections, not pilot chrome, and are not gated on the flag:

**Truthful copy.** "Maps our customers have published" was false. So were "those are live, kept up to date", "we will get back to you", "our team", "always looks right". These were rewritten to be true regardless of pilot state. When the pilot ends the claims may become true again — but they should be re-made deliberately, against real customers, not restored by reverting a commit.

**Sample labelling.** `customer.is_demo` flags the organisations `scripts/seed-demo.mjs` invents — Broadmeadow Parish Council, Fenmarsh District Council and Oakfield Community Transport Trust (all suffixed "(demo)"), holding **0, 1 and the rest** of the seeded maps so the empty-dashboard, single-map and multi-map states are all demoable. Fully fictional names, not paired with any real body — the grouping is by map-count, not by "this council owns its own map". They render a red **Sample** badge and an explicit "this organisation is invented" note on `/maps`, `/m/<slug>`, `/o/<slug>` and the home strip. Demo data stays demo data after the pilot ends. The flag is set on creation *and* backfilled on every re-run of the seed, so instances seeded before it existed get labelled too.

## The byte-identical gate

`npm run verify:area` / `verify:place` compare the **generator's** output against a shipped fixture. The stamp is applied after generation, and the two verify scripts pass `stamp: false` explicitly (`generateSvg({ …, stamp: false })`) so the gate tests determinism, not presentation. Both stayed green through this work; so did `npm test` (P6, P7, lifecycle).

Do not "fix" a red gate by disabling the stamp globally — if the gate goes red, the generator changed.

## Things this deliberately does not touch

- **Emails.** None are sent; the magic link is printed to the server console. When an email provider is wired up, the pilot wording will need adding then.
- **`legal.html` / `terms.html`** beyond a pointer to the FAQ entry. They were already correctly pre-launch in tone ("offered as it is", "we may change, pause or withdraw", no SLA, no warranty) and are the model the rest now follows. Their outstanding gates — the legal read, the data-controller identity, the governing law — are unchanged and still open.
