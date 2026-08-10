# P9 — header cleanup + place-name search

<!-- docstamp v1.3 | 2026-08-10 | sha=c42c8dc8 -->
**v1.3** · updated 10 August 2026

Plan only. Nothing here is built yet. Status is per item, so a later session can pick this up mid-flight — update the Status column as you go, don't just tick things off at the end.

Two changes, deliberately sequenced. **Part A** tidies the site header (small, self-contained, touches 12 near-identical files). **Part B** adds the search a visitor actually wants — "is there a map that covers *my* village?" — and depends on Part A only for where the entry point lives.

Status legend: `—` not started · `WIP` in progress · `✅` done · `⏸` deferred (say why).

## Decisions already taken

Recorded so they don't get re-litigated:

1. **No drop-down grouping Contact / Report an issue / Apply.** They are three different jobs at three different moments — a reader's complaint, a stranger's question, and the pilot's only conversion action. A disclosure menu for three items buys ~50px of bar width and costs a button, `aria-expanded`, keyboard + Escape handling, outside-click dismissal and a mobile story. Worse, it buries the CTA.
2. **"Report an issue" leaves the header instead.** The header link points at `/contact.html?kind=issue`, which only preselects a `<select>` option and swaps a placeholder — it *loses which map the person was looking at*. The map page already has a better affordance: the "Spotted a problem?" form at `public/map.html:52`, which posts to `/api/public/feedback` with the map slug attached. The header link is a worse duplicate of an existing feature. It stays in the footer.
3. **If a drop-down is ever wanted, it groups the low-traffic items** (FAQ, Contact, Take this on, Privacy, Terms) under "More" — never the CTAs. Not at the current page count.
4. **Examples stays.** It is not redundant with `/maps`: it carries the complexity-scoring story (High Wycombe RED → GREEN) that feeds Pricing.
5. **Search is not site search.** The FAQ is 20 `<details>` on one page and the gallery is 13 cards; Ctrl-F beats anything we would write. Search earns its place only by answering the coverage question against *place names inside the maps*.

## Part A — the header

Target bar, signed out:

`🚌 BusMaps.uk` — spacer — Published maps · Examples · Pricing · FAQ · Contact · **[Apply to join]** · Sign in

Signed in, the same slot holds: "Signed in as …" · My maps · [Sign out], and the Apply CTA is removed (current behaviour, keep it).

| # | Item | Status |
|---|---|---|
| A1 | Canonical chrome + a test that enforces it | ✅ |
| A2 | Apply the new nav to all 12 public pages | ✅ |
| A3 | Fixed auth slot; rework `auth-status.js` to fill it | ✅ |
| A4 | CSS for the auth slot and the narrower bar | ✅ |
| A5 | Footer canonicalised (keeps Report an issue + Take this on) | ✅ |
| A6 | Strengthen the contextual issue route on the map page | ✅ |

### A1 — canonical chrome first, so nothing can drift

The header and footer are copy-pasted verbatim into 12 files under `public/`, and the footer alone carries 10 links. Any edit is a 12-file edit with drift risk, so fix the mechanism *before* changing the content.

Add `scripts/lib/site-chrome.mjs` exporting `NAV_HTML` and `FOOTER_HTML` as the single source of truth, plus:

- `scripts/check-chrome.mjs` — asserts every `public/*.html` contains those blocks byte-for-byte between `<!-- nav:start -->` / `<!-- nav:end -->` and `<!-- footer:start -->` / `<!-- footer:end -->` markers. Wire into `npm test`.
- `scripts/apply-chrome.mjs` (`npm run chrome:apply`) — rewrites the marked block in every page from the same constants. One command to change the nav in future.

**Do not inject the nav from JavaScript** the way `site-banner.js` does. It is harmless today because `robots.txt` says `Disallow: /`, but it makes the whole navigation invisible to crawlers the day the pilot ends, and it flashes. Markers + a writer script keep the HTML static with no build step.

Note `public/app/*.html` has its own signed-in chrome and is **out of scope** here.

### A2 — apply the new nav

Remove `Report an issue` from `NAV_HTML`; run `npm run chrome:apply`. Everything else in the bar is unchanged.

Check afterwards: `grep -rn 'kind=issue' public/` should return the footer of each page, `contact.html`'s own script, and nothing in a header.

### A3 — a fixed slot for the auth items

`public/js/auth-status.js` currently *appends* to `.site-header .nav`, so signed-in users get "Signed in as …", "My maps" and a Sign-out button hanging past the primary CTA — three items in a position no page author chose.

- Add `<span class="nav-auth" id="navAuth"></span>` to `NAV_HTML`, after the Apply button.
- Change the script to render into `#navAuth` (`innerHTML`/`replaceChildren`) rather than `nav.append(...)`, falling back to the old append if the slot is absent so a stale cached page still works.
- Keep the existing behaviour of removing `a[href="/apply.html"]` when a user is signed in, and keep the "any other `/api/me` failure — leave the header as-is" branch.
- Keep the element ids (`authWhoami`, `authAppLink`, `authSignin`, `authSignout`) — they are the handles any test or future styling uses.

### A4 — CSS

`public/css/styles.css:67`. Add `.nav-auth { display: inline-flex; align-items: center; gap: 12px; }` and let it collapse to zero width when empty. The existing `@media (max-width: 720px)` wrap rule still applies; re-check the bar at 375px with the signed-in state, which is the widest case.

### A5 — footer

Canonicalise it through the same mechanism. Content unchanged, except it now carries the *only* "Report an issue" link on most pages. Leave "Take this on" (`/opportunity.html`) where it is — it has no header slot by design.

### A6 — make the contextual route the obvious one

Two small edits, so removing the header link doesn't lose anyone:

- `public/map.html` — give the "Spotted a problem?" card an `id="report"` anchor so the footer link and any future copy can deep-link to it. Note it currently sits inside `#asideGrid`, which is `hidden` until `public-map.js` populates it; an anchor into a hidden element does nothing, so either unhide the card independently or have the script honour a `#report` hash after render.
- `public/contact.html` — when `kind=issue`, add a line above the form: *"If it's about a specific map, the form on that map's page tells us which one — [browse published maps](/maps)."* The existing query-param script at `contact.html:65` is the place to put it.

## Part B — place-name search

### The idea, and why it is worth building at all

Searching 13 map titles is pointless. But each map's vendored data already names **every place its buses reach**, and those names are mostly *not* map titles:

- **Area maps** — `routes.json` → `external[]` with `label` (destination) and `stops[]` (intermediate places). St Ives' route B carries `Fen Drayton Lakes, Swavesey, Longstanton P&R, Oakington, Histon & Impington, Cambridge North, Cambridge (Drummer St)`.
- **Place maps** — `routes.json` → `destinations[]` with `name`, `sub`, `routes[]` and sometimes `stops[]`. St Neots Town Centre reaches `Cambridge (Drummer St)`, `Tesco / Eynesbury`, `Newlands Cottages` …
- **Both** — `atco2name.json` gives in-town stop names (464 for St Ives: "Constable Road", "Greenfields"), and `pois.json` gives named landmarks (51 for St Ives, e.g. hospitals, supermarkets).

So typing **Swavesey** — a village with no map of its own — returns *"St Ives area map: route B passes through Swavesey."* That is a real answer to a real question, and it is not available anywhere else.

Second, and for a pilot arguably worth more than the search itself: **a miss is a lead.** "No map covers Somersham yet" → *ask for one* / *know an organisation there?* straight into `/apply.html`. Search doubles as demand capture and tells us which towns people keep looking for.

| # | Item | Status |
|---|---|---|
| B1 | `places.json` sidecar written at publish time | ✅ |
| B2 | Backfill script for the 13 already-published maps | ✅ |
| B3 | In-process index + `GET /api/public/search` | ✅ |
| B4 | Invalidation on publish, revert and unlist | ✅ |
| B5 | UI: search box on `/maps` and the homepage hero | ✅ |
| B6 | The no-match path (demand capture) | ✅ |
| B7 | Tests | ✅ |
| B8 | No query logging — keep `/legal.html` unchanged | ✅ |

**Built 2026-08-10, branch `p9-part-b-place-search`.** Notes for whoever picks this up next:

- Only **12** maps are currently published (not 13 — one fewer than when this doc was written). All 12 are backfilled.
- **`pois.json` turned out to exist for only 1 of the 12 maps** (St Ives) — it isn't written by any generator, just a leftover vendored file. The builder (`src/search/place-index.js`) treats it as optional: present ⇒ indexed with `role:"poi"`, absent ⇒ that map simply contributes no POI entries. No re-render was added to backfill it for the other 11, matching B1's "no re-render" constraint.
- B8's access-log trap was real: Fastify's default `logger:true` logs `req.url` **including the query string** on every request. Fixed with a custom `req` serializer on the Fastify instance (`src/server.js`) that strips the query specifically for `/api/public/search`; every other route's request line is unchanged.
- Ranking is role-first, then match-quality second (exact > whole-word > prefix > substring) — i.e. a weak match on a higher-ranked role (e.g. a map's `subject` field) can outrank a strong match on a lower-ranked one (e.g. a `stop`). Read literally from the plan's own ordering; flagged here in case a real search log later suggests otherwise (there won't be one — see B8 — so this would come from anecdote, not data).
- Tests: `scripts/test-search.mjs`, wired into `npm test` (also `npm run test:search`). Covers the B7 checklist verbatim, including a subprocess run of `check-chrome.mjs`.

### B1 — index from the *published version*, not the live data dir

The trap: `routes.json` lives in the map's working data dir (`data/maps/<id>/data/`), shared across versions — **not** in the version dir, which holds renders. Index it directly and search could claim coverage that the reviewed, published sheet does not show (a refreshed data dir sits ahead of the published version until a proposed update is accepted and re-published).

So: when the publish pointer moves, write a small `places.json` **sidecar into the published version dir** (`versionDir(mapId, storageKey)`), derived from the data dir as it stands at that moment. The index then reads only published version dirs and is guaranteed to describe the sheet a person can actually download.

- Hook: `src/server.js:1381` `POST /api/review/:id/approve`, immediately after `setPublishedVersion(...)`. Follow the shape of `readRoutesMetaFromDir()` in `src/maps/engine.js:189` — a pure read of `routes.json`, no generator run.
- This writes a sidecar; it does **not** re-render, so P4's "publishing never re-renders" holds.
- **Check before writing code:** confirm `verify-reproduce.mjs` / `verify-reproduce-place.mjs` compare named artefacts and not a directory listing, or an extra JSON file in a render folder will trip the byte-identical gate for the wrong reason.

Sidecar shape (one file per published version, small):

```json
{ "schema": 1, "builtAt": "…", "kind": "area", "subject": "St Ives",
  "places": [ { "name": "Swavesey", "via": "B", "role": "stop" } ],
  "pois": [ "Hinchingbrooke Hospital" ] }
```

Which sources are in — **decided 2026-08-09**: destinations and intermediate stops **yes**; `pois.json` **yes** (landmarks are how people describe where they want to go); `atco2name.json` in-town stops **no**. 464 entries per map at street level would dominate results and mostly answer a question nobody asked.

Leave the door open cheaply: build the sidecar with a `role` field already (`"destination" | "stop" | "poi"`), so adding a fourth role later is a change to the *builder* and the ranking, not to the sidecar schema or the endpoint. Revisiting means re-running `npm run places:build` (B2), not a migration.

### B2 — backfill

`scripts/build-place-index.mjs` (`npm run places:build`) — writes the sidecar for every currently-published version. Needed because the 13 real maps were published on 2026-08-09, before any of this existed. Same code path as B1, so there is one implementation, not two.

### B3 — the endpoint

`GET /api/public/search?q=` in a new `src/search/index.js`, with the index built lazily on first request and held in memory (13 maps × a few hundred names is trivial).

- **It must reuse the P6 restriction.** Published, listed maps of active customers only — the same rows `listPublicMaps()` already returns in `src/db/index.js`. Never walk `data/maps/` directly; that would leak unpublished and unlisted work.
- Normalise both sides: lowercase, strip punctuation and `&`/`and`, collapse whitespace, fold "St." / "St" / "Saint".
- Rank: map name > subject > destination label > intermediate stop > POI. Prefix matches beat substring; whole-word beats prefix.
- Return **why** it matched, not just the map — the useful line is "route B passes through Swavesey", not "St Ives".
- Cap at ~20 results, minimum query length 2, and keep the response PII-free like everything else in `src/public/index.js`.
- Carry the `org.isDemo` flag through so **Sample badges survive into search results**. That labelling is explicitly *not* pilot-gated (`CLAUDE.md`), and a result card is exactly where someone could mistake our own test map for an organisation's work.

### B4 — invalidation

The index must drop or rebuild on: publish (B1), **revert** (`POST /api/review/maps/:id/revert`, `src/server.js:1498` — it moves the pointer backwards), and any change to `public_listed` or a customer going inactive. Cheapest correct approach: a module-level generation counter bumped by those paths, with the index rebuilt on the next request. Don't cache in a way that survives a revert.

### B5 — where it lives

**Not an input in the nav bar.** A search field widens the header, which is the opposite of Part A. Instead:

- A proper labelled search box at the top of `/maps`, above the grid (`public/maps.html`), with `id="search"` so `/maps#search` is linkable.
- The same box in the homepage hero (`public/index.html:28`), submitting through to `/maps?q=…`.
- If the header needs anything at all, one magnifier link to `/maps#search` — decide after seeing the bar post-A2, not now.
- Progressive enhancement: it is a real `<form method="get" action="/maps">`, so it works without JS; the JS path just filters in place. `/maps` reads `?q=` on load.

### B6 — the no-match path

This is the point of the feature, not an error state. On zero results:

> No published map covers **Somersham** yet. Maps are made by local organisations — [ask for one](/apply.html), or tell us who might make it.

Keep the wording inside the pilot's truth rules: no promises about when, no implied cadence, no claimed customers (`docs/PILOT.md`).

### B7 — tests

Extend `scripts/test-p6.mjs` (it already owns the public front) or add `scripts/test-search.mjs` to `npm test`:

- an unlisted map's place names are **not** searchable;
- an unpublished draft's place names are **not** searchable;
- a known intermediate stop returns its map with the right "via" reason;
- revert changes the index;
- a demo org's result still carries `isDemo`;
- `check-chrome.mjs` passes on all 12 pages (A1).

### B8 — no query logging

**Decided 2026-08-09: search queries are not logged.** Ship it that way.

The tempting version was query-string-plus-timestamp, no IP and no identifier, on the grounds that the *misses* are a demand signal telling us which town to approach next. Rejected for now: it is a new class of collection on a public page, so it would need its own paragraph in `/legal.html` — a page `ROADMAP.md` already flags as needing a final pre-launch read — and a pilot with no customers does not yet need the signal badly enough to widen what the site collects.

This is a **no for now, not a never.** If it is revisited, the requirements are unchanged: no IP, no identifier, query and timestamp only, a `/legal.html` paragraph landing *before* the first query is written, and a stated retention period. Do not sneak it in as a side effect of "just adding a metric" — `/metrics` (`src/server.js:136`) counts requests, and a counter of *how many* searches ran is fine and needs none of the above; recording *what people typed* is the line.

So B8's actual work is a negative: make sure the endpoint (B3) logs nothing per-query beyond the existing Fastify request line, and check the request line does not carry the query string into the log at whatever level runs in production. If it does, strip `q` there — an access log is still a log.

## Order of work

A1 → A2 → A3 → A4 → A5 → A6, then B1 → B2 → B3 → B4 → B7 → B5 → B6 → B8.

Part A is shippable on its own and worth landing first: it is low risk, and it settles where a search entry point can go. Part B's server side (B1–B4, B7) should be green before any of it is visible (B5–B6).

## Gates

```bash
npm test
npm run verify
```

`npm test` currently makes no assertions about the header, so A2 breaks nothing on its own — which is precisely why A1 adds `check-chrome.mjs` first. `npm run verify` **skips silently** when `FIXTURE_DIR` / `PLACE_FIXTURE_DIR` are unset; confirm it prints PASS with byte counts, especially after B1 touches version dirs.

## Questions — answered 2026-08-09

1. **In-town stop names in the index** (`atco2name.json`) — **out.** Destinations, intermediate stops and POIs only. Written into B1, with a `role` field so a later change is a rebuild rather than a migration.
2. **Query logging** — **none.** Ship search recording nothing about what people typed. Written into B8, including the trap to watch (the access log, and the difference between counting searches and storing queries).

Still open, deliberately:

3. **A magnifier in the header.** Deferred by design — decide after Part A ships and the tidied bar can be looked at. Until then the entry points are `/maps` and the homepage hero (B5), which is enough on its own.
