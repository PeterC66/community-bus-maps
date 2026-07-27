# Pilot mode — what it claims, and how to switch it off

<!-- docstamp v1.0 | 2026-07-27 | sha=8adef294 -->
**v1.0** · updated 27 July 2026

**For:** the operator. **Status:** pilot mode is **ON**.

Community Bus Maps was built as if it were a running service. It isn't. There are
no customers, no organisation has signed up, and every map on the site is one we
made ourselves. The copy said otherwise — "maps **our customers** have published",
"those are live, kept up to date", "**our team** then builds the map data" — and
anyone reading it, a council clerk or a colleague, would have concluded there was
an established service behind it.

Pilot mode is the correction. It is deliberately loud, and deliberately easy to
remove: **one environment variable turns all of it off.**

## Why "pilot"

Considered and rejected: *experimental* (reads as "may break your data" — wrong
signal for a deterministic print product), *beta* (software jargon; means little
to a parish clerk), *prototype* (undersells finished sheets), *preview* (vague).

**Pilot** is the word a council understands: real work, real output, early stage,
small scale, no promises yet. What is *not* provisional — and the wording is
careful about this — is the care taken over the maps themselves. They are built
from official open data, cross-checked, and signed off by a person. The pilot
label is about the **service around them**.

## What it does

| Surface | What appears | Where |
|---|---|---|
| Every web page (17 static files + the 404) | Amber banner above the header; `[Pilot]` prefix on the tab title | `/js/site-banner.js`, generated in `src/server.js` |
| Every rendered sheet | Red band across the top: *PILOT — SAMPLE MAP · Made to test the system…* | `src/render/pilotStamp.js` |
| Search engines | `Disallow: /` | `src/server.js` robots handler |
| FAQ | The `#pilot` entry — the banner's link target, and the honest long version | `public/faq.html` |

The banner is injected by one generated script rather than pasted into
seventeen hand-written HTML files, because there is no template engine here.
Each page carries a single `<script src="/js/site-banner.js" defer>` tag.

The sheet band **reserves space** rather than overlaying. The sheets have no
reliable whitespace — the corners are taken by the title, the Services panel and
the credits line — so the artwork is shrunk ~4% and slid down, and the band sits
in space that belongs to nothing. That works for all four outputs and for any
output added later. It is applied *after* the generator runs, which is why the
byte-identical reproduce gate is unaffected (see below).

## Switching it off

```bash
PILOT_MODE=0
```

That is the whole switch — restart and every item in the table above is gone.
Then, in this order:

1. **Set `PILOT_MODE=0`** in the deployment environment (and `.env`).
2. **Restamp the stored sheets.** Renders in the object store keep whatever band
   they were rendered with, including versions already signed off and published:
   ```bash
   node scripts/restamp-renders.mjs --apply
   ```
   With `PILOT_MODE=0` this *strips* the band and re-rasterises each JPG. The
   transform is lossless — a stamped sheet stripped again is byte-identical to
   the original. Run it without `--apply` first for a dry run.
3. **Delete the code.** `grep -rn "PILOT:" --include=* . | grep -v node_modules`
   finds every gated block. Whole files: `src/config.js`,
   `src/render/pilotStamp.js`, `scripts/restamp-renders.mjs`. Everything else is
   a marked block or a one-line `<script>` tag. **Not** `src/render/badgeContrast.js`
   or `scripts/fix-badge-contrast.mjs` — they sit next to the band in
   `renderMap.js` but are a correctness fix, and must survive the pilot.
4. **Revisit the copy.** See below — most of it should *stay*.

Leaving the `<script>` tags in place after `PILOT_MODE=0` is harmless: the route
serves an empty file.

## What must NOT come back when the pilot ends

Two things changed in this work that are corrections, not pilot chrome, and are
not gated on the flag:

**Truthful copy.** "Maps our customers have published" was false. So were "those
are live, kept up to date", "we will get back to you", "our team", "always looks
right". These were rewritten to be true regardless of pilot state. When the
pilot ends the claims may become true again — but they should be re-made
deliberately, against real customers, not restored by reverting a commit.

**Sample labelling.** `customer.is_demo` flags the organisations
`scripts/seed-demo.mjs` invents (St Ives Town Council, March Town Council,
Beaconsfield Health Centre — all named after real bodies that have no connection
with this system). They render a red **Sample** badge and an explicit "this
organisation is invented" note on `/maps`, `/m/<slug>`, `/o/<slug>` and the home
strip. Demo data stays demo data after the pilot ends. The flag is set on
creation *and* backfilled on every re-run of the seed, so instances seeded before
it existed get labelled too.

## The byte-identical gate

`npm run verify:area` / `verify:place` compare the **generator's** output against
a shipped fixture. The stamp is applied after generation, and the two verify
scripts pass `stamp: false` explicitly (`generateSvg({ …, stamp: false })`) so
the gate tests determinism, not presentation. Both stayed green through this
work; so did `npm test` (P6, P7, lifecycle).

Do not "fix" a red gate by disabling the stamp globally — if the gate goes red,
the generator changed.

## Things this deliberately does not touch

- **Emails.** None are sent; the magic link is printed to the server console.
  When an email provider is wired up, the pilot wording will need adding then.
- **`legal.html` / `terms.html`** beyond a pointer to the FAQ entry. They were
  already correctly pre-launch in tone ("offered as it is", "we may change, pause
  or withdraw", no SLA, no warranty) and are the model the rest now follows.
  Their outstanding gates — the legal read, the data-controller identity, the
  governing law — are unchanged and still open.
