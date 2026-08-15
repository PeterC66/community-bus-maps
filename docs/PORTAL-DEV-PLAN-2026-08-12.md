# Portal development plan — 12 August 2026

<!-- docstamp v1.2 | 2026-08-13 | sha=e4cc23aa -->
**v1.2** · updated 13 August 2026

Plan only where marked `—`. Status is per item, so a later session can pick this up mid-flight —
update the Status column as you go, don't just tick things off at the end.

Status legend: `—` not started · `WIP` in progress · `✅` done · `⏸` deferred (say why).

Scope: portal code and copy. Map-engine/content work (stale live refreshes, S6 findings for
March/Huntingdon/Wisbech/High Wycombe, the St Ives route 69 question) and business decisions
(bustimes.org licence sign-off, the BUSL Change Date bump) are tracked elsewhere — see the
pointers at the bottom — and are not part of this doc.

## Build order and why

1. **Admin: reassign a user's organisation** first — small, and item 2 cannot be tested without it.
2. **Prove the three transactional emails reach a real inbox** — needs item 1 done first.
3. **H9 — admin's editor's-eye view** — small, standalone, closes the update-flow backlog.
4. **Part B — place-name search** — medium feature, standalone.
5. **P8a rebuild** — largest job (36 conflicts against current `main`), and has a product question
   to settle before writing code (full-fidelity SVG online vs the watermark policy the rest of the
   site now uses) — done last so the smaller wins land first.

| # | Item | Status |
|---|------|--------|
| 1 | Admin can change which organisation a user belongs to (`customer_id` into the whitelist, a customer picker on the users tab, an audited move) | ✅ |
| 2 | Prove the three transactional emails against real Resend delivery, end to end | ✅ |
| 3 | H9 — admin's editor's-eye view: don't offer an admin the actor's button on a map that's someone else's move | ✅ |
| 4 | Part B place-name search | ✅ *(already done — see below)* |
| 5 | Rebuild P8a (online-first published maps: viewer, text alternative, accessibility page) against current `main`; branch `p8a-maps-online` is 123 commits behind with 36 conflicts, treat as a spec + reference implementation, not a mergeable branch | ✅ |

## Item 5 detail (done)

The SVG-vs-watermark open question resolved itself before any code was written: the public `/m/:slug`
page has offered an unauthenticated, unwatermarked "Download vector (SVG)" link since P6 —
watermarking (`src/render/watermark.js`) has only ever applied to JPGs. So P8a's full-fidelity inline
SVG viewer introduces no new exposure; it just presents inline what the site already lets anyone
download. Confirmed live against `https://busmaps.uk/m/beaconsfield-waitrose` before starting.

Rebuild method: isolated the clean P8a diff from its own branch history (`git diff a6f9f71~1 a6f9f71`
— 32 files, 1,540 insertions, independent of the 123 commits of drift) rather than trying to merge the
whole stale branch, then cherry-picked that one commit onto current `main` and resolved each conflict
by hand, file by file — 8 files with real conflicts (`CHANGELOG.md`, `README.md`, `docs/ROADMAP.md`,
`package.json`, `src/maps/engine.js`, `src/publish/index.js`, `src/server.js`,
`public/js/public-map.js`, `public/map.html`), 9 more resolved by keeping `main`'s current version
outright (pure chrome/nav conflicts, since main's `scripts/lib/site-chrome.mjs` + `npm run
chrome:apply` — which didn't exist when P8a was built — regenerates the nav/footer on every page
including the two new ones, `accessibility.html` and `services.html`, once `FOOTER_HTML` gained an
Accessibility link).

Three things needed real judgement, not just picking a side:

- **The publish checklist.** P8a wanted to add a 6th required item (`alternative`) and set
  `CHECKLIST_VERSION` → 2 — but `main` had already taken 2 *and* 3 for the unrelated H1 "on every
  sheet" wording pass. Kept `main`'s current wording for the first five items, added `alternative` as
  the sixth, bumped to version 4 (the next free number, not a reused one).
- **Watermark-safe caching.** P8a's new `cached()` helper gives published artefacts a year-long
  immutable cache when requested `?v=<pub_key>` — safe for anything that can't vary by viewer, unsafe
  for a JPG this map might watermark (watermarking depends on `req.user`, so a shared/CDN cache could
  serve one visitor's watermarked copy to another, or vice versa). P8a predates the watermark feature
  entirely, so this collision existed nowhere in its own history. Resolved: JPGs eligible for
  watermarking keep the original short, private cache; everything else (SVGs, and JPGs from a
  customer with watermarking off) gets the new immutable one.
- **The `#report` anchor-scroll workaround.** The old code waited for a plain `<img>`'s `load` event
  before re-scrolling to the "Spotted a problem?" card, because the image's height was unknown until
  it loaded and reflowed the page. The new inline-SVG viewer's stage has a fixed CSS aspect-ratio box
  (`.viewer-stage`), so its size is known synchronously — the wait-for-load workaround no longer
  applies to anything and was simplified to a single `requestAnimationFrame`.

Verified: `npm test` (including the new `scripts/test-p8a.mjs` and `check-chrome.mjs` across all 14
public pages) and `npm run verify` (byte-identical, area + place) both green; then live in the browser
against the local dev instance — the St Ives map page serves genuine inline SVG (`viewer.classList
.contains('is-vector')` true, a real `<svg>` in the DOM), its service list at `/m/st-ives/services`
matches the map, `/accessibility.html` and the canonical footer render correctly, and
`CHECKLIST.map(c => c.id)` confirms the 6-item list server-side. Not yet deployed — deploy remains a
manual VPS step.

## Item 4 detail (turned out already done — corrected, not built this session)

This session's plan listed Part B (place-name search) as `—` not started, on the strength of the
`project_bus_portal_header_search_plan` memory, which was itself stale. **It was actually built and
merged before this session began**: `5f36d63` "P9 Part B: place-name search" (#15), merged via #14,
2026-08-10 — the search box on `/maps` and the homepage hero, the `places.json` sidecar written at
publish time, `GET /api/public/search`, typo tolerance, the no-match demand-capture path, and
`scripts/test-search.mjs` (already green in every `npm test` run this session). `docs/P9-header-and-place-search.md` itself already showed the whole B1–B8 table as ✅ — this plan doc
just hadn't been cross-checked against it. Confirmed live: `https://busmaps.uk/maps?q=Swavesey`
returns both Huntingdon and St Ives with the matching route named ("Route T1/B passes through
Swavesey"). The only thing P9 itself still leaves open is the header magnifier link (deferred by
design, decide whenever). No code changed for this item — this entry exists so the next session
doesn't repeat the same stale-memory mistake.

## Item 3 detail (done)

Two independent pieces, both from `portal-update-flow-findings_2026-08-11.md` section H9:

- **The toggle.** `public/js/editor-eye-view.js` — a `localStorage` flag, no auth/scoping change.
  When on, every `[data-eev-hide]` element is hidden (the static Review/Admin nav links on
  `admin.html`, the conditional ones on `index.html`/`review.html`, and the Refreshes tab's
  Accept/Decline buttons, re-applied after each row render since those are added dynamically) and a
  banner names the view with a **Turn off** button. The control itself is a checkbox in `admin.html`'s
  header, wired in `admin.js`. Script load order matters: it's a plain (non-deferred) `<script>` tag
  placed immediately before each page's own script, so `window.EEV` exists before that page's
  role-based nav logic calls `EEV.apply()`.
- **The wording fix**, independent of the toggle — this is the concrete defect seen live on
  2026-08-12: the status strip said "their move" while still offering a working button, because an
  admin passes `loadOwnedMap` on any customer's map. `editor.js`'s `buildStatusStrip()` now reads
  "their move · you can act as admin" when the viewer is an admin looking at someone else's map, so
  the pill and the button agree — chosen over the doc's other candidate fix (making the toggle change
  what the strip says), since this is true regardless of whether the toggle is on.

Verified locally: toggling on hides Review/Admin and shows the banner (confirmed via
`getComputedStyle` since the accessibility-tree read lagged one click behind the DOM); "Turn off"
restores both; the strip on an admin-viewed customer map reads the new text.

## Item 2 detail (done)

Deployed PR #28 to the live VPS (`docker compose run --rm backup && git pull && docker compose
build portal && docker compose up -d portal`; `/health?deep=1` confirmed `gitSha: 5e20950`, all
four checks green). Signed in as admin on `https://busmaps.uk`, reassigned the stuck test editor
(`petercooper366@gmail.com`) from platform-level to *BusMaps.uk (pilot)* via the new picker —
audit log showed the `user.reassign` row with the correct from/to org names. Published the one
map already awaiting review (Beaconsfield Waitrose v2.0, a routine engine-rollout rebuild with no
service-fact changes) through the normal five-item checklist. The editor's inbox received the
"published" notification via Resend, addressed to them (not the admin who published), naming the
map and linking `https://busmaps.uk/m/beaconsfield-waitrose`. All three transactional emails
(update-ready, published, sent-back) share the same `recipientsFor()` path, so this proves the
last mile for all of them, not just this one kind.

## Item 1 detail (done)

`updateUserAdmin()` in `src/db/index.js` whitelists `name`, `role`, `status` only; `POST
/api/admin/users` treats the customer as optional and leaving the field alone yields
`customer_id = null` — a platform-level account. A user created against the wrong org, or none, is
then stuck: re-adding the address returns `409 already has an account`.

- `updateUserAdmin`: accept `customerId` (`null` = platform, a number = that customer — validated
  by the caller, same pattern as `POST /api/admin/users`).
- `PATCH /api/admin/users/:id`: validate the target customer exists, log the ordinary `user.update`
  audit as today, **and** when the customer actually changes, log a distinct `user.reassign` audit
  event with the from/to org names — moving somebody between organisations changes which maps they
  can see, so it must never be a silent edit.
- `public/app/admin.js`: the users tab gets a customer `<select>` per row (reuse the same customer
  list already fetched for the invite dialog); confirm before submitting if the value actually
  changed.
- `ACTION_LABEL` / `auditDetail` in `admin.js` currently has no entries for `user.*` at all — add
  `user.invite`, `user.update`, `user.reassign` while touching this area, so the audit tab shows
  something other than the raw action string.

## Related, tracked elsewhere

- [[project_bus_portal_map_retirement]] / stale live refreshes — `Buses/Development Docs/` and the
  `/bus-work` worklist, not this doc.
- S6 HARD findings (March, Huntingdon, Wisbech, High Wycombe) and the St Ives route 69 question —
  map-engine work, see `process-efficiency-plan_2026-08-04.md`.
- `LICENSING.md` §5 sign-off and the BUSL Change Date — Peter's calls, not code.
