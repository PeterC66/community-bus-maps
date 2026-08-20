# Changelog

<!-- docstamp v1.70 | 2026-08-20 | sha=a31306ea -->
**v1.70** · updated 20 August 2026

Notable changes to BusMaps.uk. Loosely follows Keep a Changelog; dates are ISO (YYYY-MM-DD).

## [Unreleased]

### Security / operations — the P1 block of the technical audit — 2026-08-20

The half of `Development Docs/technical-audit_2026-08-19.md`'s P1 list that lives in this repository. Same theme as P0: none of these are defects in the code that was thought about hardest, they are the belt around it.

- **S2 — `sharp` upgraded to 0.35.3, and the deferral closed six weeks early.** The last outstanding high-severity advisory in the production tree (`GHSA-f88m-g3jw-g9cj`) needed a major bump of the rasteriser, and had been deferred to 2026-10-01 because every published sheet's bytes are a product guarantee. `npm audit --omit=dev` now reports **0 vulnerabilities**, and `scripts/audit-allowlist.json` is empty for the first time.
- **The re-baseline turned out to be a no-op, which is the outcome and not the reason.** `sharp 0.34.5 / libvips 8.17.3 → 0.35.3 / 8.18.3` moved **not one byte**, and — this is the part that matters — **not on Linux either**. The render-parity workflow ran on the same probes before and after the bump: on `node:24-slim`, the actual deployment target, `geometry` stayed byte-identical at 418,761 B and `text` stayed at 683,470 B; on the bare Ubuntu runner, 418,761 B and 683,501 B; the Arial ink ratio stayed 4.376 on both. Every SVG gate passes unchanged and all 37 stored JPGs in the dev store re-rasterise to identical bytes. So the post-deploy `rerasterize-stored.mjs --check` is a confirmation rather than an open question. The baseline file records the new versions against the same four hashes, which is a more useful thing to have written down than a fresh set of numbers would have been.
- **The rule is now written down where it will be read: a security patch outranks byte continuity.** In the Dockerfile beside the sharp note and in `docs/DEPLOY.md` §7. A re-baseline is a normal, announced, recoverable event; an unpatched image parser in production is not.
- **`scripts/rerasterize-stored.mjs --check`.** The dry run listed what it would do; it could not say whether doing it would change anything. `--check` rasterises each stored SVG to a scratch file, compares, writes nothing, and reports how many would move — the question a rasteriser or base-image change actually raises, asked on the host where the published bytes live. It tells you to *look at* a changed sheet before applying, because the Liberation Mono incident moved bytes too and every sheet was wrong.
- **V2 — the determinism gate ran on exactly one machine, and said nothing about it.** The audit called this the single most important structural item in the report and "the one thing to fix if only one thing gets fixed": the product's central technical claim is same inputs, same bytes; `npm run verify` demonstrates that claim; and it needed `FIXTURE_DIR` pointing under `Areas/**/S5-render/**`, which is git-ignored — so it could not run in CI, in a fresh clone, or by a second developer or an acquirer's reviewer. And it printed "skipping" and exited 0, so the absence looked like a pass. Three parts to the fix. `buses-data` now commits an **area** fixture at `Areas/_portal-fixture/St Ives` (2.8 MB — no JPGs, because rasterisation is expected to differ by platform and that is what `render-parity.yml` is for), the way it already committed a place one. `scripts/lib/fixtures.mjs` resolves the committed fixture automatically from `BUSES_DIR` or a sibling checkout, and **fails rather than skips** when there is nothing — `--allow-skip` remains for a portal-only clone and announces that it proved nothing. And `.github/workflows/verify.yml` runs `verify:area`, `verify:place` and `verify:defaults` as three named steps on every push and PR, and nightly, because the fixture lives in another repository and moves when the engine does.
- **Proved, not asserted.** All four gates pass against a **fresh sparse clone of `buses-data` at an unrelated path** with no `FIXTURE_DIR` set at all, and `verify:area` goes red and exits 1 on a one-character change to the fixture's `internal.svg`. Measured while doing it: St Ives alone now exercises all thirteen escape hatches, so one fixture is enough — though it was not two days earlier, which is why the fixture README says the count is not a constant and that a key reporting dead usually means adding a second town, not excluding the key.
- **A latent trap found while committing the fixture.** `core.autocrlf=true` with no `.gitattributes` meant Git stored the fixtures with LF and would rewrite them to CRLF on checkout — invisible in the working copy that produced them, invisible in Linux CI, and a guaranteed false "determinism failure" in a fresh clone on Windows. Green in CI and red for the second developer is the worst available version of that bug, and the second developer is the entire point of committing fixtures. `-text` on both fixture trees; the place fixture had carried the same trap since it was first committed.
- **S6 — the separation of duties was documented and not implemented.** `README.md`, `docs/H1`, `docs/R3` and `src/publish/index.js` all said "the editor who makes a change never publishes it". `POST /api/review/:id/approve` checked the role, the request's existence, its pending status and the checklist, and **never compared `pr.requested_by` to the approver's id** — so all 41 publications to date were self-approved. It now refuses with `409 self-approval`, unless `ALLOW_SELF_APPROVAL=1`, and a publication made under that override is stamped `selfApproved: true` in the decision evidence, the audit row and the API response. The override is set on the live host because with one operator the alternative is that nothing publishes at all — but the audit trail can now tell the two eras apart, which is the whole point. The review screen says which situation you are in before you tick anything.
- **S5 — thirty-day sessions, no revocation, no re-authentication.** Sessions are now **7 days and sliding** (extended on use, at most hourly, with the cookie re-sent so the browser's copy slides too). Publishing, changing an organisation's settings and changing a user's role now need a sign-in from the **last 30 minutes** (`403 step-up-required`) — anchored on when the session was created, so staying signed in never re-earns it. **Admin → Sessions** lists everyone signed in and revokes any session on the spot; sessions are named by a 12-hex handle derived from the token, never by the token, because a list of live tokens is a list of accounts whoever reads the screen could become. Together these retire the standing admin cookie kept in a file on the laptop.
- **A real bug the new tests caught, not the reading.** `getSession()` never selected `session.created_at`, so the step-up check saw `undefined` on every session, judged all of them stale, and refused every privileged action. It looked fine in the source of both halves; `scripts/test-audit-p1.mjs` drove a real request through the route and it went red immediately.
- **S4 — `/health` told strangers too much.** Anonymous callers got the git SHA, the build time, the exact `sharp` and `libvips` versions, the object-store path and eleven business counts. They now get four fields: `status`, `service`, `version`, `time`. Everything else needs `METRICS_TOKEN` or an admin session — the same gate `/metrics` already used, now factored into one `opsAuthorised()` instead of two hand-rolled copies. **The verdict deliberately stayed public**: `?deep=1` still runs and still 503s for anybody, because the Uptime Robot check and the container `HEALTHCHECK` need only the status code, and gating it would have turned every poll into a 401 — paging about a fault that does not exist, which is the fastest way to teach an operator to ignore an alert. Nothing had to be reconfigured. The readiness probe also gained a 10-second cache, so it cannot be used to make the box rasterise on demand.
- **O4 — sign-in could fail silently, and did.** The dev fallback keyed on *configuration*, so a configured provider that threw — bad key, outage, suspended domain — was logged and swallowed while the caller was told to check their inbox. Now: email **configuration** is a readiness check (a provider named with no key, or no provider at all in production, is a fault); **delivery outcomes** are counted in `src/email/health.js` and surface as a rank-0 worklist item, deliberately *not* in readiness, because a Resend outage is not the site being down; and after three consecutive failures new sign-in requests are refused with an honest `503` instead of a false success. The refusal is decided before the address is looked at, so it stays free of user enumeration. The console fallback is never used when a configured provider fails — printing a live credential into production logs is worse than failing.
- **`npm run smoke:signin`, run at the end of every `npm run deploy`.** Sends one real magic link to `ADMIN_EMAIL` and reads the **server log** for the result, because the HTTP response is identical whether or not the address is registered and so cannot be the evidence. `deploy.mjs` step 5 also now captures its exit code — it discarded it, exactly as `deliver-map.mjs` step 6 did before O3.
- **S7 — the app shells were static files.** `/app/admin` correctly redirected an anonymous visitor; `/app/admin.html` returned 200 to anyone, because `@fastify/static` serves all of `public/`. No data leaked (every API behind them 401s) but a role check on a pretty URL that reads like an access control and isn't one is exactly what a reviewer tests. The eight HTML shells moved to a new top-level `views/`, outside the static root; `/app/login.html` keeps its URL and stays anonymous by design, and `/app/review-services.html` — a static file with no route at all, holding a reviewer's view of an unpublished map — is now behind the same guard as `/app/review`. The app's `.js` and `.css` stay public. **The Dockerfile needs its new `COPY views ./views`**: miss it and every `/app` page 404s while the public site looks fine.
- **V6 — the base image was a floating tag under a comment claiming it was pinned.** `FROM node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03` (the multi-arch index digest for `node:24-slim` as at 2026-08-05, resolved 2026-08-20). A `docker` ecosystem added to `dependabot.yml` is the other half of the trade — a pin stops the bytes moving unannounced, and a monthly PR stops the pin ageing into an unpatched Debian.
- **V3 — the gate board knew, and nothing read it.** Every town's S6 verification was 8–31 days stale while all 13 maps were live, and `status.js` had been printing `28d STALE` beside each one for weeks. `npm run deliver` now refuses a town whose latest S6 run pre-dates its newest S1/S2/S3 data — first, locally, before the `scp`, so a refusal costs nothing and the host is untouched. The byte gate proves the portal reproduces the render; S6 is the stage that asks whether the map is *right*. Deferrals live in `scripts/s6-waivers.json` with an `until`, a `why` and a `removeBy` per town, on the same pattern as `audit-allowlist.json` and for the same reason: all eight towns were stale on day one, and a gate that starts red gets muted. An expired deferral is refused as loudly as a missing one. Place maps have no S6 stage and the check says so rather than passing silently — the first cut got that wrong and blocked every place delivery, which is what a test with a synthetic place manifest is now there to stop.
- **The V3 gate closed its first waiver on the day it landed.** A separate session refreshed St Neots against a same-day BODS feed and ran S6 after S3 (09:23 then 09:26), so the gate reports that town as *verified* rather than deferred and its row has been deleted from `scripts/s6-waivers.json`. Seven remain. That is the whole intended lifecycle of an entry there — run S6, delete the row — happening on the first real encounter rather than being described in a comment.
- **`scripts/test-audit-p1.mjs`, wired into `npm test`.** Every one of the above is a rule a later edit could undo without breaking anything visible. The route-level halves are asserted against a real Fastify instance through `app.inject()` rather than by reading the source — because the S7 and S6 findings were both cases where the source said the opposite of what the server did. Falsified before being trusted: with `ALLOW_SELF_APPROVAL=1` the S6 assertions go red, and the "a different approver publishes it" case exists so the suite cannot pass by approve being broken for everybody.

### Security / CI — the P0 block of the technical audit — 2026-08-19

Seven items from `Development Docs/technical-audit_2026-08-19.md`'s P0 list. The theme of that audit was that the correctness controls here are strong and the *operational* ones were manual and lived in one person's head; this is the first of those gaps closed.

- **S1 — the site had no security headers at all.** The `Caddyfile` now sets HSTS (`max-age=31536000; includeSubDomains`, deliberately **no** `preload` — that is effectively irreversible and should be its own decision), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and a strict CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; …; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`. The CSP is the real prize — `public/js/map-viewer.js` injects a published SVG with `canvas.innerHTML = svg`, so that SVG runs in our own origin, and the place names in it come from OpenStreetMap, which anyone in the world can edit. Until now the only thing in its way was the regex denylist in `src/public/inlineSvg.js` (S9), which does not cover `<foreignObject>`, `<animate attributeName="href">` or entity-encoded variants. **The `Caddyfile` is deployed by hand and by nothing else** — see `docs/DEPLOY.md` §3a.
- **Three inline `<script>` blocks moved out of `public/`** — from `contact.html`, `app/index.html` and `app/login.html` into `/js/contact-kind.js`, `/js/app-dashboard.js` and `/js/app-login.js`, all loaded `defer`. This was not tidying: `script-src` cannot say `'self'` while inline scripts exist, and an `'unsafe-inline'` allowance is site-wide, so it would have handed the SVG-injection exemption straight back. There are now no inline scripts anywhere under `public/`, and keeping it that way is a constraint, not a preference.
- **S2 — four high-severity advisories in the production tree, and nothing scanning for them.** `fast-uri` and `brace-expansion` patched (both transitive, patch-level, `package.json` untouched). Added `.github/dependabot.yml` and a `dependency audit` workflow. `sharp` is **not** fixed here: the fix is a major bump of the rasteriser and every published sheet's bytes are a product guarantee, so it needs `npm run verify` and a re-baseline — it is a P1 item and it is now *tracked* rather than merely known.
- **A new advisory the audit did not have, now fixed.** `@fastify/static` picked up four highs (path traversal, route-guard bypass, authorisation bypass via non-canonical paths) after that document was written — a reminder that `npm audit` still read "4 high" while its contents had turned over completely. **Upgraded `8.3.0` → `10.1.3`**, two majors, on the component serving every file under `public/`. Checked before doing it: v9 is dependency bumps only, and v10's single documented breaking change is `setHeaders` receiving a `FastifyReply` instead of a Node `Response` — an option this codebase does not use. The registration is one line (`{ root: PUBLIC_DIR, index: ['index.html'] }`) and the seven `reply.sendFile` call sites are unaffected.
- **Verified by hand, because `npm test` does not exercise static serving.** Every static asset type and both index paths still resolve; all seven `reply.sendFile` routes serve behind their guards, signed in and out; the six admin/review APIs still 401 unauthenticated; and eight traversal and encoded-separator probes (`/../package.json`, `/..%2f`, `/%2e%2e/`, double-encoded, `/.env`) all return 403 or 404 with no file contents. A published map page renders identically to before the bump (same SVG, same 122 text nodes) and the signed-in dashboard still lists its 13 maps, both under the new CSP.
- **The audit gate is written not to cry wolf.** A bare `npm audit --audit-level=high` would have been **red from its first run**, and a check that is red on day one gets muted inside a week — the audit's own V4 names gate fatigue as a live problem here. So `scripts/audit-check.mjs` fails on a high/critical advisory that is *not* in `scripts/audit-allowlist.json`, on a *new* advisory against an already-deferred module, and — the point of the design — **on a deferral whose `until` date has passed**. A deferral has to be renewed deliberately; it cannot rot into a permanent exemption nobody re-reads. All three failure modes were triggered by hand before the workflow was committed.
- **V1 — the test suite ran in no CI at all.** `npm test` is ~380 assertions and the only workflow in the repo was `render-parity.yml`, whose `paths:` filter meant a change to `src/server.js`, `src/db/`, `src/auth/`, `src/publish/` or anything in `scripts/` triggered nothing. Added `.github/workflows/test.yml` on push and PR with **no `paths:` filter**. Checked before wiring it up that the suite passes with no `.env` and an empty `DATA_DIR` (i.e. on a fresh clone), and that it genuinely goes **red** — a one-character edit to a footer block failed `check-chrome` with exit 1.
- **O3 — the last gate in a delivery was decorative.** `scripts/deliver-map.mjs` step 6 ran `curl -fsS …/health?deep=1` and **discarded the result**, so a delivery that left the service unhealthy still printed `✓ delivered`. It now captures the status, exits non-zero, and prints the two commands worth running next. Steps 1–5 always did this; step 6 was the only one that didn't.
- **S3 — the rate limiter was bypassable and leaked memory.** `trustProxy` was `true`, which trusts the whole `X-Forwarded-For` chain and takes the *leftmost* entry — the one the client sent. Since Caddy appends rather than replaces, anyone could choose their own `req.ip` and rotate it to defeat every public POST limit. Now `1`: exactly one hop, the local Caddy. The `hits` map also had no eviction anywhere, one entry per distinct (spoofable) address for the life of the process; it now has a five-minute sweep and a hard cap.
- **S10 — nine `REFERENCES` columns that SQLite was ignoring.** `PRAGMA foreign_keys` was never set, so every declared foreign key was documentation. Now `ON`, plus a `busy_timeout`. Checked first rather than assumed: `PRAGMA foreign_key_check` is clean on the **live** database (the 2026-08-18 backup) as well as the dev one, and `scripts/delete-map.mjs` — the only script that removes a parent row — already clears `map`'s two self-referencing version pointers before deleting the `map_version` rows it points at.

**O2 closed 2026-08-20.** An external Uptime Robot check now polls `https://busmaps.uk/health?deep=1` every five minutes and alerts Peter by email; confirmed working from his end, and the endpoint verified returning 200 with all four readiness checks green at the time it was set up. This is the half of O3 that reaches a human who is not at the keyboard: `deliver-map.mjs` stops the portal for every delivery and **deliberately leaves it stopped** if the import fails, which is a sound loud-failure design only if something raises the alarm. Until now the entire detection capability was the operations handbook's "glance at readiness".

`?deep=1` rather than `/health` on purpose — it returns **503** when a dependency is unhealthy, so the check catches "up but broken" and not merely "port open". Two consequences worth holding on to. It is not a free ping: each call queries the database, writes and deletes a probe file, and rasterises a small image through sharp, so the interval should not be tightened much below five minutes on a single small VM. And **S4 will break this monitor if nobody thinks about it** — that P1 item moves `?deep=1` behind the `METRICS_TOKEN` gate, at which point the check starts returning 401 and paging about a fault that does not exist. A note to that effect now sits next to the route handler in `src/server.js`.


### Added — `verify:defaults` proves the design escape hatches aren't dead code — 2026-08-18

- **New gate**: `npm run verify` now also runs `verify:defaults` (`scripts/verify-reproduce-defaults.mjs`
  + `scripts/verify-reproduce-place-defaults.mjs`), built 2026-08-17. It builds each fixture once
  as-is, then once per `design:{key:false}` / `labels:{engine:"v1"}` escape hatch, and asserts every
  variant differs from as-is on at least one sheet — proving the second invariant in this file
  ("absent config ⇒ previous behaviour") that nothing in `npm run verify` had ever tested. Two earlier
  designs were tried and proven wrong by deliberately breaking a key and watching the gate stay green
  (full account in `verify-reproduce-defaults.mjs`'s header and `CLAUDE.md`'s resolved WIP note).
- **`hubFit` excluded from the PLACE-side check, with a cited reason**: the `High Wycombe Aldi` fixture
  can't exercise it — both the `hubFit`-on and legacy-off `HUB_W` formulas in `gen_external_places.js`
  reduce to the same 26mm floor for a 4-character place name, so the two codepaths are byte-identical
  for this one place regardless of what the key does. Confirmed via an isolated re-run against the
  unmutated engine and by reading `HUB_W`'s two branches directly; corroborated by the AREA-side gate
  (`St Ives`), where `hubFit` genuinely differs. See `CLAUDE.md` for the full record.
- `.env`'s `FIXTURE_DIR` repointed to a fresh `St Ives` render and `Buses/Places/_portal-fixture/High
  Wycombe Aldi/routes.json` refreshed to match G5's `design:{}`/`labels:{}` convention, so the new gate
  runs against current, not stale, fixture config.

### Changed — public text follows current bus policy, not the 2021 strategy — 2026-08-18

- **`public/pricing.html` no longer cites BSIP funding.** "Bus Service Improvement Plan funding carries a passenger-information commitment that has to be reported on" stopped being true on 2026-04-01, when BSIP and LA BSOG were consolidated into the **Local Authority Bus Grant** — a needs-based formula allocation held multi-year (revenue 2026–2029), not a competitive bid. A council officer reading the old line in August 2026 saw a supplier working from last year's map of the world. The card now names LABG and links to the FAQ for the duties.
- **The Enhanced Partnership multi-operator requirement is now on the site.** The EP statutory guidance republished 2026-04-01 lets a scheme require "a single set of multi-operator information available across all operators" — which is exactly the artefact this system produces, and it appeared nowhere. It now leads the council card on `public/index.html` and opens the new FAQ entry.
- **Two new FAQ entries** (`public/faq.html`), anchored `#councils` and `#print`. The council one names the **31 March 2027** bus network accessibility plan deadline and states plainly that we hold stop locations, per-stop service calls and route geometry but **not** stop infrastructure — shelters, kerbs, lighting — so the offer is the network layer of the evidence, not the infrastructure audit. Checked against `src/maps/facts.js` and `src/expert/index.js` before writing it: there is no infrastructure attribute anywhere in the store, and over-claiming here would be found out at exactly the wrong moment.
- **"Why a printed map, when there are apps?"** exists because the April 2026 vision document is digital-first and **does not mention maps once**. The print case no longer has a DfT sentence behind it, so the entry makes the digital-inclusion argument in our own voice and says so — previously it survived only as a half-clause in the tourism card.
- **`public/opportunity.html`** now tells a prospective CIC founder what changed in 2026 before the "business model would be yours to shape" sentence: council bus money is a multi-year formula allocation (a recurring retainer is arguable in a way it was not), and the Bus Services Act 2025 opened franchising to every authority and re-permitted municipal operators (buyer class 5 has a sharper reason to look professional).
- **Layout note.** The first draft of the pricing card ran to twice the length of its two row-mates and the grid stretched that row from 183 px to 400 px, leaving both neighbours half empty. The duties moved to the FAQ rather than being watered down; the row now sits at 277 px. Measured in the running portal, not assumed.
- *Source:* `Buses/BusMapsUK/Bus policy position 2026-08-17.md`. **These claims are dated.** Further LABG and consolidated funding conditions were expected around September 2026, and the 2026 BSIP guidance promised for spring 2026 could not be confirmed — re-check "to 2029" and "31 March 2027" then. *Bus Back Better* (2021) is deliberately still absent from the site: it has never been withdrawn, but it is history, not authority.

### Changed — `prune:staged` is dry-run by default — 2026-08-17

- `scripts/prune-staged.mjs` used to delete for real unless you remembered to pass `--dry-run`.
  Flipped to match `delete-map.mjs`: it now always dry-runs and prints a summary, and only deletes
  when you pass `--yes`. Updated the usage comment and every doc that showed the old
  `--dry-run`-then-remove-it invocation (`README.md`, `docs/DEPLOY.md`, `docs/R4-update-cycle.md`,
  `docs/H1-operations-handbook.md`, `docs/ROADMAP.md`).

### Fixed — place maps get their own refresh flags, not their town's — 2026-08-17

- **The monthly BODS scan now reports places as well as towns.** `gtfs_upcoming.py` (bus-map skill
  side) discovers every built place map from its manifest and scans it against **its own** service
  radius, emitting a `## <Place> — <verdict>` section with a `_kind place · region … · town … ·
  radius … km_` meta line. Nothing here is registered by hand: the towns registry
  (`town_prefixes.json`) drifts, and places are added far more often than towns.
- **`parseSections` no longer silently drops a "to verify"-only section.** The heading regex
  required `— (\d+) upcoming`, so a verdict of `2 to verify` (0 actionable, some `[ENDS?]`) matched
  nothing and vanished. On the 2026-08-17 report that hid St Ives entirely. A possible withdrawal
  is exactly the advance notice the scan exists to give.
- **Flags and public banners are now attributed to the right map.** Place maps used to be matched
  to their TOWN's section by substring on `map.subject`. Duplicate messages were never the risk
  (they dedup per map per report date) — the damage was that `setMapBannerNoteAuto` seeds the
  **public** "changes coming" banner from the matched section, so the High Wycombe Aldi map would
  have advertised `[NEW] WW1`, a new service that does not serve that store, while the two changes
  that do affect it (M40, X74) were demoted to "+2 more". `mapsForSection` now joins exactly, per
  kind; `mapsForSectionLegacy` is kept and used only for reports written before places had sections.
- **Silence is now reported as a coverage hole, not read as good news.** `parseSections` keeps
  quiet ("nothing upcoming") sections and marks them `actionable: false`, which is what lets
  `unscannedPlaceMaps()` tell a place map that was *scanned and is clear* from one the scan **never
  looked at** — the latter now prints a warning naming each map. Exact joins are stricter than
  substring ones, so this is the failure mode the change introduces, and it is the one thing that
  must not be silent.
- **New gate `scripts/test-upcoming-join.mjs`** (in `npm test`, or `npm run test:upcoming-join`).
  Its legacy assertions deliberately reproduce the old wrong banner, so the fix is measured against
  a check that can go red rather than one that was always green.
- `scripts/import-map.mjs` uses `sectionsForMap` in place of `sectionsForTown` when seeding a new
  map's banner. No rendered sheet changes: `npm test` and `npm run verify` (area + place) both PASS
  byte-identical.

### Changed — engine re-vendored from the skill (design-quality Phase 8 item 3) — 2026-08-16

- **All nine vendored engine files refreshed in one pass**: `engine/icons.js`, `engine/render.js`,
  `engine/footer.js`, **`engine/labeller.js` and `engine/font_metrics.js` (new here)**,
  `engine/place/gen_internal.js`, `engine/place/gen_external_places.js`,
  `engine/expert/schematize_internal.js`, `engine/expert/diagram_internal.js`. This closes the
  drift the bus-map skill's `changing-the-engine.md` had been holding open since 2026-07-28 while
  the design-quality plan ran; the skill's `status.js` now reports every row **in sync**.
- **`labeller.js` and `font_metrics.js` are not optional.** `place/gen_internal.js` requires
  `labeller.js` at load time (resolved through `SKILL_ASSETS`, like `icons.js` and `footer.js`) and
  `labeller.js` requires `font_metrics.js`, so vendoring the generator without them throws at
  require time rather than failing a byte gate. They must always move together.
- **No fixture needed refreshing.** The five place maps carry no `design` keys, so the engine's
  absent-config-is-byte-identical invariant held and the vendored code reproduced the shipped
  sheets exactly. `verify:area` (4 outputs, SVG and JPG), `verify:place` (3 outputs), `test:p7` and
  `npm test` all PASS.
- **`.env` `FIXTURE_DIR` repointed** to St Ives `v6.45_2026-08-16_2021` — it still named `v6.23`
  from 2026-08-10, and `verify:area` warns when the pointer is not the newest render. `.env` is
  git-ignored, so this is the only record: **a fresh clone must set it, or `npm run verify` exits 0
  with "skipping" and proves nothing.**


### Fixed — impeccable round-2 findings: badge/pill contrast, "Who it's for" grid — 2026-08-15

- **`.badge.place`, `.badge.extra`, `.pill.amber` contrast (P0)**: all three reused `var(--accent)` as
  *foreground text on the accent's own light tint background*, which fails WCAG AA (~2.3:1) even
  though the same accent works fine as solid-fill text (`.pilot-badge`'s `--accent-ink` fix doesn't
  apply here — that's white-on-solid, this is amber-on-amber-tint). Added a new `--accent-tint-ink`
  token (`#8a5700` light / `#ffd78a` dark, ≥5:1 against the 14–16% tint backgrounds in both themes)
  and switched all three tint-background amber usages to it.
- **"Who it's for" 5-card grid (P1)**: dropped to 4 cognitive-load-threshold cards by folding
  "Business & science parks" into the existing catch-all note, switched the grid from `cols-3` (which
  would have orphaned a 5th card alone on its row) to `cols-2` for a clean 2×2, and added a "most
  common" cue on the councils card per `PRODUCT.md`'s stated primary audience.

### Changed — review checklist consolidated to 3 items, plus 4 smaller review/admin UX fixes — 2026-08-15

Five findings from a review pass over the publish and admin screens:

- **Checklist 6 → 3** (`src/publish/index.js`, `CHECKLIST_VERSION` → 5). Six tickboxes had become a
  rubber-stamp exercise — approvers were ticking through without reading past the first few. The
  first three items (services, colours, POIs) merge into one `appearance` item; `legible` and
  `alternative` are unchanged in substance; `accurate` (the "this is a visual check, not independent
  verification" caveat) is no longer a tickbox — it never described something the approver *does*, it
  describes a boundary on what the other checks mean, so it's now static text next to the checklist.
  Runbook R3 updated to match.
- **"Opens in a new tab" made explicit** on the JPG full-size link and the services/stops list link in
  `/app/review` — neither said so before, so approvers could lose track of a window they needed to close.
- **The services-list link moved** next to the download pills under "Inspect the print-ready output",
  replacing the orphaned "checklist item 6 asks you to open it" note (which no longer made sense once
  the numbering changed anyway) with a plain, discoverable "Open services and stops list" pill.
- **Admin to-do cards are now the click target**, not just the small "Open" button inside them — matching
  the review queue's whole-card-clickable pattern. Only applies to cards whose one action is a portal
  link; cards with a shell command (a Copy button to hit) are unchanged.
- **`opportunity.html` reworded** — "you do not need to have written the software — but you do need to
  be able to read it, or to have someone who can" overstated what's actually required (the author
  doesn't read the generated code either); now says the requirement is understanding how the software
  is developed and maintained using AI, with a pointer to the succession note below it.

### Fixed — hero/maps search box unusable (28px wide) — found by a fresh Impeccable critique — 2026-08-15

A second `/impeccable critique` of the homepage, run right after the P0/P1 fixes above, caught a live
regression those very fixes had exposed: `.search-form`'s `<label>` was a direct flex-item sibling of
the input and button, so it competed for row width instead of stacking above them. Before today's
`min-width: 0` fix, the (buggy) grid track let the whole hero column overflow wide enough that the
input still had room despite this; clamping the grid to the viewport correctly exposed the separate,
pre-existing flex bug underneath it — live measurement showed the input rendering **28px** wide,
unusable for typing a place name, on both `/` and `/maps`. Fixed with `flex-wrap` on `.search-form`
and `flex: 1 0 100%` on the label so it always takes its own row (378px input at 480px form width,
178px at 320px viewport, 0px overflow). `npm test` and the detector clean. Deployed live immediately
given severity — this was broken in production for however long the P1 fixes had been live.

### Fixed — the three Impeccable P1 defects from the first critique; version bumped to 0.9.4-pilot — 2026-08-15

All three P1s from the 2026-08-14 homepage critique are fixed. The real cause of the "4 layout-
overflow bugs" was a CSS Grid/Flexbox default: `.hero-grid`'s items and the hero search input had no
`min-width: 0`, so their default `min-width: auto` let the search input's intrinsic content width
stretch the whole grid track wider than the viewport at narrow widths (confirmed: 83px of horizontal
overflow at 320px before the fix, 0px after, on both `/` and `/maps`, the two pages sharing the
`.search-form` pattern). The "Who it's for" grid dropped from 6 cards to 5 by moving the "Not on this
list?" catch-all out of the grid into a plain note below it — it was never one of the five kinds
being enumerated, so treating it as a sixth peer card overstated the grid; the adjacent budget-worry
sentence now resolves inline ("during the pilot there is no charge") instead of only linking to
`/pricing.html`, reusing the same pilot claim already truthful elsewhere on this page. The page's
closing "Or take it on yourself" section (the succession-risk disclosure) had no CTA after it before
the footer; it now ends on the existing `.lead-cta` pattern with a primary link to
`/opportunity.html` and a ghost mailto.

Verified: `npm test` and the mechanical detector both clean (only the pre-existing advisory
em-dash-density note, unrelated). `package.json` bumped `0.9.3-pilot` → `0.9.4-pilot` per
`docs/GO-LIVE.md` §5's versioning policy; not yet deployed.

### Fixed — the two Impeccable P0 defects from the first critique — 2026-08-15

Both defects the 2026-08-14 homepage critique found are now fixed. `.pilot-badge` used hardcoded
white text on the amber accent (2.7:1, below the WCAG AA 4.5:1 floor); it now uses a new
`--accent-ink` token (`#17202e`, ~6:1 on light-mode amber and ~9:1 on dark-mode amber — the same
paired-token pattern `--primary`/`--primary-ink` already uses), fixing every page since the badge is
injected site-wide by `site-banner.js`. Separately, `auth-status.js` used to remove the nav's "Apply
to join" `.btn-primary` for a signed-in visitor and put nothing back in its place — a genuine
vanishing-CTA dead end on `/`. It now replaces that slot with a `.btn-primary` "My maps" link to
`/app`, and repoints every other "Apply to join" / "Register your interest" CTA on the page (hero,
body) to "Go to my maps" → `/app` instead of leaving them pointed at an application the visitor has
already made. Verified live against a signed-in session (magic-link token read from
`data/portal.sqlite` per the usual no-console-access workaround); `npm test` and the mechanical
detector are clean.

### Added — Impeccable design-review tooling initialized — 2026-08-14

`PRODUCT.md` and `DESIGN.md` (plus `.impeccable/design.json`) now capture durable product truth and
the incumbent visual system (North Star "The Council Noticeboard": plain/procedural, color used only
semantically, pill controls vs. 14px containers, one shared ambient shadow) for the `/impeccable`
Claude Code skill. Ran a first `/impeccable critique` against the shopfront homepage
(`.impeccable/critique/2026-08-14T04-46-45Z__public-index-html.md`) — scored 23/28 (Good), and it
caught a real, binding defect: `.pilot-badge` (`public/css/styles.css:416-426`) sets white text on the
amber accent at 2.7:1 contrast against the 4.5:1 WCAG AA floor PRODUCT.md commits the whole portal
to, on an element `site-banner.js` injects into every single page. Also found: `.btn-primary` is
absent from the DOM entirely for a signed-in visitor who lands back on `/` (no redirect, no
repointed CTA). Neither is fixed yet — next session should start with those two before anything else
design-related.

### Fixed — the live host rendered every sheet in monospace — 2026-08-13

The Dockerfile installed `fonts-liberation` but not `fontconfig`. Font files alone do not make
`Arial` resolve to Liberation Sans — the metric alias that maps them lives in `fontconfig-config`
(`/etc/fonts/conf.d/30-metric-aliases.conf`). Without it, fontconfig failed to match Arial and fell
back to the first family it could see, and `LiberationMono` sorts before `LiberationSans`. Every
sheet rendered on the host since 2026-08-09 is set in monospace, ~16% wider than the Arial the label
positions were computed against.

Found because the *Beaconsfield Simpson Centre* title — the longest in the estate — overran the
Services panel at x=200mm by 16.5mm and collided with it on the review page. Measured advance in the
live JPG was 6.580 mm/char, against 6.60 predicted for a 0.6 em monospace and 5.691 for Arial Bold.
All 13 maps are affected; the collision is simply the only one visible.

Added `fontconfig` + `fc-cache -f` to the image. `render-parity-probe.mjs` gains a font-resolution
check that measures the ink width of a run of `W` against a run of `i` and reports whether the face
is proportional (~4) or monospace (~1) — no baseline, no threshold tuning. That check is now wired
into CI as `--strict-fonts` on the `image` job (`render-parity.yml`) specifically — not the plain
`--strict` flag, and not the `runner` job — because it has no legitimate "differs but fine" outcome
the way the baseline byte comparison does (Linux vs Windows glyph *shape* differs by design, see
GO-LIVE.md §2.5, and gating on that would be a permanent false positive). Before this, the probe
would have reported the same false PASS it gave on 2026-08-09; it can now fail a future build on
this exact class of regression. The previous conclusion in GO-LIVE.md §2.5 rested on the text probe's
byte count moving, which records that something changed but never what it changed to; that section
is corrected in place rather than silently edited.

Renders are stored files, so the Dockerfile fix alone did not touch anything already published.
`scripts/rerasterize-stored.mjs` (new) re-encodes a stored SVG's existing JPG without re-running any
generator or touching the SVG — the text layout was always correct, only the font used to rasterise
it was wrong. Run with `--apply` against the live store 2026-08-13: **60/60 stored sheets across all
13 maps re-rasterised, 0 failures.** Verified against the live bytes: Simpson Centre's title now ends
12.3mm clear of the Services panel it was overlapping (Arial Bold predicted ~11mm clear).

### Fixed — Admin nav link missing on the map editor page — 2026-08-13

`editor.html` hardcodes its own header nav markup (there's no shared header component) and never
had the `id="adminLink"` element that `index.html` and `review.html` have, so admins opening any
map — draft or published — saw no Admin link, even though it showed on My maps and Review. Added
the link to `editor.html`'s nav and the `me.role === 'admin'` show-check to `editor.js`, matching
the pattern in `review.js`.

### Fixed — review checklist item 6 had no way to actually do what it asks — 2026-08-12

P8a added a required checklist item asking the approver to open the map's service list and check
it, but nothing on the Review screen linked to one — the approver had no way to get there except
guessing the map's slug and typing a URL by hand. Worse, `/m/:slug/services` only serves the
currently-**published** version, so even that manual route would show stale content on any version
that changes the data, and 404 outright on a map's first-ever submission (nothing public yet).

New `GET /api/review/:id/services` reads the **submitted** version's own `facts.json` straight from
its render folder (same read `factsForPublicMap()` does, keyed off the pending version instead of
the published pointer), and a new preview page (`public/app/review-services.html`) renders it. The
Review screen now has a **"See the service list (this version) ↗"** link right above the checklist.

### Added — P8a: published maps that work online, not just on paper — 2026-08-12

The system assumed the deliverable was a printable sheet. P6 gave every published map a public
page, but that page was a downscaled JPG of an A4 sheet — on a phone its body text lands at about
four pixels, a screen reader gets nothing, and a crawler or link preview sees an empty shell.
P8a is the first of three tiers planned in `portal-online-maps-plan_2026-07-26.md` (Buses repo):
**the linkable page done properly**. Nothing here touches a generator, the safe subset or the
byte-identical gate — `npm run verify` passes area + place unchanged. Rebuilt against current
`main` from the `p8a-maps-online` branch (originally built 2026-07-26/27, never merged — see
[[project_p8a_online_maps]]); the SVG-vs-watermark question that branch left open turned out to
already be answered by existing policy, since the public `/m/:slug` page has offered an
unauthenticated, unwatermarked "Download vector (SVG)" link since P6 — watermarking has only ever
applied to JPGs (`src/render/watermark.js`).

- **The sheet is now the sheet.** `/api/public/maps/:slug/inline/:base` serves the published SVG
  itself, prepared for inline display (`src/public/inlineSvg.js`): print width/height dropped so
  it scales, `role="img"` + `<title>`/`<desc>`, `font-family="Arial"` widened to a stack including
  the metric-compatible Liberation Sans/Arimo, and anything executable stripped (the generators
  emit none — inlining just turns an inert `<img>` into live DOM). The **download** route still
  serves the untouched signed-off bytes. Sharper *and* lighter: St Ives internal is 472 KB raw,
  88 KB gzipped, against ~1 MB for the print JPG. Gzipped in the route — there is no compression
  plugin in front of the app.
- **A viewer** (`public/js/map-viewer.js`): drag/pinch/wheel-with-Ctrl to move and zoom, buttons,
  and full keyboard control (arrows, `+`, `−`, `0`) with the zoom level announced politely. Plain
  wheel still scrolls the page. Falls back to the raster preview if the SVG cannot be fetched or
  the browser has no metric-compatible font.
- **A text alternative for every map** — `/m/:slug/services`. A picture of a bus map has no `alt`
  that could carry it, and a council embedding one inherits it into its own WCAG 2.2 AA duty, so
  the same facts are published as ordinary HTML: route, operator, days, the stops it serves and
  where it goes. Built by `src/maps/facts.js` from data **already vendored with every map**
  (`routes.json`, `routes_intown_atco.json`, `atco2name.json`) — it works for both area and place
  payloads and invents nothing.
- **The facts are snapshotted per version.** `renderVersion()` now writes `facts.json` beside the
  artefacts, from the very payload the sheet was drawn from, so the text alternative can never
  describe newer data than the published picture. Versions rendered before this fall back to the
  map's live payload and pick up a snapshot on their next render.
- **Provenance and staleness.** Every public map carries "correct as at" (the payload's own words,
  e.g. "June 2026") and, past `STALE_AFTER_MONTHS` (default 6), an on-page warning. A leaflet on a
  noticeboard is obviously a snapshot; a web page implies currency.
- **Crawler-visible metadata.** `/m/:slug` and its services page have their `<head>` completed
  server-side — title, description, canonical, Open Graph, JSON-LD — instead of being written by
  JavaScript a crawler never runs. Both are in the sitemap.
- **Caching.** A published version is immutable, so anything requested with `?v=<pub_key>` (how the
  page links) gets `immutable` for a year; a bare URL follows the published pointer and gets 300 s
  plus an ETag with real 304s. This is what keeps repeat views — and, later, embeds — off the app.
- **Attribution on screen**, not only on the printed sheet: OSM/ODbL and BODS/OGL under every map.
- **`/accessibility.html`** — what we aim for (WCAG 2.2 AA), what we have done, and, honestly, what
  is not fixed; plus a paste-ready paragraph for a customer's own accessibility statement.
  `docs/ACCESSIBILITY.md` is the operator's version, with the pre-publish check.
- **Publish gate**: new required checklist item `alternative` (open the service list, confirm it
  matches the map, confirm the map page works from the keyboard). `CHECKLIST_VERSION` → 4 (3 was
  already taken on `main` by the unrelated H1 "on every sheet" wording pass).
- Gates: `npm test` now runs `scripts/test-p8a.mjs` (facts for both payload shapes, provenance and
  staleness, the inline-SVG transform incl. script stripping) alongside every other gate — all
  green; `npm run verify` PASS area + place, byte-identical.

### Added — H9, an editor's-eye view toggle for admins — 2026-08-12

Closes the last open item of the update-flow backlog (`portal-update-flow-findings_2026-08-11.md`
§H9). As admin, Peter holds every role at once, so the handoffs the flow is built on become
invisible — worst seen live 2026-08-12, where the status strip told him "their move" on a map only
he could act on, while still offering the button. Two fixes:

- `public/js/editor-eye-view.js` — a purely presentational, `localStorage`-backed toggle (checkbox
  in the admin console header). While on, it hides the Admin/Review nav links and the Refreshes
  tab's Accept/Decline buttons (`[data-eev-hide]`), and shows a banner naming the view with a
  **Turn off** button. No auth change, no impersonation, no scoping change — an admin keeps every
  permission underneath; the toggle only stops their own powers from concealing the handoff.
- The status strip's wording, independent of the toggle: an admin viewing a customer's map now
  reads "their move · you can act as admin" instead of a bare "their move" that disowned a button
  which still worked.

### Verified — the three transactional emails, proven end to end on live — 2026-08-12

No code change. `src/email/notify.js` had shipped and the hooks demonstrably fired, but no
notification had ever reached a real inbox — the first live attempt found the test editor stuck
platform-level, so `recipientsFor()` had nobody to tell. With the org-reassignment fix below
deployed, reassigned that editor to *BusMaps.uk (pilot)* and published Beaconsfield Waitrose v2.0;
the "published" email arrived via Resend at the editor's own address, not the admin's, naming the
map and linking its public page. All three transactional emails share the same recipient-lookup
path, so this proves the last mile for all of them.

### Added — admin can move a user to a different organisation — 2026-08-12

`updateUserAdmin()` only whitelisted `name`/`role`/`status`, and `POST /api/admin/users` left
`customer_id` `null` (a platform-level account) whenever the customer field was skipped — a user
created against the wrong org, or none, was then stuck: re-adding the address returned `409 already
has an account`. `PATCH /api/admin/users/:id` now accepts `customerId` (validated against a real
customer, or `null` for platform), and moving somebody between organisations — which changes which
maps they can see — is never a silent edit: it logs a distinct `user.reassign` audit event with the
from/to org names, on top of the ordinary `user.update` entry. The users tab in the admin console
gained an organisation picker per row, with a confirmation prompt when the value actually changes.
Also added: audit-tab labels/detail formatting for `user.invite`/`user.update`/`user.reassign`,
which previously fell back to the raw action string.

### Changed — one word per thing, and the customer's panel renamed for what they can actually do — 2026-08-12

Backlog items **H4 + H3 + D** (`0.9.3-pilot`). The same objects had different names on different
screens, and the worst collision was structural: a panel headed **Publish** containing a button
that said **Submit v2.0 for publication**, offered to a customer who *cannot publish at all*. The
settled vocabulary is now written down in `docs/DEVELOPING.md` and applied everywhere:

| Thing | The word now | Gone |
|---|---|---|
| The rebuilt map we offer | **update** | monthly update, monthly data refresh, proposed update (customer-facing) |
| A saved state of a map | **version** | *Edition* (the public page's own word) |
| Where a version is | **draft → awaiting review → published** | "Locked for review" beside "Awaiting review" on one screen (**D2**) |
| What the customer does | **send it for review** | submit for publication |
| What only an approver does | **publish** | — |

So: the panel is headed **Getting it published** and its button reads **Send v2.0 for review**; the
editor's status chip says **Awaiting review**, matching the panel and the dashboard pill; the strip's
third step is **Sent for review**; and the public page says **Version v1.1**.

**D1** — a place map no longer inherits area wording: its two sheets are **Serving this place** and
**Where those buses go** (the same names its public page uses), instead of "Within the area" and
"To nearby towns", which described somebody else's map. `outputsForClient()` takes the map kind.

### Added — three transactional emails — 2026-08-12

Backlog item **B2**, and the largest practical gap in the flow: nothing told anyone anything, ever.
An update staged for a customer, a submission published, a submission sent back — every one of them
was discovered by signing in and looking, which is why a staged update can sit for weeks.

`src/email/notify.js` composes and sends three: **update ready** (from `propose-update.mjs`, as the
payload is staged), **published** and **sent back** (from the approver's decisions). Three rules
hold: an email never breaks the flow it reports on (fire-and-forget, failures logged not thrown);
`EMAIL_PROVIDER` unset ⇒ no send and no change in behaviour; and addresses at RFC 2606 reserved
domains are skipped rather than bounced, because every seeded demo organisation uses `.example` and
bounces would damage the sending reputation the magic links depend on. New gate:
`scripts/test-notify.mjs`.

### Added — a draft that nobody sent is no longer invisible — 2026-08-12

Backlog item **B5**, found on the live site by leaving eight maps in exactly this state. The
worklist ranks by *who is blocked*; a draft blocks nobody, so an accepted-but-unsent update
appeared in no list and no count — while being the step most likely to be forgotten, because it
sits between two actions taken on different days. `listUnsubmittedDrafts()` is a query over state
the database already holds (head ≠ published, no open request, no pending update), surfaced as a
`draft-unsubmitted` worklist item — rank 9, promoted to 8 once it has sat a week, and it says which
version the public still has. A version sent back and never resubmitted reads differently and is
listed too. `scripts/test-worklist.mjs` covers appearing, ageing, and disappearing when sent.

### Added — every version of a map, listed where the promise is made — 2026-08-12

Backlog item **H8**. The Save panel promised *"Nothing is deleted — earlier versions stay
available"* — true on disk, and a promise no screen in the customer's half of the app kept. The
panel now lists every version with its date, note, state and downloads, and offers **copy these
settings into a new draft**: an earlier look comes back as a new version through the ordinary save
and review path, never as a quiet swap of what is published. `listVersions()` carries
`overrides_json` for it.

### Changed — the compare dialog says what the images cannot show — 2026-08-12

Backlog item **B1**. Both sheets render at about half printed size in that dialog, so a reworded
service description or a dropped stop is illegible in it and nothing is highlighted. The plain
bullets — and the exact **old → new** wording — now sit above the two panes.

### Changed — the two download rows say which version they are — 2026-08-12

Backlog item **H5**. One page carried two download rows that can hold *different* versions and
neither said which: they now read **Your latest version (v2.0, not public yet)** and **What the
public has (v1.0)**. The links name their sheet in full instead of abbreviating it ("⬇ Within ·
SVG" → "⬇ Serving this place — print-ready JPG"), derived from the map's own outputs so one sheet
has one name everywhere. The panel's text now says plainly that Save is only for your own edits and
that downloading is optional — it sat between the editing controls and the publish gate, reading
like step 2 of 3 when it is not a step at all.

### Changed — the unit of publication is stated, not implied — 2026-08-12

Backlog item **H1**, the rest of it. The Outputs panel presents the sheets as independently
switchable and the review screen lists them as separate items, but accept, send, review and publish
always operate on the whole map. The customer's panel and the approver's inspect section now say so,
and the first three checklist items say **on every sheet** (`CHECKLIST_VERSION` → 3).

### Added — a status strip on the map page: whose turn is it, and how far along am I? — 2026-08-12

Backlog item **I**. The flow has five states, three actors and days between them, and no screen
answered the question people actually have. A cold tester finished the whole flow successfully and
still ended unsure *whether it had finished or was waiting for someone*; the operator's own
walkthrough asked "is Accept the end?", "is Submit the same as Publish?", "why is everything greyed
out?" — all the same question in different clothes.

A persistent strip at the top of the map page now draws the five steps — **Update offered → Draft
ready → Sent for review → Published → Public page** — marks where this map is, names who holds
it, dates each step it has reached, and offers the one action that moves it on. Not a wizard: a
wizard implies one person at one desk, and this flow spans days and three people.

It is a read-out of state `mapDetail` already returned — no schema change, no new endpoint — and it
closes several backlog items structurally rather than a label at a time:

- **C1** — *Send for approval* now sits at the top of the page, not 900 px below the accept flash
  that told you to look "below". An accepted update no longer quietly becomes a draft nobody
  submits. The accept flash was reworded to match, dropping *"Review it below"*, which collided
  with the approver's Review step (**H3**).
- **C2** — while a version is with the approver, the reason the controls are frozen is stated at
  the top, where the freezing is noticed.
- **B3, B4** — the strip carries how long a submission has been waiting *and* the version the
  public is still being served, which the dashboard used to hide at exactly that moment.
- **H1** — "Publishing covers all N sheets of this map together": the unit of publication is the
  whole map, and nothing said so anywhere.

Off-path states are drawn too: **sent back** quotes the approver's reason, and a published map that
is not listed says so rather than claiming to be live. An approver or admin looking at another
organisation's map reads "their move" instead of "your move".

### Fixed — the portal told you an updated map was "identical" to the published one — 2026-08-12

Backlog item **A1**, the headline finding of the update-flow review, and the one that weakened a
gate rather than merely confusing someone.

`changeSummary()` compared **only the customer's safe-subset overrides** — route colours, hidden
landmarks, the operator filter. That was complete when the sole way to make a version was to edit
those things. Since P5 introduced accepted data refreshes a version can differ entirely in its
underlying data and still be "unchanged" by that measure, so:

- the editor said *"No differences from the published version (v1.0) yet — make an edit and save
  first"* — wrong advice, pointing at a `disabled` button, and if followed it produces a pointless
  colour change;
- the review screen said *"⚠ This version is identical to the published version (v1.0) — there is
  nothing to change"* — inviting the approver to reject a real timetable change as an error. A cold
  tester confronted with that message downloaded both versions' SVGs and diffed them by hand to
  prove the portal wrong before publishing.

**What changed.** Accepting a refresh now records the diff *on the version it creates*
(`map_version.data_change_json` — proposed id, source note, and the routes/stops/descriptions/
validity summary), so every later screen can say what the version changed without digging through
the audit log. `changeSummary()` takes those refreshes and `unchanged` now means **both** halves are
empty. Both screens answer two questions instead of one — *What changed in the map data* and *What
you changed* — and the review screen shows the exact `from → to` wording of every reworded service
description. Empty refreshes are filtered, so a genuinely unchanged version still reads as
unchanged.

Nothing is lost from before the column existed: `proposed_update` already linked each accepted
refresh to the version it created and held the diff, so the migration backfills every past accepted
version. That covers the eight live maps carrying accepted-but-unsubmitted v2.0 drafts.

New gate: `scripts/test-change-summary.mjs` (in `npm test`) pins the behaviour — most importantly
that a refresh-only version does **not** report as unchanged.

### Fixed — three defects a first-time user found in the editor — 2026-08-12

The first three items of the update-flow backlog (`Buses/Development Docs/portal-update-flow-findings_2026-08-11.md`,
**H6**, **A2**, **E**). All presentational; no rendered sheet changes.

- **Long route names covered the `reset` link.** `.r-title` carried `overflow: hidden;
  text-overflow: ellipsis` but sat at `display: inline`, where ellipsis has no effect — so the text
  overran the button instead of truncating. On the March map at 1024 px **all 7 rows** overran, the
  worst by 260 px; at 1280 px none did, which is why it survived this long. Now `display: block`
  (also on `.r-sub`), and the full name is carried in a `title` so truncation loses nothing.
  Measured after the fix: 7 of 7 rows clear the button by 10 px at 1024 px.
- **Disabled buttons looked live.** There was no `.btn:disabled` rule in either stylesheet, so a
  disabled button kept full colour, `cursor: pointer` and the `:active` press animation, then
  silently did nothing when clicked. Added an app-wide disabled style (reduced opacity,
  `cursor: not-allowed`, no press animation, no hover change) covering `:disabled`, `[disabled]`
  and `aria-disabled="true"`. **Save new version** and **Undo my changes** now also carry a `title`
  saying *why* they are off — the two reasons (nothing to save vs editing paused for review) are
  quite different, and the editor elsewhere tells a customer to press Save.
- **"an approver will review it and review it."** The submit confirmation, one of the most
  consequential messages in the product, had a duplicated clause. Now *"Submitted — an approver
  will review it and, if all is well, publish it."*

### Fixed — the sign-in page told real customers about the dev server console — 2026-08-11

`POST /api/auth/request` returned the same message in every environment: *"If that address is
registered, a sign-in link has been sent. In local dev the link is printed to the server console."*
The second sentence is developer instruction that was never gated on `NODE_ENV` or
`EMAIL_PROVIDER`, so **every real customer signing in at busmaps.uk was reading it** — advice they
cannot act on, referring to a machine they have no access to. Dropped it; the response is now just
*"If that address is registered, a sign-in link has been sent."* The deliberate no-enumeration
property is unchanged: the reply is still identical whether or not the address is registered.
Developer-facing mentions of the console link (`README.md`, `docs/R2-onboarding.md`,
`docs/PILOT.md`) are correct in context and stay. Found during the update-flow walkthrough
(`Buses/Development Docs/portal-update-flow-findings_2026-08-11.md`).

### Fixed — portal's vendored `engine/footer.js` was stale, and missing from the drift table — 2026-08-10

Re-vendoring `engine/place/gen_internal.js` after the skill's full-fleet engine rollout (panel
spacing fixes, dropped footer version stamp) left `npm run verify:area` failing: the regenerated
St Ives SVG carried the OLD footer text (`Map v6.23 · 3 August 2026`) instead of the new
(`Valid from 3 August 2026`), a 2-byte diff easy to miss in a byte-count-only failure. Cause:
`gen_internal.js` resolves `footer.js` via `SKILL_ASSETS` exactly like `icons.js`, but `footer.js`
was never added to the portal hand-off table (`changing-the-engine.md` §4) or `status.js`'s
vendoring-drift check, so it silently went stale while the tracked files stayed in sync. Copied the
current `footer.js` to `engine/footer.js`, added it to both the table and `status.js`'s drift rows,
and refreshed `.env`'s `FIXTURE_DIR` (St Ives v6.23) and the `High Wycombe Aldi` place fixture
(`Buses/Places/_portal-fixture/`) to the latest rollout output. `npm run verify` (area + place),
`npm run test:p7` and `npm test` all pass.

### Changed — public map page's "Version" pill renamed to "Edition" — 2026-08-10

The public map page (`/m/<slug>`) showed a "Version 2.0" pill (the portal's own publish-cycle
number) at the same time the printed sheet's footer showed a completely different "Map v6.22"
build number (the map-engine's internal render counter) — both called "version," confusing anyone
comparing the two. The engine no longer prints its build number on the sheet (see the
`make-bus-leaflet` skill's `footer.js`/`gate_lib.js`, updated the same day — it still records the
build number internally in `routes.json`/`manifest.json`). On the portal side, `public-map.js`'s
pill now reads "Edition N" instead of "Version N" so the two numbering schemes no longer share a
label.

### Fixed — admin Refreshes tab was read-only, with no way to act on a pending update — 2026-08-10

The admin console's Refreshes tab (`/app/admin`) listed monthly updates staged by
`propose-update.mjs`, but the row carried no link and no accept/decline control — an admin could
see a refresh was pending but had no way to act on it short of knowing to sign in as the owning
customer (unnecessary: `loadOwnedMap` already lets an admin act on any map) or navigating to
`/app/maps/:id` by hand. The map name is now a link to its editor page, and each row carries
**Accept**/**Decline** buttons calling the same `/api/maps/:id/proposed/:pid/accept|decline`
endpoints the customer-facing editor uses. Verified in the browser against local dev: both actions
return 200, flip the row's status in `proposed_update`, and the table live-refreshes to drop it.

### Added — `deliver-map.mjs` can refresh an existing map, not just import a new one — 2026-08-10

`scripts/deliver-map.mjs` (GO-LIVE.md §2.1 Phase 1) shipped at go-live wrapping only
`import-map.mjs` — the one-time delivery of a brand-new map. It had no equivalent for the routine
case: refreshing an already-live map's data, which still meant SSHing into the VPS and running
`propose-update.mjs` there by hand. Pass `--map <slug>` instead of `--name`/`--slug`/`--subject` and
the same scp → pre-flight-verify → stop → run-in-container → restart → health-check sequence now
runs `propose-update.mjs` instead, staging a proposed update for the customer to review exactly as
it would locally. `--kind` is still required (picks the verify gate) but isn't forwarded to
`propose-update.mjs`, which infers kind from the map row itself. No server-side change; `.env.example`
and `docs/GO-LIVE.md` updated to document the new mode.

### Added — typo tolerance in place-name search — 2026-08-10

Follow-up to the P9 Part B search below: exact/substring matching alone silently missed "Neotts",
"Cambrige" and "swavessey" — a misleading result, since B6's zero-match message ("no map covers
this yet") reads as "this place has no coverage," not "you mistyped it." `searchPlaces()`
(`src/search/index.js`) now returns `{ results, corrected }`. The existing exact pass is unchanged
and always tried first; only when it finds nothing does a bounded edit-distance fallback run,
word-by-word (every query word must find a close word in the same hit — a two-word query can't
fuzzy-match on the strength of one word alone), with the allowed distance scaled to word length (0
for ≤3 chars, 1 for ≤6, 2 above) so short words like "St" never drift into an unrelated match.
`corrected` reports the actual word(s) found, not the whole map name, so `/maps` can show `No exact
match for "Neotts" — showing results for "Neots".`

### Added — P9 Part B: place-name search — 2026-08-10

"Does any map cover my village?" `GET /api/public/search?q=` (`src/search/index.js`) answers it
against place names *inside* the maps, not the 12 map titles — an area map's `external[].label`/
`.stops[]`, a place map's `destinations[].name`/`.stops[]`, and `pois.json` where a map happens to
carry one. Indexed from a `places.json` sidecar (`src/search/place-index.js`) written into the
**published version's own render folder** the moment the publish pointer moves
(`POST /api/review/:id/approve`), never re-derived from the live data dir — so search can never
claim coverage a reviewer hasn't actually signed off. Backfilled the 12 already-published maps with
`scripts/build-place-index.mjs` (`npm run places:build`). The in-memory index invalidates (a
generation counter, rebuilt lazily) on publish, revert, un/re-listing a map, and a customer's status
changing — the same four SQL conditions `listPublicMaps()` already enforces are what search is
allowed to see.

Turned up one thing the plan hadn't anticipated: `pois.json` exists for only 1 of the 12 real maps
(a leftover vendored file, not something any generator writes) — the builder treats it as optional
rather than trying to backfill it everywhere.

Confirmed the query-logging trap called out in the plan was real: Fastify's default logger logs
`req.url` **including the query string**, so a custom `req` serializer on the Fastify instance now
strips it specifically for `/api/public/search` — every other route's request line is unchanged.

UI: a labelled search box above the `/maps` grid (`id="search"`, so `/maps#search` is linkable) and
in the homepage hero, submitting through to `/maps?q=…` — a real `<form method="get">` so it works
without JS, with the JS path (`public/js/public-maps.js`) filtering in place and syncing the URL via
`history.replaceState`. A zero-result search is the demand-capture moment the plan built this for:
"No published map covers **X** yet… [ask for one](/apply.html)."

Tests: `scripts/test-search.mjs` (`npm run test:search`, wired into `npm test`) — an unlisted map's
places are unsearchable, an unpublished draft's are unsearchable, a known stop returns its map with
the right "via" reason, reverting the publish pointer flips the index back to the reverted-to
version's own sidecar, a demo org's result still carries `isDemo`.

Version bumped `0.9.0-pilot` → `0.9.1-pilot`.

### Docs — P9 plan: header cleanup + place-name search — 2026-08-09

`docs/P9-header-and-place-search.md` — a plan, nothing built. Two changes with a per-item status table so a later session can resume mid-flight.

**Part A, the header.** Decided *against* a drop-down grouping Contact / Report an issue / Apply: they are three different jobs, and one of them shouldn't be in the header at all. The header's "Report an issue" link (`/contact.html?kind=issue`) only preselects a `<select>` and swaps a placeholder — it loses which map the reader was looking at, unlike the per-map "Spotted a problem?" form that posts the slug. So it leaves the header and stays in the footer. Also: a fixed `#navAuth` slot, because `auth-status.js` currently appends three items past the primary CTA. The nav and footer are copy-pasted into 12 `public/*.html` files, so the plan's first step is a canonical `site-chrome.mjs` + a `check-chrome.mjs` test + an `apply-chrome.mjs` writer, *before* any content change — and explicitly **not** JS-injected nav, which would be invisible to crawlers once `robots.txt` opens up.

**Part B, place-name search.** Not site search (13 cards, 20 FAQ items — Ctrl-F wins). The answerable question is "does any map cover my village?", and each map's vendored `routes.json` already names every place its buses reach (`external[].stops[]` for area maps, `destinations[]` for place maps, plus `pois.json`). The load-bearing constraint: index from a `places.json` sidecar written into the **published version dir** at publish time, never from the live data dir — the data dir runs ahead of what was reviewed, so indexing it could claim coverage the published sheet doesn't show. A sidecar, not a re-render, so P4's guarantee holds. A no-match routes to `/apply.html`.

Two questions answered on the day and written in as dated decisions: in-town stop names (`atco2name.json`, 464 street-level names for St Ives alone) stay **out** of the index; and search queries are **not logged** — which keeps `/legal.html` off this work's critical path. Still open by design: whether the header gets a magnifier, decided after Part A ships.

### Added — publish-baseline.mjs, real trip through the P4 gate — 2026-08-09

`scripts/publish-baseline.mjs` (`npm run publish-baseline -- --actor <email> (--slug <slug> |
--all-drafts)`) — publishes a freshly-imported map's v1.0 baseline as its first official version.
Same submit → review → publish-pointer + audit sequence as `seed-demo.mjs`'s demo-only
`publishBaseline()`, generalized for real maps and a real actor (an admin/approver can submit AND
review their own request — no same-actor restriction in the review gate itself). Used to publish
the 13 real maps imported today so `/maps` isn't an empty shopfront once DNS is live.

### Fixed — verify-reproduce-place.mjs only recognised base-overrides.json, not overrides.json — 2026-08-09

Caught delivering the first real PLACE map (Beaconsfield Simpson Centre): the pre-flight verify
reported a false `DIFFERS` because `verify-reproduce-place.mjs` only looked for
`base-overrides.json`, while a fresh, not-yet-portal-staged skill payload ships the same expert
framing as `overrides.json` — exactly what `import-map.mjs` already handles (its own comment: "a
fresh skill payload carries it as overrides.json; a live-derived payload already has it split out
as base-overrides.json. Accept either."). The verify script just hadn't been taught the same
fallback. Fixed to check both names, and corrected the "framing:" log line to name whichever file
it actually used instead of always printing "base-overrides.json".

Confirmed against the real data: `PLACE_FIXTURE_DIR` pointed straight at Simpson Centre's S5-render
now passes byte-identical, where it previously reported a 115-byte SVG diff on `gen_internal_place.js`.

### Fixed — first real delivery run crashed on a Docker-mounted fixture — 2026-08-09

`scripts/deliver-map.mjs`'s first live run (St Ives, real host) crashed at the pre-flight verify
step: `warnIfStaleSibling` (added in the fixture-freshness work) scans `FIXTURE_DIR`'s *parent* for
newer siblings, and when the fixture is bind-mounted at `/fixture` inside the container its parent
is `/` itself — whose other children include things like `/root`, unreadable by the container's
non-root user, so `readdirSync` threw `EACCES` and killed the whole pre-flight check. Fixed
`newestMtime()` in `scripts/lib/fixture-freshness.mjs` to never throw: a permission-denied sibling
is now "can't tell", not a crash — consistent with the function already being advisory-only.

Also switched `deliver-map.mjs`'s copy step from `rsync` to `scp -r`: this laptop's Git Bash doesn't
ship `rsync` at all, so the first real run would have failed there next regardless. Removed unused
imports left over from the initial draft.

### Deployed — Caddy installed on the host, GO-LIVE.md §11 — 2026-08-09

Caddy 2.11.4 installed from the official apt repo, `Caddyfile` added to the repo (`busmaps.uk` /
`www.busmaps.uk` → `127.0.0.1:5180`, no manual `header_up` needed — Caddy forwards
`X-Forwarded-For`/`-Proto`/`-Host` by default). Deployed to `/etc/caddy/Caddyfile`, config validated,
service enabled and running.

**Not yet live**: with no DNS pointing at the host, Let's Encrypt can't complete the ACME challenge,
so Caddy falls back to an HTTP-only skeleton that doesn't actually route requests — confirmed via
`curl -H "Host: busmaps.uk" http://<ip>/` returning a bare `404` from Caddy, and `ss -tlnp` showing
only `:80` bound, not `:443`. This is Caddy's own resilience behavior, not a config bug. Once DNS
(§12) is added, `sudo systemctl reload caddy` forces an immediate retry instead of waiting on
Caddy's backoff.

### Deployed — first live host, GO-LIVE.md §3/§6 steps 3 and 5 — 2026-08-09

VPS provisioned (OVHcloud, Ubuntu 26.04), hardened (SSH keys only, `ufw` 22/80/443, confirmed
`unattended-upgrades`), Docker + compose installed. Repo cloned via a read-only GitHub deploy key
into `/opt/community-bus-maps`, built and started — `/health?deep=1` green with `gitSha`/`builtAt`
matching the deployed commit, all four readiness checks passing. One real admin user created via
`create-admin.mjs` on the clean database.

Found and fixed on first deploy: the named Docker volume defaults to `root:root`, but the container
runs as the unprivileged `node` user — `portal.sqlite` couldn't be created until the volume was
chowned. Worth carrying as a note for the next fresh deploy.

Daily backup cron installed on the host (`docker compose run --rm backup`, 03:15) and a matching
Windows scheduled task pulls snapshots down to `community-bus-maps-ops\backups\` for the off-box
copy. **Restore drill performed for real**, not just rehearsed: destroyed `portal.sqlite` on the
live volume and restored it from that day's backup — see `docs/DEPLOY.md` §5, which was also
corrected to match the actual named-volume deployment (it previously described a bind-mount path
that was never what `compose.yaml` does).

Not yet done: Caddy/TLS, DNS at 20i (deferred by choice), and importing any real map data — the
site isn't reachable from the internet yet.

### Fixed — compose.yaml wasn't passing STATUS_TOKEN/PILOT_MODE into the container — 2026-08-09

Found while building the real host's `.env` during first deploy: `src/server.js` reads
`STATUS_TOKEN` and `src/config.js` reads `PILOT_MODE`, but `compose.yaml`'s `environment:` block
never forwarded either from the host into the container — so setting them in the host's `.env`
would have silently done nothing.

### Added — laptop→host delivery script (Phase 1), GO-LIVE.md §2.1 — 2026-08-09

`scripts/deliver-map.mjs` (`npm run deliver -- --src … --name … --kind area|place …`) — rsyncs a
built map up to the host, runs a pre-flight `verify-reproduce(.mjs|-place.mjs)` inside a throwaway
container against the staged dir (SVG-only, per §2.5 — the live service is untouched if this fails),
then `docker compose stop portal`, runs `import-map.mjs` inside a throwaway container, `docker
compose up -d portal`, and confirms `/health?deep=1`. All `import-map.mjs` flags forward through
unchanged. On an import failure the portal is left stopped deliberately (a down site is a louder,
safer failure than one silently serving a half-written import).

Config comes from `.env` (`DEPLOY_HOST`/`DEPLOY_SSH_KEY`/`DEPLOY_APP_DIR`), not inline shell env-var
assignment — Windows Git Bash's MSYS layer silently mangles a leading `/` in an inline-assigned env
var into a Windows path (reproduced: `DEPLOY_APP_DIR=/opt/community-bus-maps node …` arrived at the
script as `C:/Users/.../Git/opt/community-bus-maps`).

Dry-run tested locally against real St Ives (area) and High Wycombe Aldi (place) data — correct
step sequencing, argument forwarding and verify-script selection. **Not yet tested against a live
host**: the VPS exists (OVHcloud, provisioned 2026-08-09) but Docker/compose isn't running there
yet — that's next.

### Added — email provider module (Resend), GO-LIVE.md §2.3 — 2026-08-09

`src/email/index.js` (`sendMagicLink`) + `src/email/resend.js` — before this, `EMAIL_PROVIDER` had
no send path at all: setting it would have silently stopped sign-in/invite links reaching anyone,
since the server only ever printed them to its own console. `EMAIL_PROVIDER` unset (the default)
is unchanged — `sendMagicLink` returns `{sent:false}` and the caller's existing console-log path
carries on working. Wired into `/api/auth/request` and both admin invite routes
(`applications/:id/approve`, `admin/users` POST); a provider failure is logged and swallowed rather
than surfaced to the caller, matching the existing no-enumeration behaviour on sign-in. Needs
`RESEND_API_KEY` + SPF/DKIM at 20i for `EMAIL_FROM`'s domain before it sends anything for real —
verified so far only via the console/no-provider path and the two error paths (unknown provider,
missing API key), live in a throwaway server instance.

### Added — version stamping, GO-LIVE.md §5 — 2026-08-09

- `src/version.js` — single source of truth for `APP_VERSION` (from `package.json`), `GIT_SHA`
  (Docker `ARG`/`ENV`, falling back to reading `.git/HEAD` directly when running locally) and
  `BUILT_AT`. Deleted the hardcoded `VERSION` literal in `src/server.js`.
- `/health` now reports `version`, `gitSha`, `builtAt` and `pilotMode`.
- A muted `v0.9.0-pilot · <sha>` line in the site footer and a `<meta name="app-version">` tag on
  every page, generated into the existing `/js/site-banner.js` script — unconditionally, unlike the
  pilot banner half of that script, since the build identity must survive `PILOT_MODE=0`.
- `renders/<v>/meta.json` now records `appVersion`/`gitSha`, so a published sheet's own version
  folder says which app build produced it.
- `Dockerfile`/`compose.yaml`/`DEPLOY.md` — `GIT_SHA`/`BUILT_AT` build args, sourced from the shell
  at `docker compose up -d --build` time.

### Added — go-live code blockers, GO-LIVE.md §2.2/§2.4/§2.6 — 2026-08-09

- `scripts/create-admin.mjs` (`npm run create-admin -- --email … [--name …]`) — creates exactly
  one admin user on a clean database, no invented demo organisations. `seed-demo.mjs` remains the
  local-dev path.
- `trustProxy: true` on the Fastify instance — behind Caddy, `authLink()` now builds `https` URLs
  from the real client protocol and the per-IP rate limiter keys on the real client IP, not the
  proxy's.
- `scripts/lib/fixture-freshness.mjs` — both verify gates now print a non-blocking WARNING when a
  fixture reference is stale relative to its siblings (area: a newer sibling render exists) or
  internally skewed (place: one reference file lags the rest). Fixes the "the gate cried wolf"
  problem from GO-LIVE.md §2.6, where a stale `.env` pointer or partially re-staged place fixture
  reported as a determinism failure.
- Re-rendered `Places/_portal-fixture/High Wycombe Aldi/internal-schematic.{svg,jpg}` in the Buses
  repo from the corrected 9 Aug data (the `OVERRIDES_FILE` fix) — `verify:place` is green again.
- `docs/LICENSING.md` §5 — recorded the CSRF-token deferral as an accepted risk for the pilot,
  rather than leaving it unrecorded.

### Added — self-service "no watermark for anyone" opt-out — 2026-08-09

A customer can now let anyone (not just their own signed-in users) download their maps without
the "BusMaps.uk" watermark, from their own "Public details" page — this was previously an
admin-only toggle (`customer.watermark_enabled`, unchanged) set on request. Added a scoped
`PATCH /api/customer/settings` route (whitelists exactly `watermarkEnabled`; quota/plan/status
remain admin-only via `/api/admin/customers/:id`) and a "Downloads" panel in
`public/app/branding.html` / `branding.js`. `GET /api/customer/branding` now also returns the
customer's current `watermarkEnabled`.

### Changed — repo made private, licence switched from Apache-2.0 to BUSL 1.1 — 2026-08-09

Peter's call, made to protect the commercial advantage of the portal against a competitor cloning
the public Apache-2.0 repo and self-hosting a rival service — Apache-2.0 permitted exactly that.
`github.com/PeterC66/community-bus-maps` flipped to private. `LICENSE` replaced with Business
Source License 1.1: free for non-commercial/personal/internal/evaluation use and self-hosting;
commercial use competing with BusMaps.uk needs a separate licence from the Licensor until the
Change Date (2030-08-09), after which it converts to Apache-2.0 as before. Updated `NOTICE`,
`README.md`, `docs/LICENSING.md`, `CLAUDE.md`, `package.json` (`license` field), and every public
page's footer (removed the now-dead public GitHub link and "Open-source (Apache-2.0)" claim,
replaced with a plain copyright line) and `legal.html`'s "The software" section.
`public/opportunity.html`'s pitch card was also rewritten (Peter's choice): "Open source,
publicly" (Apache-2.0-on-GitHub as the succession asset) became "Source-available, with a path
to open" (BUSL now, converts to Apache-2.0 in 2030).

### Added — "changes coming" banner on the public map page (P8) — 2026-08-08

A map whose town has a known upcoming service change it doesn't yet reflect can now say so:
a short banner above the map image on its public `/m/<slug>` page. Wording is auto-suggested
by `scripts/check-upcoming-refreshes.mjs` from the same GTFS upcoming-changes scan that already
flags maps for refresh, and can be edited or cleared by the owning customer or an admin in the
editor (new `PATCH /api/maps/:id/banner-note`) — an edit is marked `manual` so the next scan
won't overwrite it. `scripts/import-map.mjs` also checks the newest upcoming-changes report at
build time, so a brand-new map can carry the banner from its very first publish if the change
is already known. The banner clears itself automatically the next time the map is published
(`src/server.js`, the publish-approve handler), since the fresh data is presumed to reflect it.
New `map.banner_note` / `banner_note_source` / `banner_note_set_at` columns
(`src/db/schema.sql`, migrated in `src/db/index.js`).

### Changed — full engine rollout: all 8 areas + 5 places re-rendered and published on the current template — 2026-08-08

Every town and place map was re-rendered against the current engine template (the same
`footer.js`-branded, BusMaps.uk-attributed sheet the entries below describe) and loaded
into the portal in place of the previous demo/example content, per Peter's plan
(`buses-data` `Development Docs/full-rollout-and-portal-refresh-plan_2026-08-08.md`).
The place engine (`engine/place/gen_internal.js`, `gen_external_places.js`) was
re-vendored first, since it had drifted behind the skill's current templates ([PR
#9](https://github.com/PeterC66/community-bus-maps/pull/9)) — that also surfaced that
`footer.js` itself, a new shared module, had never been vendored at all; both places'
`gen_internal_place.js` wrapper needed it too, added at the top level (`engine/footer.js`)
alongside `icons.js` so the existing `SKILL_ASSETS` fallback picks it up unchanged.
9 previously-unimported maps (Beaconsfield, High Wycombe, Huntingdon, St Neots, Wisbech
areas; Beaconsfield Simpson Centre/Waitrose, St Neots Tesco Extra/Town Centre places) were
imported via `import-map.mjs`; the 3 already-imported maps (St Ives, March, High Wycombe
Aldi) were refreshed via `propose-update.mjs` and accepted through the portal's own
editor UI. All 12 were then submitted, reviewed against the P4 5-item checklist and
published — each now has a live `/m/<slug>` page. **Ramsey is deliberately excluded**:
its S6 verification (run for the first time as part of this rollout) came back BLOCKED on
a pre-documented gap (reverse-geocoded, unverified termini) rather than a rollout defect,
and it needs a real S1 pass before it is trustworthy enough to publish. All curation
carries forward unchanged — this was a mechanical re-render against current data/engine,
not a re-curation pass; open service-inclusion questions are untouched.

### Fixed — CI fixtures caught a real content regression in the rolled-out place schematic — 2026-08-08

Refreshing the two byte-identical CI fixtures (`FIXTURE_DIR` → St Ives `v6.21`,
`PLACE_FIXTURE_DIR` → High Wycombe Aldi `v1.3`, both re-pinned in `buses-data`'s
`retention-pins.json`) to the rollout's current builds is what proved the rollout above
was clean — and, for High Wycombe Aldi specifically, caught a genuine regression rather
than confirming a refresh. Its `internal-schematic.svg` (the first place map ever to use
`internalSchematic`) had silently lost both its place-title fix ("Buses within High
Wycombe" instead of "Buses serving Aldi, Tannery Road") and its forced-POI label overrides
during the manual place re-render: the town skill's `schematize_internal.js` needs a
`gen_internal_place.js` sentinel file in the run directory to detect it's building a place
at all, which the skill (unlike the portal) never shipped, and the schematic build runs in
a `schematic/` workspace subfolder that isn't where `overrides.json` lives, so
`OVERRIDES_FILE` must be passed explicitly or POI-forcing overrides are silently dropped.
Root-caused and fixed at the source (`make-place-bus-leaflet` skill, `claude-skills`
commit `9ff7767`) and the fixture regenerated correctly before shipping. `npm run verify`
now passes byte-identical across every area and place target, expert styles included.

### Changed — marketing pages brought back in step with the rolled-out engine — 2026-08-08

The example gallery's 8 JPGs (`public/examples/*.jpg`, used on `examples.html` and
`index.html`) predated the rollout above and still showed the old inline attribution
footer instead of the new BusMaps.uk-branded band — a visible inconsistency against every
live published map. Regenerated all 8 from the current rollout builds at the existing
1400×990 convention; doing so for St Neots Town Centre surfaced that it also needed the
rollout (it had been marked "already current" earlier, correctly for route/service labels
but not for the footer or for the same S3-vs-published data gap fixed elsewhere in the
places wave — backfilled and rebuilt, `buses-data` commit `7e824e9`). Also corrected
`opportunity.html`'s "Seven towns and five places have been built with it": an eighth
town (Ramsey) has been drafted since that copy was written, but per the entry above it
is not yet verified or published, so — Peter's call — the count stays at seven with a
note that an eighth is in progress, rather than overclaiming or silently dropping it.
[PR #11](https://github.com/PeterC66/community-bus-maps/pull/11).

### Added — the place byte-identical gate now covers the schematic, proven on a real place — 2026-08-08

Extended `scripts/verify-reproduce-place.mjs` with the same opt-in auto-detection
`scripts/verify-reproduce.mjs` already had for area fixtures: when the place fixture's
`routes.json` carries `internalSchematic`/`internalDiagram`, that output is regenerated and
checked byte-identical too. Until now the place gate only ever proved geographic + external,
so the previous entry's place-title fix had no real regression coverage. High Wycombe
Aldi — the portal's canonical place fixture — has now opted into `internalSchematic` for
real (`buses-data` commit `dbc0a57`; new S3-config run records the decision, the S4/S5
build gains the schematic artefact, the fixture copy here does too), so `npm run
verify:place` now genuinely regenerates and gates it: `— gen_internal_schematic.js SVG
107,563 B BYTE-IDENTICAL, JPG pixel-identical`. Availability is unchanged elsewhere — this
is the one real place map with the config; the schematic still defaults to hidden from the
customer everywhere, per the entry below. Verified live in a scratch portal instance:
imported the updated payload, confirmed the schematic rendered (buildAlways) but was absent
from downloads, then toggled it on in the real editor UI and confirmed it appeared
immediately — title "Buses serving Aldi, Tannery Road", "Map v1.2" — with no re-render.

### Fixed — schematic/diagram now title/version-stamp PLACE maps correctly — 2026-08-08

The two expert-style pre-stages (`engine/expert/schematize_internal.js` / `diagram_internal.js`)
always ran a map's raw `gen_internal.js` in their geometry workspace, never the place engine's
`gen_internal_place.js` wrapper — so a place map's schematic/diagram, had one ever been enabled,
would have rendered with the area-shaped title ("Buses within `<town>`" instead of "Buses serving
`<place>`") and an unstripped `vv1.x` version stamp. No place map had opted into either output yet
(this was a latent gap, not a live bug), found while answering whether place maps can produce all
four outputs. Both pre-stages now detect a place map (`gen_internal_place.js` present beside
`routes.json`) and reproduce that wrapper's two fixes directly on the workspace output — `LEAFLET_VERSION`
set before the run, the title token swapped on the copied SVG afterwards — rather than running
`gen_internal_place.js` itself, since it resolves paths relative to `DIR`/`cwd`, assumptions the
workspace subfolder breaks. Fixed at the source (`make-bus-leaflet` skill, `claude-skills` commit
`715f16b`) and re-vendored here verbatim, same as every other change to this pair. **Availability is
unchanged** — both outputs are still opt-in per map (`internalSchematic`/`internalDiagram` in
`routes.json`) and the schematic still defaults to hidden from the customer (see the entry below);
this only fixes what gets rendered once a place map opts in, not whether it does by default.
Verified against the High Wycombe Aldi place fixture directly (title/version now correct); the
area byte-identical gate (`npm run verify`) still passes unchanged, since no town carries
`gen_internal_place.js` so the new branch never runs for one.

### Changed — the octolinear schematic now builds every save, hidden until the customer switches it on — 2026-08-08

Previously "enabled" was one flag doing two jobs: whether an expert style got RENDERED and whether
the customer could SEE/download it. That meant ticking the schematic's visibility box in the editor
produced nothing until the next save. `internal_schematic` is now a `buildAlways` output
(`src/maps/store.js` `OUTPUTS`): `effectiveOutputs()` (`src/maps/engine.js`) renders it into every
version whenever a map's `routes.json` carries `internalSchematic`, regardless of the enabled flag —
so the files are already sitting in the version folder the moment a customer ticks the box, with
nothing to rebuild. Visibility stays a separate, still-off-by-default gate: new
`visibleDownloadsForVersion()` (`src/server.js`) filters the customer-facing `downloads` /
`publishedDownloads` lists (and the save/accept responses) down to only the outputs the map has
switched on; the public map page (`src/public/index.js`) already worked this way independently and
needed no change. Admin-only views (publish review, revert history, the diagram pin editor) keep
using the raw file list, since an admin should see everything that exists. The tube-map diagram is
unaffected — it stays request-only and gated behind its own `enabled` flag, since it still needs
hand-pinning before it is fit to exist at all. `scripts/test-p7.mjs`'s effective-outputs checks
rewritten for the new split; `npm test` and `npm run verify` (byte-identical, area + place) both
still PASS. Verified live on a scratch DATA_DIR: saved a St Ives version with the schematic
disabled, confirmed `internal-schematic.svg/.jpg` existed on disk but were absent from
`downloads`, then PATCHed `internal_schematic: true` and confirmed the same files appeared in
`downloads` immediately, with no re-render.

### Added — pushed engine/S6/gate staleness on the To-do list — 2026-08-08

Item 3 of the fool-proofing plan. The To-do tab's ranks 0 (failing gates) and 8 (engine-stale /
S6-stale / unbuilt towns) previously existed only in the `bus-work` skill's own terminal output —
the server has no way to compute them itself, since they need the operator's private map tree
(never synced; determinism forbids the portal from generating maps). Now the laptop's
`push-status.mjs` runs `status.js --json` (the byte-identical regenerate-and-diff) and POSTs it to
new `POST /api/admin/status`, gated the same way as `/metrics` (`STATUS_TOKEN` or an admin session,
absent token ⇒ 404). The portal stores the latest snapshot under `DATA_DIR` and
`src/worklist/index.js` folds it into ranks 0/8 — so a failing gate or a stale engine now shows on
the admin console and to a remote reader, not only to whoever last ran `worklist.mjs --gates`. It is
a snapshot, not a stream: stale until the next push, and silently absent (not an error) until the
first one ever arrives. Rank 7 (a BODS-flagged town with no portal map) stays laptop-only — it needs
`_gtfs/upcoming`, which nothing pushes yet. Covered by new cases in `scripts/test-worklist.mjs`.

### Added — one ranked To-do list, and `/api/admin/worklist` behind it — 2026-08-07

The admin console had eight tabs and no answer to "what should I do next?". Every queue lived
somewhere — applications, map requests, awaiting-build, refresh flags, proposed updates, the review
queue — but working out the order meant visiting all of them, and then opening a runbook to recall
which script and which flags. The **To do** tab is now the console's landing view: every one of those
queues in a single list, ranked by *who is blocked* rather than by which tab it came from —
**Broken → Someone is blocked → Your move → Waiting on others**.

The ranking lives in one place, `src/worklist/index.js`, served at `GET /api/admin/worklist`. That
matters because there are two consumers: the console renders it, and the operator's `bus-work` skill
consumes the identical shape — importing the module directly when it runs beside the portal, GETting
the endpoint when the portal is remote. Neither can drift into showing a different list. The skill
adds the things a server cannot know (engine-stale renders, missing S6 verification, failing
byte-identical gates) at ranks the server deliberately leaves free.

Two judgements worth knowing about, both covered by `scripts/test-worklist.mjs` (new, in `npm test`):

- **When a refresh item disappears.** Nothing in the codebase ever updates `message.status`, so a
  refresh flag has no read/unread state. "Still open" is derived from whether a proposed update has
  been staged for that map *since* the flag — so the item clears when the work is done, not when
  someone remembers to tick it off, and a later flag re-opens it.
- **The commands it hands out are PowerShell.** `npm run verify` skips silently without a fixture
  dir, and bash's `VAR=x cmd` prefix does not set one on Windows — so the documented bash form
  yields a byte-identical check that never runs and looks like it passed. The build item emits
  `$env:FIXTURE_DIR = "…"; npm run verify:area`, and a test asserts no bash env prefix ever
  reappears. `docs/R1-create-map.md` has been corrected to match.

Copy buttons on the To-do tab fall back to selecting the command when the clipboard write is refused
(unfocused window, or plain http from another machine) rather than silently doing nothing.

### Added — click-to-sort columns on every admin console table — 2026-08-07

Every grid-table column header across all eight admin tabs (Applications, Map requests,
Customers, Users, Messages, Refreshes, Audit, Ops) is now clickable: click toggles
ascending/descending (▲/▼) and re-renders client-side from the already-fetched rows, no
extra request. Implemented as a generic `renderSortable()` helper in `public/app/admin.js`
that replaces the old static `gtOpen()` calls; columns without a sensible sort key (free-text
notes, action buttons) stay plain, unclickable headers. The Users tab additionally defaults
to being grouped by customer then role (`sortRowsMulti`) before any column is clicked, so
platform users and users of the same customer sit together on first load.

### Added — signed-in status and sign in/out on every public page — 2026-08-07

Previously the only way to see you were signed in, or to sign out, was `/app` itself — there was no
way back once you'd followed a link out to `/examples.html` or any other public page, and no way to
sign in from a public page either. A new shared script, `public/js/auth-status.js`, checks `/api/me`
and updates the header nav accordingly: signed in shows "Signed in as …", "My maps" and "Sign out"
(in that order) and drops the "Apply to join" CTA, since it's aimed at prospective organisations, not
existing users; signed out adds a "Sign in" link to `/app/login.html`, keeping "Apply to join". Wired
into the `<head>` of all twelve public pages (`index`, `apply`, `contact`, `examples`, `faq`, `legal`,
`map`, `maps`, `opportunity`, `org`, `pricing`, `terms`). `/app/*` pages keep their existing bespoke
whoami/logout wiring, which also handles role-based admin/review link visibility and redirects
signed-out visitors to login, so they never see the public "Sign in" case.

### Added — admin console UI for user CRUD — 2026-08-07

A **Users** tab in `/app/admin` (`public/app/admin.html`, `public/app/admin.js`) fronting the
`/api/admin/users` endpoints below: a table of every user (name/role/status editable in place, a Save
per row — matching the existing Customers tab's pattern) plus an "Invite user" dialog (email, name,
role, and a customer picker with "platform admin, no customer" as the blank option) that shows the
dev invite link the same way application approval does. An admin's own row has its status select
disabled client-side so they can't lock themselves out (the API already refuses it server-side).
Saving an invite or a status/role change also refreshes the Customers tab's per-customer user count.

### Added — admin user CRUD (`/api/admin/users`) — 2026-08-07

Roles (`editor|approver|admin`) and per-customer tenancy already existed in the schema, but the only
way a `user` row was ever created was the one-off invite baked into application approval — there was
no way to add a second person to an existing customer, change anyone's role, or turn an account off.
Added `GET/POST /api/admin/users` (list, optionally `?customerId=`; invite via the existing
passwordless magic-link flow) and `PATCH /api/admin/users/:id` (name/role/status — `status: 'disabled'`
is how an account is switched off; there's no delete, since disabling is the reversible,
audit-preserving equivalent and keeps sessions/audit rows meaningful). Admin-only
(`requireAdmin`), and an admin can't disable their own account. `listUsersAdmin`/`updateUserAdmin`
added to `src/db/index.js` alongside the existing (previously unused) `listUsers`.

### Changed — demo organisations restructured to a 0/1/rest split — 2026-08-07

`scripts/seed-demo.mjs`'s `DEMO[]` previously paired one demo org per map (St Ives Town Council,
March Town Council, Tannery Road Traders — real-council names disclaimed with a Sample badge). Editor
logins for two of the three org emails were undocumented (README only listed two of three), and there
was no seeded org demonstrating the empty-dashboard state. Replaced with three fully fictional
`(demo)`-suffixed organisations grouped by **map-count** rather than locality: Broadmeadow Parish
Council (0 maps), Fenmarsh District Council (1 map — March), and Oakfield Community Transport Trust
(the rest — St Ives, High Wycombe Aldi, and the requested St Ives Waitrose). Updated
`docs/R1-create-map.md`, `docs/PILOT.md`, `docs/ROADMAP.md` and `README.md` to match, and reassigned
ownership on the local dev DB (`data/` is git-ignored — a fresh `seed-demo.mjs` run reproduces this
distribution from a clean checkout, including once pointed at a production `DATA_DIR`).

### Added — "Report an issue" link on every public page — 2026-08-07

Printed leaflets deliberately carry no contact detail on the sheet itself, so the portal needed to
be the obvious place to report a problem with one. Added a "Report an issue" link to the header nav
and footer of all 12 public pages, routing to the existing contact form at
`/contact.html?kind=issue` with a new `issue` message kind (alongside `enquiry`, `question`,
`feedback` in `MSG_KINDS`, `src/server.js`). The contact form now reads the `?kind=` query param to
preselect "Report an issue with a map" and swaps in a relevant placeholder. Not pilot-gated — this
is a permanent feature, so no entry was needed in `docs/PILOT.md`'s removal checklist.

### Docs — bustimes.org licensing question resolved — 2026-08-07

The site owner (Josh Goodwin, bustimes.org) confirmed by email that our use — central,
human-in-the-loop, a handful of pages per town per month — is acceptable and that no attribution
is required. This closes the item that `docs/LICENSING.md` §3 had flagged as an open launch-gate
question. Updated `docs/LICENSING.md`, `NOTICE`, `docs/ROADMAP.md`, `docs/DOCUMENTATION-PLAN.md`
and `docs/H1-operations-handbook.md` to record the outcome; no attribution text was added anywhere.

### Fixed — place engine: re-vendored `gen_external_places.js` (tick draw-order + legend collision) — 2026-08-07

`engine/place/gen_external_places.js` had drifted since the 2026-08-06 ellipse-fit hub-edge
upgrade — the vendored copy was still the pre-upgrade version. Re-vendored from the skill, which
also carries two bugfixes discovered while filling `minutesToDestination`/`stops[]` on all 5
shipped places: (1) intermediate-stop ticks were drawn *before* their spoke line, so the line
painted over them — every place's ticks were invisible; fixed by drawing the line first, ticks on
top (matches the town engine's order). (2) the auto legend-placement search only treated
destination/hub node boxes as a hard no-go, never tick-label text, so the panel could land
directly on top of tick labels (St Neots Town Centre's "Huntingdon / St Ives dir" spoke); fixed by
adding each tick label's bounding box to the same hard-constraint list. Re-ran `npm run verify` /
`test:p7` / `test` (all pass), regenerated the `High Wycombe Aldi` portal fixture reference through
the fixed engine, and re-synced `ci-reference/` for all 5 places via `sync_ci_reference.js`. See
`make-place-bus-leaflet` skill `references/gotchas.md` (2026-08-07 section) for the full write-up.

### Fixed — admin/review consoles: replaced `<table>` with CSS Grid rows — 2026-08-07

Every table in the admin console (all 8: applications, map requests, awaiting-build, customers,
messages, refreshes, audit, ops store) and the review console's publication-history table had their
header row visually detached from their body columns — headers bunched left, data spread to fill
the full width. Root cause: `table.grid` used `table-layout: fixed` with a `<colgroup>` (the
textbook-correct way to pin table columns), but in real Chrome — reproduced in Incognito with
extensions off, so not an extension — the fixed-column widths silently stopped being shared between
`<thead>` and `<tbody>` once a body row contained unbreakable content (a `<button>`, a pill/badge)
sitting under a `white-space:nowrap` header cell. `table-layout: auto` vs `fixed` on a live clone
produced byte-identical (wrong) measurements, `<colgroup>` percentages read back as `0px` via
`getComputedStyle`, and no single CSS property (removing nowrap, `min-width`/`max-width` on
`.wrap` cells, `border-collapse`, stripping badges) fixed it in isolation — only converting away
from `<table>` did. See `docs/DEVELOPING.md` "Table-like grids" for the write-up and the fix
pattern (`.grid-table` / `.gt-row` / `.gt-cell` in `app.css`, `gtOpen()` in `admin.js`) — reuse it,
don't reintroduce a real `<table>` for anything with buttons/badges in a data cell.

### Changed — reworded "sign-off" as "review", re-scoped what review claims — 2026-08-07

Public copy, the app UI, the checklist and the docs all said a person "signs off" every map, and
several places layered on extra rigor words ("cross-checked", "check it carefully", "transit-safety
promise", "red-team evidence") that overstated what happens in practice. What the approver actually
does today is a reasonableness check — does this look right — not an independent re-verification of
routes or timetables against source data. Two changes, everywhere the claim was made:

1. **Terminology**: "sign-off"/"signed off" → "review"/"reviewed" throughout (public pages, app UI,
   `src/publish/index.js`, `src/server.js`, docs, runbooks). `CHANGELOG.md`'s own history is
   untouched — it's a record of what was said at the time, not current copy.
2. **Scope**: the `CHECKLIST` items in `src/publish/index.js` (bumped to `CHECKLIST_VERSION = 2`)
   and every public/doc description of review now say plainly that it's a visual check, not
   verification against timetables. See `docs/PILOT.md`, `docs/LICENSING.md` §5,
   `docs/R3-review-and-publish.md`, and the FAQ/legal/terms pages.

If the review process becomes more rigorous later (e.g. routine timetable cross-checks), upgrade
the checklist and the copy together rather than letting the words run ahead of the practice again.

### Fixed — re-vendored place external-map engine, refreshed the fixture — 2026-08-06

`engine/place/gen_external_places.js` was re-vendored from the skill (`make-place-bus-leaflet`)
after a fix session brought the place external map up to the level of the recently-upgraded area
external map: crisp (not blobby) dashed limited-service spokes, an auto-sized boxed operators
panel that now searches for a placement clear of both destination nodes AND spoke lines (not just
a first-fit), a hub clear-zone sized to the place label so route badges are never hidden under it,
and the version stamp moved to the bottom-right corner. Full detail in the skill's
`references/gotchas.md` (2026-08-06 section). Consequence: the `High Wycombe Aldi` portal fixture
(`Buses/Places/_portal-fixture/`) was regenerated from its own `routes.json` +
`base-overrides.json` through the fixed engine — its shipped `external.svg`/`.jpg` legitimately
changed, this was not a gate-relaxation. `npm run verify`, `verify:place`, `test:p7` and `test`
all pass against the refreshed fixture. All 5 built places (Beaconsfield Simpson Centre/Waitrose,
St Neots Tesco Extra/Town Centre, High Wycombe Aldi) were rebuilt through `stage.js` in the
separate Buses repo and their external maps refreshed; this repo only carries the vendored
engine + fixture, not those places' own render output.

### Added — flag maps affected by upcoming GTFS changes — 2026-08-03

New `scripts/check-upcoming-refreshes.mjs` (`npm run check-upcoming`) cross-references the Buses
side's monthly `gtfs_upcoming.py` report against the portal's own maps and queues a `refresh-flag`
message — reusing the existing admin Messages inbox, no new UI — for every **built** map (demo or
real customer, treated identically; Path A from the "External maps feature planning" plan) whose
town/place shows upcoming changes. Area maps match by exact town name; place maps match by a
substring check on `map.subject` (places have no town field of their own). Idempotent: a map already
flagged for a given report date is not flagged again. It deliberately does **not** call
`propose-update.mjs` automatically — `gtfs_upcoming.py` only mines GTFS facts, it doesn't regenerate a
leaflet, so a human (+ Claude) still has to re-run the skill and produce a fresh render; the message
names the exact `propose-update.mjs` command to run once that exists.

### Added — customer download of the disagreements audit, as a PDF — 2026-08-03

Every published map can now carry a "Disagreements report" download: the bustimes.org-vs-operator
audit trail (`disagreements.docx`, generated by the `make-bus-leaflet` skill's `gen_disagreements.py`
in Stage S1) converted to PDF via LibreOffice headless (`soffice --headless --convert-to pdf`, invoked
directly — not the office skills' wrapper, which fails on Windows). Only the PDF ever reaches the
portal; the `.docx` stays the internal editable source of truth, so what a customer sees is finalised
and non-editable.

`disagreements.pdf` is a static per-map extra, not a render output — it has no toggle and no SVG/JPG
pair. `OUTPUT_FILES` (`src/maps/store.js`) carries it as one extra entry outside the `OUTPUTS`-driven
list, so the existing generic download/serve routes (`downloadsForVersion()`,
`/api/maps/:id/versions/:key/:file`, `/api/public/maps/:slug/:file`) pick it up for free. `import-map.mjs`
auto-detects it from the town's `_latest/disagreements.pdf` (kept current by the skill's
`refresh_latest.js`) when importing an AREA map — place maps don't have one yet, since
`make-place-bus-leaflet` has no disagreement audit stage. `renderVersion()` (`src/maps/engine.js`)
copies it into every rendered version's folder, and `carryExpertTuning()` carries it forward into a
staged monthly refresh that doesn't bring its own (same mechanism as `diagram-layout.json`). Surfaced
in the editor's downloads row (`DL_LABELS`) and on the public map page, in the "About this map" card.

### Added — opt-in per-customer operator filter — 2026-08-03

A third safe-subset key, `hiddenOperators`, alongside `routeColors` and POI hide/show: a customer can
untick an operator in Map Tuning to drop all of its routes from both the "within" and "from" maps —
route lines, badges, Services panel entries and its own legend row. Off for every customer by default
(`customer.hide_operators_enabled`, admin-toggleable from the Customers panel); the editor UI hides the
whole Operators panel unless the flag is on, and the server rejects the key outright for anyone it
isn't enabled for, even if the client somehow sends it.

The engine side of this shipped first in the `make-bus-leaflet`/`make-place-bus-leaflet` skills
(`gen_internal.js`, `gen_external_radial.js`, `gen_external_busway.js`, `gen_external_places.js`) —
absent/empty `hiddenOperators` is byte-identical, gated PASS on every town/place fixture — then
vendored here (`engine/place/gen_internal.js`, `engine/place/gen_external_places.js`) and re-verified
with `npm run verify`. New `scripts/test-safe-subset.mjs` (`npm run test:safe-subset`, folded into
`npm test`) covers the validation boundary directly.

## [0.9.0-pilot] — 2026-08-02

The release that made the pilot presentable: it says what it is called, what it costs, who is behind
it, and which of its outputs is not a tick-box. `package.json` and `src/server.js` have carried this
version number since the pilot-mode work; this is where it is written down.

### The BusMaps.uk repositioning — 2026-08-02, in one place

Everything dated 2026-08-02 below belongs to one piece of work, done over seven sessions against
[`Buses/Development Docs/busmapsuk-repositioning-plan_2026-08-02.md`](https://github.com/PeterC66/community-bus-maps),
which is the plan of record and carries the per-session detail and lessons. The short version of
**why**, since the individual entries only say what:

The system had outgrown the way it described itself. It was called *Community Bus Maps* in a hundred
places while the domain said something else; its shop window was a **place that had closed**; it made
no claim about the one capability that most distinguishes it commercially (knowing how hard a town
is *before* quoting); it had a page saying what it does and none saying what it would cost; and it
offered, as a tick-box next to three generated outputs, an output that is **finished by hand and
re-finished at every refresh**. Each of those is small. Together they meant a visitor could not
answer "what is this, what would it cost me, and who is behind it" without asking.

So, in order: the name became **BusMaps.uk** everywhere a person can see it (the repo, the package
name and the service id deliberately did not change — that is stated in the README so nobody
"fixes" it). The **Simpson Centre** was replaced by **High Wycombe Aldi** as both the shop-window
example and the byte-identical fixture — which immediately earned its keep by exposing that the
vendored place engine was 445 lines behind the skill, invisible for weeks because the old fixture was
frozen against the same old code. **High Wycombe** was added as an area example told as the
complexity-triage story, because RED → GREEN with the scores on either side is the most credible
thing the system can say about itself. **`/pricing.html`** describes the model with no figure on it,
and **`/opportunity.html`** says plainly that this is a one-person project looking for a CIC. The
**tube-map diagram** stopped being a tick-box: it is badged wherever it is offered, explained in the
FAQ, and request-only with the refusal enforced server-side.

Two habits came out of it and are worth keeping. **Every count on a public page was checked against
the disk rather than copied from the plan** — which is how "six place maps" became five, how "proven
on four towns" became seven, and how a claim that the restore drill had been *rehearsed* came out
altogether. And **the decks now generate from tracked source** ([`BusMapsUK/deck-src/`] in the Buses
repo): three of the six had already lost their generators to expired scratchpads and had to be
reconstructed by reading the shipped `.pptx` back.

Still open, unchanged by any of this: the bustimes.org terms question (`docs/LICENSING.md` §3), the
final read of `/legal.html`, CSRF, and an email provider.

### Added — an opportunity page, for the visitor who would rather run this than buy it
- **New [`public/opportunity.html`](public/opportunity.html)** — "Take this on": the co-founder pitch
  for handing the system to a **Community Interest Company**, with four things a serious candidate
  needs and rarely gets. *What the asset actually is*, stated concretely (seven towns and five places
  built; the complexity gate; three approval gates and the monthly cycle; an operations handbook and
  six runbooks; Apache-2.0 on GitHub; open data end to end). *Why a CIC* — the cross-subsidy from
  campuses and business parks to parishes and community transport is governance, not goodwill, and
  the asset lock keeps it that way. *Who would suit it*, including that this is a one-person project
  and **succession is the problem being solved**. And *what is not resolved*: bustimes.org's terms,
  and the fact that no decision has been taken between a CIC and a small commercial supplier.
- **Linked from the footer of every public page** ("Take this on") and from one strip at the foot of
  the home page. Not in the nav: it is not part of the shopfront journey.
- **Every count on the page was checked against the disk**, not taken from the plan — which is how
  "six place maps" became **five** (Beaconsfield Simpson Centre and Waitrose, High Wycombe Aldi,
  St Neots Tesco Extra and Town Centre). The claim that the restore drill had been *rehearsed* was
  removed for the same reason: `docs/DEPLOY.md` documents the procedure, and there is no record of it
  having been run. The page now says it is written down, which is what is true.
- **No figure, competitor estimate or effort-per-map number appears on it** — that material stays in
  the private ops folder and goes to a candidate in conversation. The page says so.
- **The pitch's "proprietary technology" was corrected to "openly licensed"** when it moved onto the
  site: the repository is public and Apache-2.0, so the original wording was simply wrong.
- `STATIC_PAGES` gained `/opportunity.html` **and `/terms.html`**, which had been in the footer but
  missing from the sitemap. The rule is now written down beside the list: the sitemap and the footer
  should name the same pages. What keeps the page unindexed during the pilot is `robots.txt`.

### Changed — the tube-map diagram is warned about, and request-only
- **The cost is now stated wherever the diagram is offered.** The home page's *Four outputs* card, the
  examples-page note and the `pricing.html` Extra list all carry a **hand-finished · extra** badge and
  say why: the machine solves the topology, then every line and interchange is *placed by hand* — and
  re-placed whenever the network moves. A new FAQ answer at
  [`/faq.html#diagram`](public/faq.html) makes the real point explicitly: because the hand placements
  are **pins we maintain**, the diagram costs drawing time in the *updates*, not only in the first
  build. That is why it is priced separately rather than folded into the map.
- **It is no longer a tick-box.** `OUTPUTS.internal_diagram` is marked `requestOnly` in
  [`src/maps/store.js`](src/maps/store.js). The editor shows it locked with an **Ask us** button;
  pressing it raises a `diagram-request` **message** (the existing table, with the map attached) that
  the admin console already displays — it switches nothing on. Granting it stays what it was: an admin
  ticking it, or the pin editor's save doing so itself.
- **The lock is server-side.** The decision moved out of the route into a pure
  `chooseOutputs()` in [`src/maps/engine.js`](src/maps/engine.js), which the PATCH handler now calls:
  a non-admin asking for `internal_diagram` gets **403** with the whole change refused, and a granted
  diagram can be neither switched off nor lost by a PATCH that omits the key. Nine new checks in
  `test-p7.mjs` assert the rules, and four more assert the route is actually using them — hiding a
  checkbox is UX, not security.
- Fixed alongside: `applyLock()` re-enabled *every* output checkbox when a map came out of review,
  including ones disabled for their own reason (an output this map cannot produce). Controls disabled
  on their own account now carry `data-fixed` and stay that way.
- `/faq.html#diagram` opens the answer it points at (`public/js/faq-anchor.js`) — answers are
  `<details>`, and a link into a collapsed one is not much of a link.

### Added — a pricing page, with no figures on it
- **New [`public/pricing.html`](public/pricing.html)**, in the nav between Examples and FAQ, in the
  footer of every page and in the sitemap. It leads with *free during the pilot* and then describes,
  entirely in the future conditional, **what** would be bought (print-ready sheets, the monthly
  maintenance cycle, the public page — saying plainly that the maintenance is the product and the
  one-off sheets are what everyone else sells), **how** a price would be arrived at (a build fee
  quoted after the survey, plus an annual fee per map), what would be included versus extra, how it
  compares, which budgets normally pay, and that we do not print.
- **No figure appears anywhere on it.** The commercial model — rates, competitor estimates,
  effort-per-map — stays in the private ops folder. What is published is the *structure* of the
  model, which is what a prospective buyer actually needs in order to decide whether to ask.
- The FAQ's "How much does it cost?" now points here, and a new FAQ entry answers *why the price
  would depend on your town*. The home page's closing note links here too.

### Added — High Wycombe as the area example, told as the triage story
- **A fourth card on [`public/examples.html`](public/examples.html)** using the area images prepared
  last session, plus a **"Complex towns"** section at `#complex`: what makes a town hard to draw, the
  fact that it is *scored before the expensive work starts*, and High Wycombe's own
  **RED → GREEN** before-and-after (31 lines / 320 stops / two-thirds of the typical route buried,
  down to 11 colour groups / 91 stops / nothing congested) with the remedy ladder in plain English.
- **A "Does it work on a big town?" strip on the home page** carrying the same story in short, so the
  system does not read as a one-town trick. Section shading alternates down that page, so the three
  sections below the new one flip to keep the rhythm.
- The claim that the shown map *is* the post-triage build was checked, not assumed: both example JPGs
  are downscales of the current `_latest` render (RMS grey difference ~4–5 against a LANCZOS
  downscale of the source, i.e. resampling and JPEG only).
- High Wycombe has no `internal-schematic` output, so its card shows internal + external like every
  other card and claims nothing more.

### Changed — the shopfront speaks to five pain classes, not six organisation types
- **"Who it's for" on the home page** was organised by *type of organisation*; it is now organised by
  *pain*, around the five UK-wide classes: transport authorities and councils; healthcare, campuses
  and schools; business and science parks; town centres, BIDs, tourism and attractions; bus operators
  and community transport. A sixth tile keeps the door open for everyone else.
- **[`public/apply.html`](public/apply.html) lets an applicant self-identify by class.** `ORG_TYPES`
  in [`src/server.js`](src/server.js) gained the five class slugs; **the original seven values are
  still accepted** so that stored applications and seeded demo rows keep validating, since
  `customer.type` is copied straight from this field on approval. No schema change — only the column
  comment. Verified against a scratch database: each new value and the legacy `council` accepted, an
  unknown value rejected with 400.

### Changed — Simpson Centre replaced by High Wycombe Aldi as the place example
- **The Simpson Centre has closed**, so it was a poor shop window as well as a stale one. The place
  example everywhere is now **Aldi, Tannery Road, High Wycombe** — the *busy* case (11 services
  calling, 14 reachable places), which demonstrates more than the quiet one did.
- Swapped: [`public/examples.html`](public/examples.html) and its images, the seeded demo map and
  organisation in [`scripts/seed-demo.mjs`](scripts/seed-demo.mjs), `PLACE_FIXTURE_DIR`, and the
  references in [`README.md`](README.md), [`docs/H1-operations-handbook.md`](docs/H1-operations-handbook.md)
  and [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **The demo customer is invented, and deliberately not the retailer.** A map's *subject* may be a
  real place — that is just geography — but naming a real commercial brand as the customer would
  read as a signed-up client of a service that has none. The seeded org is
  *Tannery Road Traders (sample)*, `is_demo`, with the usual Sample badge and disclaimer.

### Fixed — the place gate was checking the wrong SVG
- **[`scripts/verify-reproduce-place.mjs`](scripts/verify-reproduce-place.mjs) rasterised the
  *reference* SVG rather than the regenerated one**, so the JPG line reported "pixel-identical" on a
  run where the SVG genuinely DIFFERED — the one run where you need it to be believable. It now
  rasterises what it just generated.

### Changed — fixture and source paths follow the Buses folder restructure
- **The separate Buses data repo now nests towns under `Areas/`** and places under their area
  (`Areas/<Town>/Places/<Place>/`), with `Places/_standalone/` for places whose town has no area map.
  `Places/_portal-fixture/` is unchanged. Updated here: `.env.example` and `.env` (`FIXTURE_DIR`),
  `scripts/seed-demo.mjs` (`renderParent` for all three seeded maps) and the `import-map` /
  `propose-update` examples in [`README.md`](README.md).
- **Both byte-identical gates were re-run against the new layout and still PASS** with unchanged byte
  counts — area 471,569 / 33,768 / 253,112 / 252,096 B, place 60,014 / 10,068 B — and `npm test` is green.
- **`FIXTURE_DIR` points two versions behind the newest render** (St Ives `S5-render/v6.6`, newest
  `v6.8`). That is deliberate and it is now *pinned* in the Buses repo's `retention-pins.json`, because
  the obvious "keep the newest couple of builds" tidy-up would otherwise delete the fixture and break
  `npm run verify:place`/`:area` silently. **If you ever re-point `FIXTURE_DIR` or
  `PLACE_FIXTURE_DIR`, update that pin file in the same change.**
- The Buses repo now tracks build *inputs* (`S1`–`S3`, manifests, READMEs, `*.docx` reports) and
  ignores build *outputs* (`S4`/`S5`/`S6`/`_latest`). `Places/_portal-fixture/` is tracked, so
  `npm run verify:place` is reproducible from a clean checkout of that repo.

### Docs — R1 says how to build a demo/example map
- **[`docs/R1-create-map.md`](docs/R1-create-map.md): new "Demo and example maps" section.**
  The obvious reading of R1 — "our own maps have no customer, so omit `--customer`" — produces an
  **unowned** map, which is admin-only for good: every public query joins `customer`, so it can never
  reach `/maps`, `/m/<slug>` or `/o/<org-slug>`, and with no editor account the edit → sign-off loop
  can't be demonstrated either. The section says to seed a demo organisation (`is_demo`, "Sample"
  everywhere) instead, preferring `DEMO[]` in `scripts/seed-demo.mjs` because `data/` is git-ignored
  and a map only in a local `DATA_DIR` does not survive a fresh checkout. Also restates the naming +
  disclaimer rule for orgs named after real bodies, and that Sample labelling is not pilot-gated.
  The `--customer` row in the flag table now points at it.

### Fixed — three faults found driving the editor for real
- **A newly enabled sheet said "Save to render" instead of rendering.** Switching on an expert
  style put it in the tab strip, but the saved version has no file for a sheet that did not exist
  when it was rendered, and the editor only previewed on an edit — so the first thing you saw was
  a dead panel that a toggle off-and-on cleared. The editor now previews the missing sheets on
  load (and says "Rendering…" while it does), which is the same render it would have done anyway.
- **A recoloured route could hide its own number.** A route's label ink comes from `textOn` in
  the imported data and does not follow a recolour: St Ives route 9 changed to black kept `#111`
  text and the 9 disappeared, in the editor's swatch list and on every sheet. New
  `src/render/badgeContrast.js` re-inks a badge whose number has vanished, applied to the
  finished SVG in `renderMap.js` — the same trick as the pilot band, and for the same reason
  (generators are vendored per map, so `engine/` cannot reach a map that already exists). It is
  **not** pilot-gated. The threshold is deliberately 2:1, well under WCAG's 3:1 for large text:
  several shipped route colours sit just under 3:1 (white on `#EE7733`, on three towns' maps),
  and quietly restyling somebody's palette is not this function's job. `scripts/fix-badge-contrast.mjs`
  repairs sheets already in the object store, published ones included.
- **The diagram pin editor's handles were nowhere near their junctions.** Handles were drawn at
  the solver's page-mm, but the sheet under them is in a different frame — `gen_internal` re-fits
  the solver's workspace, and the pilot band shrinks the document again (the two differ by ~2×
  plus an offset, so you could not tell which handle was which). Rather than re-deriving
  transforms that belong to the generators, `src/expert/index.js` now **measures** the composite:
  the sheet is solved with `EDITOR_KEYS` so its stop ticks are tagged, and a robust least-squares
  fit against the workspace's own coordinates recovers the affine, which the editor uses for
  handles and inverts for drags. Median handle error on St Ives: 5.4 mm → 1.4 mm (handle radius
  is 1.6 mm). `diagram_internal.js` gained one field (`wll` per junction) to make the fit
  possible; `solved-nodes.json` is not part of any rendered output and both gates stay green.

### Added — pilot mode: say plainly that this is not a live service
- The portal read as an established service with customers. It has none: every organisation in
  the database is seeded demo data and every map on the public site is one of ours. Anyone
  looking at it — a prospective customer, a colleague — would have concluded otherwise.
- **One switch.** New `src/config.js` exports `PILOT`, read from `PILOT_MODE` and **on unless
  explicitly `0`**, so forgetting the env var fails towards the honest state. `PILOT_MODE=0`
  removes the banner, the title prefix, the sheet band and the robots block in one go.
- **Web chrome.** There is no template engine (17 hand-written HTML files with a copy-pasted
  header), so the banner is injected by one server-generated `/js/site-banner.js` — one
  `<script>` tag per page, one place for the copy. It also prefixes the tab title, via a
  `MutationObserver` so the public map/org pages can't overwrite it after their fetch.
- **Every rendered sheet** gets a red band across the top (`src/render/pilotStamp.js`). It
  RESERVES space rather than overlaying: the sheets have no reliable whitespace, so the artwork
  is shrunk ~4% and slid down. Applied in `renderMap.js` *after* the generator runs, which
  covers all four outputs and every map's vendored generator copies from one function — and
  leaves the byte-identical gate untouched (the two `verify-reproduce` scripts pass
  `stamp: false`, since they test determinism, not presentation).
- `scripts/restamp-renders.mjs` adds or strips the band on sheets already in the object store,
  including published ones. The transform is lossless (stamp → strip is byte-identical) and
  idempotent.
- **Sample labelling, NOT pilot-gated.** New `customer.is_demo` flags the organisations
  `seed-demo.mjs` invents — set on create and backfilled on re-run — surfaced as a red
  **Sample** badge plus an "this organisation is invented" note on `/maps`, `/m/`, `/o/` and the
  home strip. Demo data stays demo data after the pilot ends.
- **Truthful copy, also not gated.** "Maps our customers have published", "those are live, kept
  up to date", "we will get back to you", "our team", "always looks right" were false and are
  rewritten to be true in either state. New `#pilot` FAQ entry is the banner's link target.
- `docs/PILOT.md` is the removal checklist; `grep -rn "PILOT:"` finds every gated block.
- Gates: `npm test` (P6/P7/lifecycle) and `npm run verify` (area + place) both green, before and
  after; verified end to end on a scratch data store including the `PILOT_MODE=0` revert.

### Added — `docs/DUMMIES_GUIDE.md`, a plain-commands front door
- New `docs/DUMMIES_GUIDE.md` for someone who knows cmd/PowerShell, FTP and GitHub but not git
  or Node: the four git commands actually needed day to day, starting the local dev server,
  seeding demo data, and a cheat sheet — with pointers into the deeper docs rather than
  repeating them.
- Records that the current 20i hosting package is standard shared hosting (FTP + phpMyAdmin)
  and, per 20i's own docs, **cannot run Node.js** — that needs their separate "Node.js
  Optimised Cloud Server" product. Documents Render.com's free tier as a no-cost demo path
  instead, including its two real limits (15-minute spin-down, non-persistent disk on the free
  instance type).
- Linked from `README.md` (above quick start, and in the layout doc index).

### Added — `docs/DEVELOPING.md`, the developer counterpart to the operator docs
- The documentation set covered how to **run** the service but not how to **change** it. New
  `docs/DEVELOPING.md` states the two things a change must not break — **determinism** (no network,
  no clock, no randomness, absent-config ⇒ byte-identical) and the **three approval gates** (org
  approval, map request + quota, publish sign-off) — plus the generator env contract
  (`LEAFLET_DIR` / `SKILL_ASSETS` / `OVERRIDES_FILE` / `EDITOR_KEYS`), the **`LEAFLET_DIR` trap**
  that makes an expert style silently render as the plain geographic map, a where-things-live index,
  and the gates to run.
- Documents the **vendored-engine hand-off** explicitly: `engine/`, `engine/place/` and
  `engine/expert/` hold byte-for-byte copies of an upstream authoring toolchain, with **no automated
  drift check** — so a change there is unfinished until it is re-copied and every gate re-run.
- Records that **`npm run verify` exits 0 with "skipping" when `FIXTURE_DIR` is unset**, so a green
  run in a fresh clone proves nothing about the renderer. Also noted in `README.md`.
- Linked from `README.md` (quick start + layout) and the Operations Handbook's document map.

## [0.8.1] — 2026-07-25

Closes the **two code rough edges** the P7 docs recorded as known-but-unfixed. Both were seams
where an operator had to work around the software by hand: a customer's approved map request and
the map the pipeline built were two different rows, and taking a wrong published map back to a
known-good version meant a full re-run through the gate. Neither adds a new concept — both make
an existing lifecycle finish.

### Added — the importer fulfils an approved request in place
- **`import-map.mjs --request <mapId>`** builds an approved request **into that row**: the
  placeholder *becomes* the built map. Owner, kind, name, slug and subject come from the request
  (each still overridable), the row moves `approved` → `draft`, and the fulfilment is audited as
  `maprequest.fulfil`. One row, **quota counted once**, nothing to archive afterwards.
- It refuses, before touching anything, an un-approved request (approval stays the gate), a map
  already built (new data is the monthly refresh, not an import), a `--kind` that differs from what
  was requested (quota is per kind), and a `--customer` that would **re-own** someone else's map.
  A plain import whose slug collides with a queued request now prints the `--request <id>` to use
  instead of letting a duplicate row be created.
- **`--list-requests`** prints the build queue. The admin console shows the same queue —
  **Map requests → "Approved — awaiting a build"** — each row carrying its exact build command
  (with a Copy button) and an **Archive** action for a request that will never be built (which
  frees the quota slot; previously only a still-`requested` row could be archived).
- New: `listAwaitingBuild()`, `updateMapIdentity()` (a whitelist — owner/kind/status are not
  touchable through it), and `adminSummary().awaitingBuild`, so the tab badge counts **both**
  halves of the lifecycle: decide it, then build it.

### Added — one-click revert to the previous published version
- **`/app/review` → "Published maps"** lists every map with a published version; opening one shows
  its **publication history** — each version ever signed off, newest first, with its approver,
  their note and its print files — and **Revert to this**.
- `POST /api/review/maps/:id/revert` (approver/admin, **reason required**, audited as
  `version.revert`) moves only the **public-current pointer**. Nothing is re-rendered and the
  customer's working head is untouched, so a correction can carry on being prepared.
- The candidates are **only** versions with an approved `publish_request` whose rendered files are
  still on disk, so a revert can never serve bytes that did not pass the gate; a pruned version says
  so and sends you to publish a correction. The version reverted *away from* stays in the history
  (roll forward, or revert again). A revert refuses while a publish request is open, so an approver
  is never reviewing against a pointer moving under them.
- Target selection is `chooseRevertTarget()` in `src/publish/` — pure, so the rules are unit-tested
  away from HTTP. New queries: `listPublishedHistory()`, `listPublishedMaps()`.

### Added — tests
- **`scripts/test-lifecycle.mjs`** (`npm run test:lifecycle`, and in `npm test`): 50 checks over both
  seams — the build queue, in-place adoption, every importer refusal (driven through the real CLI
  against a throwaway `DATA_DIR`), the identity whitelist, publication history (including that a
  *rejected* submission never enters it), every `chooseRevertTarget()` rule, and the pointer move
  leaving the editor's head alone.

### Verified
- **End-to-end on a copy of the demo store**: an approved area request was fulfilled by
  `--request 4` → the same row became a **draft** with 4 rendered files, owner and request note
  intact, out of the build queue, quota **unchanged at 2** (it was already counted), audited.
- **A published map reverted through the UI**: pointer `v1.1` → `v1.0`, editor's head still `v1.1`,
  `/api/public/maps/st-ives` immediately served `v1.0`, `v1.1` offered as the roll-forward target,
  reason recorded in the audit trail. Empty reason and a map with nothing to revert to were refused.

### Docs
- **R1** (create a map) replaces its "known rough edge" with the `--request` flow + refusal table;
  **R6** (incident response) replaces its rough-edge note with the revert procedure and what it does
  *not* do (it does not re-list an unlisted map); **R2** and the documentation plan follow suit.

### Changed
- Version → `0.8.1`.

## [0.8.0-P7] — 2026-07-25

Phase **P7** — **expert styles + ops hardening.** Two halves, and they are the last two
pieces of the original plan: the **other two outputs** (the octolinear schematic and the
tube-map diagram) now render in the portal with the same byte-identical guarantee as the
geographic pair, with the **diagram pin editor re-homed** as an admin-only tool; and the
service becomes operable — readiness, metrics, backups, a retention job, a container +
deploy runbook, and the licensing sign-off gate.

### Added — expert styles (the third and fourth outputs)
- **`engine/expert/`** — the schematic + diagram engines, vendored (see its README). Unlike the
  area generators (which travel per-map) and the place engine (copied *into* each place map),
  these are **portal-owned**: a town's render folder never carried them and they are identical
  for every map. `OUTPUTS` marks them `engine: 'expert'`, so `resolveGen()` returns an absolute
  path out of that folder and `generateSvg()` accepts it.
- **Two thin wrappers** (`gen_internal_schematic.js`, `gen_internal_diagram.js`) around the
  verbatim pre-stages. Both pre-stages are *geometry* stages: they rewrite the map's geometry
  into a workspace and then run **the map's own `gen_internal.js`** there, so badges, labels,
  the Services panel and POI icons are reused rather than reimplemented. The wrappers name the
  artefact, fail loudly when the map has no config, and — the one that would have bitten
  silently — **delete `LEAFLET_DIR` for the child** (the portal always sets it; the pre-stage
  runs its child with `cwd` = the workspace, and `gen_internal` prefers `LEAFLET_DIR`, so an
  inherited value reproduces the ordinary geographic map instead of the style).
- **Opt-in availability** — an expert output is offered only when the map's `routes.json`
  carries the pre-stage's config key (`internalSchematic` / `internalDiagram`), via a new
  `requiresConfig` + `hasRoutesKey()`. A map without it shows the output as *unavailable*
  rather than failing at render time, and the server refuses to enable it.
- **Off by default** (`defaultOutputs()`, `effectiveOutputs()`): a schematic or diagram is an
  editorial choice, so a map opts in deliberately — and a map imported before P7 does not
  suddenly start producing two more sheets on every save.
- **The byte-identical gate covers them** — `scripts/verify-reproduce.mjs` picks both styles up
  when the fixture opts in. St Ives v6.6: schematic **253,112 B SVG / 1,054,471 B JPG**, diagram
  **252,096 B / 1,077,051 B**, both byte-identical on the first run, so all **six** outputs
  (4 area + 2 place) are now gated.

### Added — the expert pin editor
- **`/app/maps/:id/diagram`** (`public/app/diagram.{html,js}`, adapted from the skill's
  `assets/diagram_edit.js`) + **`src/expert/index.js`** and admin-only `/api/expert/maps/:id/diagram`
  (state / `preview` / `save`). Drag a junction to **pin** it, drop to re-solve and see the real
  sheet, right-click to unpin. This is deliberately the mirror of the customer safe subset —
  dragging changes *layout*, which is exactly what customers may not do, so every route is
  `requireAdmin`.
- **Previews never touch the live map**: solving runs in a per-map sandbox (rebuilt when the live
  data changes). **Save** writes `diagram-layout.json` into the live data and then goes through
  the ordinary versioned render — so the tuning arrives as a *draft* that still needs the P4
  sign-off, is audited (`diagram.save`), and switches the diagram output on if it was off.
  Editing is refused while a publish request is pending, and a failed render restores the
  previous layout.
- **Pins survive a monthly refresh** — `carryExpertTuning()` copies the layout onto the staged
  payload **before** the refreshed version renders (and `swapInProposedData()` carries it forward
  as a backstop), so the P5 old-vs-new preview and the accepted `vN.0` both show the tuned
  layout. The engine re-resolves a pin by its stored lat/lon when a node key moves.
- **Pins are whitelisted** (`sanitizePins`) like every other stored instruction: finite,
  bounded page-mm coordinates on plausible keys, capped in number, everything else dropped.

### Added — ops hardening
- **`src/ops/index.js`** — a **readiness** probe that exercises what actually breaks (SQLite
  answers, `DATA_DIR` is writable, the vendored engine files are present, sharp can encode) plus
  storage/activity snapshots. `/health?deep=1` runs it and returns **503** when degraded (the
  container `HEALTHCHECK` and any load balancer should use it); `/health` alone stays a cheap ping.
- **`/metrics`** — Prometheus text (readiness per dependency, store bytes, reclaimable bytes,
  versions, pending queues, sessions), gated by `METRICS_TOKEN` or an admin session and **404**
  otherwise, so an unauthenticated scrape can't map the estate.
- **Admin → Ops tab** (`/api/admin/ops`) — dependency health, per-map disk usage (data / renders /
  staged / archived), what a prune would reclaim, and the activity counts.
- **`scripts/backup.mjs`** (`npm run backup`) — SQLite via **`VACUUM INTO`** (a consistent copy of
  a live, WAL-mode database; `cp` can capture a torn file plus a stale `-wal`), plus each map's
  `data/`, `overrides.json` and `renders/`, with a manifest and `--keep` retention. Deliberately
  skips `proposed/` and `archive/` — the bulk, and re-stageable.
- **`scripts/prune-staged.mjs`** (`npm run prune:staged`) — closes the P5 retention follow-up:
  removes staged payloads of **settled** refreshes and the data an accepted refresh replaced, older
  than `--days`, with `--dry-run`. Never touches a pending update, live data, or any rendered version.
- **`Dockerfile` + `compose.yaml` + `docs/DEPLOY.md`** — single process, single volume, reverse proxy
  in front; systemd unit, smoke test, backup schedule, **restore drill**, housekeeping, and the
  upgrade sequence (`npm test` → `npm run verify` → deploy).
- **`docs/LICENSING.md`** — the launch go/no-go: every source and its obligation, where the credits
  actually appear (on the *sheet*, which survives being detached from the site), the open
  **bustimes.org terms** question with three ways to close it, and a sign-off table.
- **`scripts/test-p7.mjs`** (`npm test` now runs P6 + P7) — the availability/enablement rules, the
  pin round-trip, that `server.js` still sanitises pins, and the ops probes on an empty store.

### Changed
- `generateSvg()` accepts an absolute generator path; `svgNameFor()` matches on the basename.
- Editor: an admin sees a **Diagram layout** link on maps that have a diagram; the outputs panel
  now says *“— expert style”* / *“— not set up for this map”* instead of “coming with expert
  styles”; downloads label the four new artefacts.
- Public pages label the new outputs for readers (“Simplified street map”, “Network diagram”).
- Version → `0.8.0-P7`.

### Verified
- **All six byte-identical gates PASS** (`npm run verify`): area internal/external, both expert
  styles, and the place pair. `npm test` green (P6 + P7).
- End-to-end on an isolated scratch server against a copy of the real demo store: the expert
  endpoint solved St Ives' diagram (25 junctions, ~1 s), a pin moved its junction to where it was
  dragged, a **hostile pin payload** was reduced to nothing usable, save was **409'd while a
  publish request was pending** and succeeded after withdrawal (v1.2, diagram output auto-enabled,
  audited), the pins persisted and reloaded, a **customer** save then rendered all four sheets with
  their recolour reaching the schematic and diagram, and a **monthly refresh** staged *without* a
  layout still produced a pinned `v3.0` (and a pinned old-vs-new preview). A drag → save through
  the real UI produced `v3.1` with 8 artefacts. Isolation: an editor gets **403** on all three
  expert routes, `/metrics` **404**, `/api/admin/ops` **403**; a place map without the config gets
  a clear **400**. Ops: readiness all-ok, the Ops tab reported 49.8 MB with 11.2 MB reclaimable, a
  backup ran **while the server was up** (38.7 MB, manifest written), and the prune freed 10.1 MB
  while leaving the pending update, live data and every render intact. Zero console errors.

### Notes / lessons
- **`LEAFLET_DIR` is inherited, and that is a trap.** A pre-stage that re-runs the main generator
  in a workspace only works if the child resolves *its own* folder. The portal is stricter than the
  desktop pipeline (it always sets `LEAFLET_DIR`), so vendoring the pre-stage verbatim required a
  wrapper that unsets it — otherwise both new outputs would have rendered as perfect copies of the
  geographic map, which no test that only checks "an SVG appeared" would catch.
- **Opt-in beats capability.** "Can the portal render it?" and "should this map have it?" are
  different questions. Keying availability on the map's own config, and enablement on an explicit
  `true`, means a pre-P7 map's save behaviour is unchanged and a customer can't switch on a sheet
  the data can't produce.
- **Carry expert tuning onto the staged data, not just onto the live folder.** The refreshed version
  renders *from* the staged payload before the swap (P5's render-before-swap), so a file copied only
  at swap time arrives one render too late — the symptom was a refreshed diagram that had quietly
  lost its pins.
- **Two editors, one gate.** The expert tool writes through the same version/publish path as the
  customer editor rather than around it. Layout work is therefore reviewable, revertible and audited
  — and "who may change what" stays a role check, not a separate pipeline.
- **`VACUUM INTO`, not `cp`.** The only safe way to back up a live WAL database in one step, and it
  is worth saying out loud in the runbook because `cp portal.sqlite` looks like it works.
- **Keep the honest asymmetry in what is kept.** Backups exclude staged/archived data (re-stageable,
  superseded) while the prune removes it — but neither ever touches a rendered version, because the
  published bytes are the promise the whole system makes.

## [0.7.0-P6] — 2026-07-25

Phase **P6** — **the public front.** P0 shipped a shopfront that *described* the service; P6 makes the
service's output public. A map that has been through the publish gate now gets a **page anyone can
visit**: the signed-off sheets to view and download, the publishing organisation's own branding, and a
"something looks wrong" form that comes back to us with the map attached. Plus a **published-maps
gallery**, an **organisation page**, a **privacy/licensing page**, `robots.txt` and a live `sitemap.xml`.

The public site is a **read view over what P4 already decided** — it stores nothing of its own and can
only reach a map that (a) has a `published_version_id`, (b) belongs to an **active** customer and (c) the
customer has left **listed**. Those three conditions live in the SQL (`src/db/index.js`), so drafts,
pending versions, archived maps, suspended organisations and all customer PII are unreachable by
construction rather than by filtering at the edge. Publishing never re-renders (P4), so a public page
serves the exact bytes an approver signed off.

### Added
- **Public map pages** — `/m/<slug>` (`public/map.html` + `js/public-map.js`): output tabs, the sheet
  inline, downloads (print JPG + SVG), version + publication date, the organisation's credit line, and the
  feedback form. `/maps` (`maps.html` + `js/public-maps.js`) is the gallery; the home page grew a live
  **"Already published"** strip (`js/published-strip.js`) that stays hidden while nothing is public.
  Unknown or no-longer-public slugs return a **real 404** page (`notFoundPage()` in `server.js`), never an
  empty shell — and never a hint that a draft exists.
- **Public API** (unauthenticated, read-only): `GET /api/public/maps`, `…/maps/:slug`,
  `…/maps/:slug/:file` (the file list is the `OUTPUT_FILES` whitelist and **the version key comes from
  the DB, never the URL** — nothing to probe, nothing to traverse), `…/maps/:slug/preview/:base`,
  `GET /api/public/orgs`, `…/orgs/:slug`, and `POST /api/public/feedback`.
- **Screen copies of the print sheets** (`src/public/index.js` `webPreviewPath()`) — an A4 300 dpi JPG is
  ~1 MB, far too heavy for a gallery, so a 1400 px copy is **derived from the signed-off print file on
  first request** and cached beside it (`<base>-web.jpg`, ~135 KB). Nothing changes at render time, the
  print bytes are untouched, and versions published before P6 get previews too.
- **Per-customer branding** (`src/branding/index.js`, `/app/branding` + `PATCH /api/customer/branding`) —
  public name, one-line blurb, website, badge (emoji or initials) and an accent colour from a **fixed
  list**. `sanitizeBranding()` is the gate, in the same spirit as `safeSubset.js`: it rebuilds the stored
  object from a whitelist, drops markup/`javascript:` URLs/free-form hex/unknown keys and **reports what
  it dropped**. Angle brackets are stripped from name + blurb as well as escaped at render. `customer.slug`
  (auto-derived, deduped) gives each organisation `/o/<slug>`.
- **Per-map public listing** (`map.public_listed`, `PATCH /api/maps/:id/public`, the editor's **Public
  page** panel) — the customer's own switch, independent of the publish gate: un-listing takes the page,
  its files and the gallery entry down **without** touching the signed-off version or its pointer, and
  re-listing restores them.
- **Map feedback** (`message.map_id`) — the public form writes into P0's existing `message` table with the
  map attached; the admin **Messages** tab gained an **About** column linking to that map's public page.
- **`/legal.html`** — what we hold and why (application, messages, account, essential cookie, rate-limit
  logs, governance audit), what we don't do (no tracking, no profiling, no payment data, no personal data
  on public pages), retention + how to ask for a copy or deletion, the BODS/OSM licences, how the sheets
  may be reused, and the Apache-2.0 code. **Marked a working draft** — it needs a final read before the
  service opens publicly.
- **`robots.txt`** (allows the public pages, disallows `/app`, `/api/`, `/auth/`) and a live
  **`sitemap.xml`** built from the static pages + every publicly-visible map and organisation
  (`PUBLIC_BASE_URL` overrides the host when running behind a proxy).
- **`scripts/test-p6.mjs`** (`npm test` / `npm run test:p6`) — the branding whitelist against a hostile
  payload, the SQL gate on a synthetic DB (draft / un-listed / archived / suspended-org maps all
  unreachable), slug derivation + de-duplication, and **both** migration paths: a fresh DB and a
  **pre-P6 DB** opened in a child process (columns added, existing customers back-filled with slugs,
  existing maps default to listed).

### Changed
- Public pages carry a **Published maps** nav link and a **Privacy & licensing** footer link; the FAQ
  answers "Does our map get a public web page?"; `examples.html` now points at the live gallery first.
- `/api/me` and `/api/maps` carry the organisation's public identity and each map's `publicUrl`; the
  dashboard shows a **Public page** pill; `/api/admin/customers` carries the branding + public page link;
  `/api/admin/summary` and `/health` count public maps and organisations.
- Public output labels are **kind-aware** (`publicLabel()` — "Buses serving this place" vs "Buses within
  the area"); the editor keeps `OUTPUTS`' own labels, which are written for the person editing.
- `.org-badge` accents are **lifted in dark mode** — the fixed palette is chosen for light backgrounds, so
  a deep green or red badge would otherwise sit too close to the dark surface.
- Version → `0.7.0-P6`.

### Verified
- Both byte-identical render gates still **PASS** (`npm run verify`: area 471,569/1,172,380/33,768/987,563
  and the place fixture 60,014/10,068) — P6 touches no render path.
- End-to-end on an isolated scratch server + a **copy of the real pre-P6 demo DB**: the migration
  back-filled slugs, `seed-demo` published both an area (March) and a **place** (Simpson Centre) map, and
  the gallery, map pages, organisation page, feedback, sitemap and robots all behaved. Branding saved
  through the UI and reached the public page; a hostile PATCH was reduced to its one legal field with the
  rest reported as rejected. Un-listing 404'd the page **and** its files and dropped it from the gallery
  and sitemap; re-listing restored them. A draft-only map (St Ives) is 404 on its page **and** its files.
  Tenant isolation holds on the new endpoints (March's map → 403 for another customer's editor); anonymous
  → 401 on branding/listing while the public API stays open; a platform account → 400 on branding.
  Mobile + dark checked (no horizontal scroll); zero console errors; `npm test` green.

### Notes / lessons
- **Publish ≠ public.** Two independent switches: the platform's sign-off (P4) decides whether a version
  is *official*; the customer's listing decides whether it is *shown*. Keeping them apart means a takedown
  is one tick and never rewrites a signed-off record, and it stops the publish gate doubling as a CMS.
- **Ask the public query, don't infer.** The editor's "you are live" link is computed with
  `getPublicMapBySlug()` — the very query the public site runs — rather than by re-deriving
  "published && listed" in the app layer. That way a suspension or a future condition shows through
  everywhere at once and the UI can't claim a page exists when it doesn't.
- **Derive the web-sized image, never re-render it.** Making a screen copy at *render* time would have
  added artefacts to every version (and a reason to re-run renders); deriving it lazily from the published
  print JPG keeps the byte-identical guarantee and retro-fits every earlier version.
- **A whitelist beats an escape.** Branding is user content on a public page, so it is validated on the
  way in (fixed accents, parsed URLs, markup rejected) *and* escaped on the way out. Two independent
  failures would be needed to put markup on a page.
- **The 404 must be a real 404.** A pretty-URL SPA shell that always returns 200 hides taken-down maps
  from search engines and tells a prober that a slug exists; checking the slug in the route handler (and
  making `/o/:slug` apply the *same* condition as its API, not just "customer exists") keeps the page and
  its data from ever disagreeing.
- **No contact details in branding, on purpose.** An organisation's public page carries no email or phone;
  feedback comes through our own form. Nothing personal becomes scrapeable by adding a public front.

## [0.6.0-place] — 2026-07-25

**Place maps now render in the portal** (previously area-only). This closes the standing "place-map
engine not vendored" follow-up: **place** maps (`make-place-bus-leaflet`) can now be imported, edited
with the safe subset, versioned, published and monthly-refreshed exactly like **area** maps — the same
deterministic, byte-identical guarantees. It is orthogonal to the P6/P7 roadmap (marketing / expert
editor), so it is tagged `place` rather than a phase number.

Why it was needed: area maps carry their generators *per-map* (staged from the town render dir), but the
place skill keeps one engine in the skill and never copies it into a place's render folder — so a staged
place payload has the `*.json` inputs but no generators, and the importer/refresh refused it.

### Added
- **Vendored place engine** (`engine/place/`) — the one place in the repo where generators *are* vendored,
  because place render dirs carry none. Three files, copied into each place map's `data/` at import:
  `gen_internal.js` (the **same** town generator area maps use — road-following via `internalRoads` +
  `roads_geo.json`/`routes_paths.json`, all baked into the payload → no network), `gen_external_places.js`
  (the aggregated-destination external radial; already honours top-level `routeColors`), and a new thin
  wrapper **`gen_internal_place.js`** that runs `gen_internal.js` then supplies the two things it can't
  express for a place — the **title** ("Buses serving <place>") and the **version stamp** (strips the
  place convention's leading `v` so `version:"v1.0"` renders `Map v1.0`, not `vv1.0`). No network, no
  `overrides.json` mutation. See `engine/place/README.md`.
- **Base-overrides layer** (`src/maps/store.js` `base-overrides.json` / `src/maps/engine.js`
  `readBaseOverrides` + `mergeOverrides`) — a place's *expert framing* (river-hide, a frozen viewport)
  ships as a small `overrides.json`; that is **not** a customer edit, so the importer stores it as the
  map's `data/base-overrides.json` and the render path merges it **under** the customer's safe-subset
  overrides (customer wins). Area maps have no base ⇒ the merge is a proven no-op (St Ives/March stay
  byte-identical).
- **`scripts/verify-reproduce-place.mjs`** + `npm run verify:place` (and `verify` now runs area **and**
  place) — proves the vendored place engine reproduces a skill-rendered place leaflet **byte-for-byte**
  (SVG identical, JPG pixel-identical), including the merged base framing. Point `PLACE_FIXTURE_DIR` at a
  place fixture (self-consistent payload + reference renders). Verified on **Beaconsfield Simpson Centre**
  (road-following + river-hide framing): internal 60,014 B / external 10,068 B, both byte-identical.
- **A built place map in the demo** (`scripts/seed-demo.mjs`) — Beaconsfield Simpson Centre, owned by a
  new demo org, with a **place monthly-refresh** staged alongside March's, so the accept flow is demoable
  for a place too.

### Changed
- **Generator resolution by candidate list** (`src/maps/store.js` `OUTPUTS[*].gens`,
  `src/maps/engine.js` `resolveGen`) — an output now lists generator candidates and uses the first
  **present** in a map's data folder. So one `internal`/`external` output serves both kinds: an area map
  resolves `gen_internal.js`/`gen_external.js`, a place map resolves `gen_internal_place.js`/
  `gen_external_places.js`. The UI/toggle model is unchanged (still four outputs).
- **`scripts/import-map.mjs`** — `--kind place` no longer fails fast. It validates a place payload
  (`routes.json` + `place.json`), vendors the place engine into `data/`, and splits any framing into
  `base-overrides.json` (accepts either `overrides.json` from a fresh skill payload or a pre-split
  `base-overrides.json`).
- **`scripts/propose-update.mjs`** — accepts place maps (detected by the map's `kind`): stages the
  vendored place engine + framing, same as the importer. The P5 accept/decline/preview server routes
  needed **no** changes — they were already data-driven (they read palette/POIs from the staged dir and
  `renderVersion` reads `base-overrides.json` from it), so re-applying a customer's overrides onto a
  refreshed place, preserving its framing, and keeping the published pointer put all work unchanged.
- **`src/refresh/index.js`** — the stop-count diff falls back to `routes_intown_atco.json` (a place's
  drawn/walkshed stops, same flat-array shape) when `routes_atco.json` is absent, so per-route stop
  changes show for places too. (A place's `routes_full_atco.json` is intentionally not used — its values
  are `{directions,canonical,all}` objects, not flat arrays.)

### Notes / lessons
- **Worked-example place payloads had drifted** — some shipped SVGs were rendered from an earlier
  `routes.json` and the config was hand-edited afterwards (Waitrose: a since-removed `mapNotes`, a longer
  `placeTitle`, a nudged rail label). So the gate proves **portal-engine ≡ skill-engine on the same
  payload** (rendering a fresh, self-consistent reference), which is what P0 always did — not
  "byte-identical to a possibly-stale historical file".
- **Expert framing must reach the generator via `OVERRIDES_FILE`, not `data/overrides.json`.** The portal
  always passes `OVERRIDES_FILE`, and `gen_internal` then ignores `data/overrides.json` — so the place
  skill's build-time trick of writing river-hide into `data/overrides.json` would be silently dropped.
  Hence the base-overrides layer, merged into the temp overrides file the portal writes.
- **The internal "Map vX.X" stamp is the DATA version** (from `routes.json`), not the portal edit-version
  — identical behaviour to area maps (a v1.1 recolour still stamps the data version). Not a bug.

## [0.5.0-P5] — 2026-07-24

Phase **P5** — **monthly change acceptance.** *The recurring product.* The central pipeline (run
expertly, elsewhere) restages a map's data each month and offers it as a **proposed update**. The
customer reviews a plain-language **change summary** and an **old-vs-new preview**, then **Accepts**
(their colours + landmark choices are **re-applied** onto the fresh data as a new **major** version — a
draft that still goes through the P4 publish gate) or **Declines** (the map keeps its current data). Only
the review + accept live in the portal; the data fetch/judgement stays central.

### Added
- **`proposed_update` table** (`schema.sql`) — a staged monthly refresh awaiting accept/decline
  (`data_dir` = git-ignored staged payload, `summary_json` = the data diff, status
  `pending`→`accepted`/`declined`/`superseded`, `accepted_version_id` = the version accept created). It is
  a *new* table, so `CREATE IF NOT EXISTS` covers a pre-P5 DB — no ALTER needed (migration idempotency
  unit-tested by dropping + reopening).
- **The data diff** (`src/refresh/index.js`) — `diffRouteData()` is **pure** (over parsed objects) and
  reports the *service facts* that changed: routes **added/withdrawn** (palette), a route's destination
  **reworded** (`internalDesc`/`serviceDesc`), **stops added/removed per route** (`routes_atco.json`,
  counts), **operators** added/removed, and **timetable validity** moved on (`validFrom`/`version`).
  Geometry is deliberately not diffed — it is not a fact the customer signs off, and it changes every
  refresh. `dataChangeSummary()` is the file-reading wrapper.
- **`scripts/propose-update.mjs`** — the **central-pipeline entry point** (mirrors `import-map.mjs`):
  `--map <slug|id> --src <fresh render dir> [--note]`. Validates the portal generators, **supersedes** any
  still-pending refresh for that map, stages the payload under `maps/<id>/proposed/<pid>/data`, computes
  the diff, and stores it. It never touches the live map and never renders (the diff is JSON-only).
- **Server routes** (`src/server.js`, tenant-scoped by `loadOwnedMap`): `POST …/proposed/:pid/preview`
  (renders **both** the live data and the staged data with the customer's overrides re-applied — orphaned
  ones dropped — for a true side-by-side), `POST …/proposed/:pid/accept`, and `POST …/proposed/:pid/decline`.
  `mapDetail` surfaces the pending update + `refreshHistory`; the maps list carries `pendingUpdate`;
  admins get a read-only `GET /api/admin/proposed-updates` queue + summary count.
- **Accept, done safely** (`renderVersion` gained an optional `srcDataDir`; `swapInProposedData()` in
  `engine.js`): accept **renders the new `vN.0` from the staged data first**, and only if that succeeds
  swaps the staged data into the live slot (archiving the outgoing data under `maps/<id>/archive/`, never
  deleting) and records the new **draft** head. A render failure leaves the live map completely untouched.
  The **published pointer does not move** — the refreshed version is a draft that must be signed off (P4)
  before it goes public, so the public map keeps serving the old, already-approved files until then.
- **Overrides re-applied, orphans dropped**: accept re-sanitises the customer's saved overrides against
  the **new** data's palette + POI keys (`sanitizeOverrides`), so a recolour/POI-hide survives the refresh
  **if that route/landmark still exists**, and is silently dropped (and reported) if the refresh removed
  it.
- **Editor UI** (`editor.html`/`editor.js` + `app.css`): a prominent **"A monthly update is ready"**
  banner with the change summary and **Preview changes** / **Accept update** / **Decline**; a full-width
  **old-vs-new compare dialog** (current vs after, per output, live SVGs). Accept/decline flash a one-shot
  message across the reload. The dashboard shows an **"Update ready"** pill; the admin console gains a
  read-only **Refreshes** tab + badge, and the audit trail labels `refresh.accept` / `refresh.decline`.
- **Demo seed** now stages a demo refresh for **March** (a lightly-mutated copy of its own data — new
  validity, one reworded description, one dropped stop) so the accept/decline flow is demoable out of the
  box on a published map.

### Verified (end-to-end, isolated scratch server + demo seed, in-app browser)
- **Panel + preview**: the update panel shows the correct summary (1 description reworded, `33A` −1 stop,
  validity June→August 2026); the old-vs-new preview renders **both** internal + external live, and the
  "after" SVGs differ from "before" (the refresh is genuinely visible).
- **Accept**: March **v1.0 → v2.0** (major bump), head `draft`, **`published_version_id` stayed `v1.0`**,
  proposed update consumed, refresh history recorded, flash shown. On disk: **v1.0 stayed byte-identical**
  (255,878 / 910,694 / 16,088 / 563,548 B — P0 guarantee survives), v2.0 rendered from the **new** data,
  and the outgoing data landed in `archive/proposed-1-prev/` (validFrom June, vs live August).
- **Re-apply**: after recolouring route `33A` (v2.1), accepting a second refresh produced **v3.0** whose
  `overrides.json` **still carried `routeColors["33A"]`** — the customisation survived the data refresh.
- **Guards**: re-accepting a decided update → **409**; accepting **while a publish sign-off is pending**
  (St Ives) → **409** with a clear "withdraw first" message; **decline** is allowed regardless and left
  St Ives's data **unchanged** (validFrom still June, no `archive/` created).
- **Isolation**: the March editor got **403** on all three of St Ives's `…/proposed/…` endpoints.
- **Admin + audit**: the **Refreshes** tab + badge render the pending queue; the audit trail shows both
  accepts (with change summaries) and the decline, correctly attributed to each customer's editor.
- **Migration idempotency** and the **pure `diffRouteData`** unit tests both green; **zero console errors**.

### Lessons learned
- **Diff the facts, not the pixels.** Every refresh changes geometry (stop coordinates, road/river paths),
  so diffing the rendered output or the raw inputs wholesale would flag "everything changed" every month
  and train customers to rubber-stamp. Diffing only the *service facts* a customer actually signs off
  (routes, destinations, stop membership, operators, validity) makes the summary meaningful — and it stays
  **pure/deterministic**, so it is trustworthy evidence.
- **Render before you swap.** Accept renders `vN.0` from the *staged* data first and only swaps on success
  (`renderVersion(..., srcDataDir)` + `swapInProposedData`). Swapping first would, on a render failure,
  leave the live data ahead of the current version — a corrupt half-state. Rendering first makes accept
  effectively atomic.
- **A data refresh is a new draft, not a new publication.** Accepting must **not** move the public-current
  pointer: the refreshed version is unproven until a human signs it off. The two-pointer model from P4 (head
  vs published) is exactly what lets the public map keep serving the last approved files while the customer
  prepares the new one. Accept's version note carries the change summary so the P4 approver — whose
  overrides-diff would otherwise read "unchanged" — sees that the *data* moved.
- **Re-applying overrides is just re-sanitising against the new universe.** Because the safe subset is
  small and validated against the live palette/POI keys, "re-apply the customer's edits onto next month's
  data" is precisely `sanitizeOverrides(saved, { palette:new, poiKeys:new })` — survivors kept, orphans
  dropped and reported. No special migration logic; the P1 boundary does the work again.
- **Archive, never delete.** The outgoing data moves to `archive/` on accept. It costs a little disk but
  means an accepted refresh is reversible and auditable; declined staged data is likewise retained. (A
  cleanup/retention job is a future ops task, noted as a follow-up.)
- **Swapping a map's data must invalidate the memoised POI list.** `enumeratePois(id)` is cached by map id
  for the process lifetime (enumerating runs a generator). After a data swap the drawn-POI universe can
  change, so `swapInProposedData()` calls `invalidatePoiCache(id)` — otherwise the editor would offer the
  *old* map's landmark toggles against the new data. The importer dodged this by running in a separate
  process; in-process accept does not, so the cache must be dropped explicitly.
- **One writer.** Staging a refresh (`propose-update.mjs`) writes the shared SQLite, so the dev server must
  be stopped first — same single-writer rule as the importer/seed (verification stopped the scratch server
  to stage, then restarted).

## [0.4.0-P4] — 2026-07-23

Phase **P4** — **the publish gate.** A rendered map version is now a private **draft** until a platform
**approver** signs it off with recorded **red-team evidence**; publishing advances the map's
**public-current pointer** and writes an **append-only audit trail**. This closes the third and final
approval gate (organisation → map-request → **publish**). The editor who makes the change never
publishes it — separation of duties.

### Added
- **Version review states + the public-current pointer** (`schema.sql`, migrated): `map_version` gains
  `review_state` (`draft`→`pending`→`published`→`superseded`/`rejected`); `map` gains
  `published_version_id` — the one **official** version, distinct from `current_version_id` (the working
  head). A guarded migration adds both to a pre-P4 DB (unit-tested on a synthetic P3-shape DB).
- **Publish requests + red-team evidence** (`publish_request` table, `src/publish/index.js`): an editor
  **submits the current head** for sign-off. Two pieces of evidence back the decision — a **deterministic
  `changeSummary()`** (because the safe subset only permits route recolours + POI show/hide, the diff of
  the submitted version vs the currently-published one is *complete*: the approver sees exactly what
  changed and can be sure nothing else did) and a fixed **sign-off checklist** (`CHECKLIST`, five transit-
  safety confirmations). `validateChecklist()` enforces completeness **on the server** — a map cannot be
  published without every item confirmed. The evidence (checklist answers + change-summary snapshot +
  notes + who/when) is stored on the request.
- **Review console** (`/app/review`, `public/app/review.html` + `review.js`; approver/admin only — the
  page redirects others and `requireApprover` re-checks the role on every `/api/review/*` route): a queue
  of pending submissions; open one to see the change summary, **inspect the print-ready JPGs inline**,
  complete the checklist, and **Publish** (advances the pointer, retires the previous published version to
  `superseded`, sets the map `published`) or **Send back** (requires a reason; returns the version to
  `rejected` so the editor can revise + resubmit).
- **Editor publish panel** (`editor.html` + `editor.js`): shows the draft/published state, a live
  "what publishing will change" summary, **Submit for publication**, and **Withdraw**. Editing is
  **frozen while a request is pending** (server returns 409 on save; the controls disable) so the version
  an approver reviews is always the head. Published (official) files are surfaced distinctly from the
  working draft.
- **Append-only audit log** (`audit_log` table, `src/audit/index.js`): every governance action —
  `version.submit` / `publish` / `reject` / `withdraw` / `save`, plus the retrofitted P3 actions
  (`application.approve`/`reject`, `maprequest.approve`/`reject`, `customer.update`) — records who, what,
  when, and against which map/version. New admin **Audit** tab (`/api/admin/audit`, admin-only) renders it
  newest-first with friendly labels.
- **Roles activated**: the P2 `approver` role now has powers — a platform reviewer who can read/inspect
  and publish **any** map's submitted version but cannot edit it (`loadReadableMap` vs `loadOwnedMap`).
  A **Review** nav link appears for approvers + admins.
- **Demo seed** now also creates a platform **approver** (`approver@busmaps.example`),
  **publishes March v1.0** as a first official version, and renders a real **St Ives v1.1** (route 9
  recolour) **submitted for sign-off** — so the review queue, a published map and the audit trail are all
  non-empty on first run.

### Verified (end-to-end, fresh scratch server + demo seed, in-app browser)
- **Sign-off gate**: approving with an **incomplete checklist → 400** (server lists the missing items);
  the UI **Publish** button stays disabled until all 5 boxes are ticked (disabled at 4/5, enabled at 5/5).
  Rejecting with **no reason → 400**.
- **Publish + supersede**: approving St Ives **v1.1** set `published_version_id`, map `published`, and the
  official pointer; then editing → save **v1.2** → submit → approving **v1.2** left versions as
  **`v1.2:published, v1.1:superseded, v1.0:draft`** and advanced the pointer. Publishing never re-renders:
  the **v1.0 baseline stayed byte-identical** (471,569 / 1,172,380 / 33,768 / 987,563 B).
- **Editing lock**: while a request is pending the editor is locked (controls disabled, state
  "Locked for review") and a direct `POST /save` returns **409**; **Withdraw** returns it to draft and
  re-enables editing.
- **Separation of duties / isolation**: the **approver** got **403** on save/preview/publish-request
  (can't edit) and on `/api/admin/*` (not admin), but **200** on read-detail + version-file download (to
  inspect). The **editor** got **403** on another customer's map (isolation intact from P2).
- **Audit**: all nine actions recorded with correct actor attribution (editor submit/withdraw; approver +
  admin publishes) and rendered in the admin **Audit** tab. No console errors on any app page.
- **Pure-logic unit tests** (`changeSummary` + `validateChecklist`) and the **migration** test both green.

### Lessons learned
- **The change summary is only "complete" because the safe subset is small.** P4 leans on P1's boundary:
  since a customer can *only* recolour routes and hide/show POIs, a diff of two versions' overrides is an
  exhaustive account of what changed — there is no hidden geometry edit to miss. That is what lets a human
  sign off with confidence, and why the evidence can be generated deterministically rather than re-derived.
- **Two pointers, not one.** `current_version_id` (working head, moves on every save) and
  `published_version_id` (the official/public version, moves only on sign-off) must be separate. Reusing
  one would either publish drafts automatically or freeze editing after the first publish.
- **Freeze editing while pending, don't chase a moving head.** Allowing saves during review would let the
  head advance past the version under review (stale sign-off). Blocking `save` with a 409 while a request
  is open keeps "the head" and "the submitted version" identical, so the state machine stays a simple
  draft ↔ pending ↔ published loop. Withdraw is the escape hatch.
- **Separate read-scope from edit-scope.** Approvers must fetch *any* submitted map's rendered files to
  eyeball them, but must never edit — so `loadReadableMap` (admin/owner/**approver**) guards GET detail +
  downloads while `loadOwnedMap` (admin/owner) still guards preview/save/submit. One shared loader would
  have leaked edit access to reviewers.
- **`confirm()`/`requestSubmit()` are unavailable in the in-app browser** (seen again from P3): tests
  override `window.confirm = () => true` and click handlers directly; the checklist→enable wiring is
  driven by dispatching `change` events, as in prior phases.
- **Audit writes must never break the action.** `logAudit` swallows its own errors (logging a warning) so
  a bad audit insert can't fail a publish — the audit is a record of the action, not a precondition for it.

## [0.3.0-P3] — 2026-07-23

Phase **P3** — **onboarding + governance.** The public *apply* form from P0 now has the other half:
an admin reviews applications, approves one into a **customer + its first editor + a passwordless
invite**, and customers **request maps within a quota** that an admin approves or rejects. This closes
the first two of the three approval gates (organisation, map-request); the publish gate remains P4.

### Added
- **Admin console** (`/app/admin`, `public/app/admin.html` + `admin.js`) — admin-only (redirects
  non-admins; every `/api/admin/*` route re-checks the role). Four tabs with live count badges:
  - **Applications** — review the queue; **Approve** opens a dialog (editable area/place quota +
    editor name) that creates the `customer`, its first `editor` user, links the application to the
    customer, and issues a **passwordless invite** (printed to the server console; the link is also
    surfaced in the UI in dev so the whole loop is demoable without email). **Reject** marks it rejected.
  - **Map requests** — the pending-request queue; **Approve** accepts it (→ `approved`, queued for the
    central build) or **Reject** archives it (freeing the quota slot).
  - **Customers** — every customer with user count + live area/place usage, and **inline editing** of
    quotas, status, and the dormant `plan`.
  - **Messages** — read-only view of the P0 contact `message` table (previously write-only).
- **Customer map requests + quota** — the dashboard shows a **quota bar** (used / allowed per kind) and
  a **Request a map** dialog (area or place, name, subject, note). `POST /api/maps/request` enforces the
  quota **server-side** (a requested/approved/built map counts; archived does not) and creates the map in
  status `requested` with no object store yet. `GET /api/me` now returns quota usage.
- **Map lifecycle states surfaced** — non-editable maps (`requested` / `approved` / `building`) render
  as **status pills** on the dashboard instead of editor links, and opening one shows a friendly
  **"being prepared"** panel rather than empty controls. Editable maps (a rendered version exists) are
  unchanged.
- **Schema (additive + migrated)** — `application` gains `reviewed_at` + `customer_id` (the customer it
  became); `map` gains `request_note` + `requested_by`, and `data_dir` now defaults to `''` (a requested
  map has no store yet). A guarded migration adds all four columns to a pre-P3 DB, existing rows intact.
- **Demo seed** now also plants a **pending application** (Ramsey Town Council) and a **requested map**
  (St Ives Waitrose) so the approval and request queues are non-empty on first run. Idempotent.

### Verified (end-to-end, fresh server + demo seed, in-app browser)
- **Approve flow**: approving Ramsey with a custom **1 area / 2 place** quota created customer #3 + editor
  `clerk@ramsey-tc.example`, linked the application (`status=approved`, `customer_id=3`), surfaced the
  invite link, and dropped the pending count 1 → 0.
- **Map-request lifecycle**: the seeded St Ives Waitrose request approved → left the queue (`approved`).
- **Quota enforcement**: as the St Ives editor (area 1/1, place 1/4) an **area** request was **blocked**
  ("Your plan includes 1 area map and you already have 1"); a **place** request succeeded, incremented
  the bar to 2/4, and appeared as a *Requested* card.
- **Customers tab**: inline-editing St Ives's place quota 3 → 4 persisted.
- **Editor guard**: opening the approved-but-unbuilt map showed "Not built yet / being prepared", no
  controls.
- **Isolation intact (P2)**: the editor saw only its own maps; March (`/api/maps/2`) and every
  `/api/admin/*` route returned **403**. The admin saw all customers and both councils' maps.
- **Baselines still byte-identical**: St Ives + March re-imported and rendered v1.0 identical to the
  shipped figures (St Ives internal 471,569 B SVG / 1,172,380 B JPG). The built-map editor still loads
  (9 routes, 34 POIs, live preview, both output tabs).
- **Migration**: a synthetic pre-P3 DB gained all four columns on boot with its rows preserved; the P3
  DB helpers (quota, lifecycle, application review, customer admin, summary) unit-tested green.

### Lessons learned
- **Quota is server-enforced, and counts the right rows.** The check lives in `POST /api/maps/request`
  (never the client), and `quotaUsage` counts every non-`archived` map of a kind — so a *pending request*
  already consumes a slot (no request spam) and **rejecting frees it** (reject → `archived`). Draft,
  approved and building all count; only archived is free.
- **A requested map has no object store.** It's a DB row with `data_dir=''` and no version, so anything
  that reads the store (`readRoutesMeta`, `enumeratePois`, downloads) must no-op gracefully — they do
  (empty fallbacks), but the dashboard/editor gate on **"has a current version"** to decide editable vs
  "being prepared" rather than trusting status alone.
- **The invite is just a magic link.** Approval reuses `requestMagicLink` against the freshly-created
  active user — no separate invite token type. In dev the link is both logged and returned in the API
  response (gated on `EMAIL_PROVIDER` being unset); with a provider set it is only emailed.
- **`user.email` is UNIQUE**, so approval must refuse when the contact email already has an account
  (409) rather than let the insert throw — the one real edge in the approve path.
- **`<dialog>` needs no framework.** Both the request and approve modals are native `<dialog>` +
  `showModal()`; submitting programmatically in a test uses `dispatchEvent(new Event('submit'))`
  (`requestSubmit()` was not available in the in-app browser).
- **The place map request is lifecycle-only.** Approving St Ives Waitrose (a place) proves the request
  gate, but places still can't be *built* in the portal until the place engine is vendored (the standing
  P2 follow-up) — the two are independent.

## [0.2.0-P2] — 2026-07-23

Phase **P2** — **multi-customer, authenticated, isolated.** The editor spine from P1 becomes a real
two-sided service: organisations sign in passwordlessly, see only their own maps, and choose which
outputs each map produces. This is the demo cut (P0+P1+P2): an org logs in, opens its map, recolours a
route, re-renders, downloads — with every other org's data invisible and inaccessible.

### Added
- **Data model** (`schema.sql` + `src/db/index.js`): `customer` (type, status, dormant plan + quotas,
  branding), `user` (belongs to a customer; role editor/approver/admin; admins have no customer),
  `session` (opaque server-side token), `magic_link` (single-use, 15-min). `map` gains `customer_id`
  (owner) and `outputs` (which of the four outputs it produces). A guarded **migration** adds the two
  `map` columns to a pre-P2 DB without touching existing rows (verified on a synthetic P1 DB).
- **Passwordless magic-link auth** (`src/auth/index.js`, no new deps): request a link → it's printed to
  the **server console** in dev (a real email provider is a launch task) → `/auth/verify` consumes it and
  sets an **httpOnly, SameSite=Lax session cookie** holding only an opaque random token. Login/logout,
  `GET /api/me`, and a periodic expired-session purge.
- **Tenant isolation** — every `/api/maps*` route requires a session and is scoped by `customer_id`:
  non-admins can only list/open/preview/save/download/toggle **their own** maps; admins see all. Enforced
  server-side on every access vector (detail, preview, save, download, output PATCH).
- **Output toggles** (`src/maps/store.js` `OUTPUTS`, `PATCH /api/maps/:id/outputs`): a map's four outputs
  are modelled (geographic, external, octolinear schematic, tube-map diagram); the portal renders the two
  the vendored engine supports today and marks schematic/diagram "coming with expert styles". Preview,
  render and downloads all follow the enabled set; a map must keep ≥1 output on.
- **UI**: a login page; the dashboard + editor are auth-gated (redirect to login, user + sign-out in the
  header, admins get an "all maps" view labelled by customer); the editor gains an **Outputs** panel and
  builds its preview tabs dynamically from the enabled outputs.
- **Demo seed** (`scripts/seed-demo.mjs` + `import-map.mjs --customer`): sets up an admin, two demo
  councils each with an editor user, and imports their maps — a reproducible multi-tenant demo. Idempotent.

### Verified (end-to-end, fresh server + demo seed)
- **Isolation**: signed in as the St Ives editor, `/api/maps` returns only St Ives; March's detail,
  **preview and download all return 403**. Admin (Peter) sees both councils' maps and can open March.
- **Auth**: anon `/api/maps` → 401; magic-link request → console link → verify → session cookie → app;
  wrong/expired token → back to login with an error.
- **Output toggles**: turning external off persists and re-scopes preview/downloads; turning everything
  off is rejected (400); schematic/diagram show as unavailable.
- **Baselines still byte-identical**: St Ives and March both import + render v1.0 through the object store
  (St Ives all four artefacts identical to the shipped v6.6).
- **Migration**: a synthetic pre-P2 `map` table gains `customer_id`/`outputs` on boot, existing row intact.

### Lessons learned
- **Place maps don't fit the object-store model yet.** Area maps carry their generators per-map
  (`gen_internal.js`/`gen_external.js`), which the portal vendors — that's why St Ives/March "just work".
  **Place maps** (`make-place-bus-leaflet`) keep their *different* engine in the skill, not per-map, so a
  place render dir carries **no generators**; importing one produced an unrenderable map. The importer now
  **fails fast** when no portal generator is present, and the demo is area-maps-only until the place engine
  is vendored (its own follow-up, analogous to P1 for places).
- **SQLite datetime format matters for session expiry.** `datetime('now')` is `YYYY-MM-DD HH:MM:SS`;
  storing an ISO string (`…T…Z`) breaks the `expires_at > datetime('now')` string comparison (the `T`
  sorts after a space). Store expiries via `toISOString().slice(0,19).replace('T',' ')`.
- **`node:sqlite` enforces foreign keys** (seen again): deleting `map` while `map.current_version_id`
  points at a `map_version` fails; the demo re-seed wipes the DB file instead of DELETEing in-place.
- **No new deps for auth.** Cookies are hand-rolled and the session token is an opaque server-side key, so
  there's nothing to sign — `node:crypto` + a `session` table is enough. SameSite=Lax covers cross-site
  POST; a dedicated CSRF token is a later hardening item.
- **One SQLite writer.** The seed/import scripts and the dev server share `portal.sqlite`; run seeds with
  the server stopped (P2 has no job queue yet — that's P5's territory).

## [0.1.0-P1] — 2026-07-23

Phase **P1** — the **editor spine**. The bus-leaflet editor is re-homed behind the app as a
**server-enforced safe-subset editor**: an approved organisation opens a map, recolours a route or
shows/hides a landmark, previews the real render live, then **saves a numbered version** and
**downloads print-ready files** — end to end, no localhost tool, no AI.

### Added
- **Object store** (`src/maps/store.js`) — per-map folders under `DATA_DIR` (git-ignored):
  `maps/<id>/data/` (the map's generators + JSON inputs), `overrides.json` (canonical saved edits),
  `renders/v<maj>.<min>/` (four artefacts + `meta.json`). No `localhost:5179`, nothing in git.
- **Safe-subset gate** (`src/maps/safeSubset.js`) — the security boundary. Rebuilds overrides from
  scratch, keeping **only** `routeColors[route]` (recolour) and `internal.pois[key].hide` (toggle),
  validated against the map's palette + known POI keys; **everything expert-only (stops, align,
  rotation, viewport, panel, features, external layout, POI moves/labels) is dropped** no matter what
  the client sends. No-ops (a colour equal to the default, a visible POI) drop too, so an untouched
  map serialises to `{}` and stays byte-identical to baseline.
- **Engine wrapper** (`src/maps/engine.js`) — enumerate the editable routes + POIs (POIs read from a
  one-off `EDITOR_KEYS=1` render, so the toggle keys match exactly what the generator draws),
  `preview()` (SVGs only, nothing persisted), and `renderVersion()` (writes the version's SVG + print
  JPG, then commits the canonical `overrides.json`).
- **Map + version schema** (`map`, `map_version` in `schema.sql`; helpers in `src/db/index.js`) —
  versions are append-only (nothing deleted); shaped so P2's `customer_id` / auth / output-toggles
  grow in without a rewrite.
- **Editor API + UI** — `GET /api/maps`, `GET /api/maps/:id`, `POST …/preview`, `POST …/save`,
  `GET …/versions/:key/:file` (whitelisted `v<maj>.<min>` + known filenames; `?download` sets
  `Content-Disposition`). Served at `/app` (dashboard) and `/app/maps/:id` (the two-pane editor:
  colour pickers + grouped POI toggles on the left; live internal/external preview, save-note and
  print-ready downloads on the right; light/dark, responsive).
- **Importer** (`scripts/import-map.mjs`) — seeds one map from a staged Buses run dir and renders the
  baseline as **v1.0 with empty overrides** (i.e. byte-identical to the shipped leaflet). The minimal
  P1 seed; P2 generalises it to the multi-customer importer.
- `renderMap.generateSvg` gained an opt-in `editorKeys` flag (off by default → the P0 byte-identical
  baseline is untouched).

### Verified
- **Full round-trip on a fresh server**: recolour route 9 + hide Waitrose → live preview through the
  *real* generator (Waitrose gone from the SVG, route 9 redrawn) → **Save → v1.1** rendered (SVG +
  300 dpi JPG × internal/external) → downloads with correct headers. `overrides.json` held exactly the
  sanitised safe subset and nothing else.
- **Baseline stays byte-identical.** v1.0 rendered through the object-store path is **SHA-256-identical**
  to the shipped St Ives v6.6 (all four artefacts), while v1.1 correctly diverges — the P0 guarantee
  survives P1.
- **Safe-subset gate** unit-tested with a hostile payload (stops/align/rotation/panel/external/unknown
  routes/invalid hex/unknown POIs) → all stripped, only the two valid edits survived.
- Path-traversal / bad-version / unknown-file download requests → `400`.

### Lessons learned (read these before extending the build)
- **The object store is *inside* a `type: module` repo, so the CommonJS generators break there.**
  P0's byte-identical test escaped this by copying fixtures to the system temp dir. In the real object
  store, Node walks up to the repo's `package.json` (`type: module`) and runs `gen_*.js` as ESM →
  *"require is not defined in ES module scope"*. Fix: `ensureMapDirs` drops a
  `{ "type": "commonjs" }` marker into each map's `data/` folder (same CommonJS-island trick as
  `engine/`). Any new object-store location that holds a generator needs this marker.
- **Enumerate POI keys from the generator, never reconstruct them.** The override key is the generator's
  *icon* category, not the raw `pois.json` `cat` (e.g. `shop:Waitrose`, **not** `Supermarket:Waitrose`).
  Rendering once with `EDITOR_KEYS=1` and reading the `data-key` tags guarantees the toggle keys match
  what the render actually looks up — reconstructing from `pois.json` would silently mismatch.
- **`node:sqlite` enforces foreign keys.** Wiping `map` + `map_version` fails with
  *FOREIGN KEY constraint failed* unless you `UPDATE map SET current_version_id = NULL` first (the map
  points at its current version). A silent `2>/dev/null` hid this and left the DB and object store
  inconsistent — order matters, and a real "delete map" needs a cascade.
- **One SQLite file, one writer.** The importer and the dev server both open `portal.sqlite`; running a
  CLI write while `npm run dev --watch` is up gives lock contention. For P1, run imports with the
  server stopped (P2's in-process job queue removes this). Also: `node --watch` hot-reloads on every
  save, which is why an already-running server can report new code — restart fresh before trusting a
  test.
- **Safe subset = server-enforced, not UI-hidden.** Hiding the drag controls is not enough; the gate
  runs on every preview and save so a hostile/buggy client can't smuggle a layout edit through.
- **Not yet in the safe subset (deferred within P1's remit):** *relabelling* routes/badges and editing
  the *Services-panel text* need a new **no-op-when-absent** override knob added to the generators (and
  re-gated on all towns) — real engine work, not wiring, so held back. Choosing **which outputs** a map
  produces is explicitly **P2** (typed maps + output toggles); P1 renders internal + external.

## [0.0.1-P0] — 2026-07-23

Phase **P0** of the Option-B build: public repo scaffold, the deterministic render wrapper
(proven byte-identical), and the public shopfront brought forward to show prospects early.

### Added
- Apache-2.0 `LICENSE` + `NOTICE` (OpenStreetMap/ODbL, BODS/OGL attribution).
- Strict `.gitignore` / `.gitattributes` — no map data, customer PII or secrets in git; config via env.
- Fastify server (`src/server.js`): `GET /health`, `POST /api/apply`, `POST /api/contact` into
  `node:sqlite`, with server-side validation, a spam honeypot, and a small per-IP rate limit.
- Public shopfront (`public/`): landing, examples gallery, apply, FAQ, contact — light/dark, responsive.
- `engine/` — vendored generic renderer (`render.js`, `icons.js`) as a CommonJS island.
- `src/render/renderMap.js` — runs a map's generator, then rasterises the SVG to a print-ready
  A4 300 dpi JPG with the same `sharp` parameters as the desktop pipeline.
- `scripts/verify-reproduce.mjs` — byte-identical reproduction test (`npm run verify`).
- `docs/ROADMAP.md` — the P0–P7 plan and the deterministic/central split.

### Verified
- **St Ives v6.6 reproduces BYTE-IDENTICAL** — SVG *and* 300 dpi JPG, internal *and* external
  (internal 471,569 B SVG / 1,172,380 B JPG; external 33,768 B / 987,563 B).
- Shopfront apply/contact tested end-to-end in-browser: rows persist, validation returns the right
  fields, the honeypot silently drops bots, no console errors.

### Lessons learned (read these before extending the build)
- **Module system.** The repo is `type: module`, but the vendored engine is CommonJS
  (`require` / `module.exports`). A scoped `engine/package.json` = `{ "type": "commonjs" }` makes
  `engine/` a CommonJS island; without it Node throws *"module is not defined in ES module scope"*.
- **SQLite choice.** Uses Node's built-in `node:sqlite` (Node 22+) rather than `better-sqlite3`, to
  avoid a native build on the bleeding-edge Node 24. The only native dependency is `sharp`.
- **Byte-identical contract.** Generators are env-driven: `LEAFLET_DIR` (data folder),
  `SKILL_ASSETS` (resolves `icons.js`), `OVERRIDES_FILE` (**absent/empty ⇒ byte-identical baseline**).
  So only generic `render.js` + `icons.js` are vendored; the per-map generators travel with the data.
- **Render parity depends on `sharp`/libvips.** libvips 8.17.3 reproduced the shipped JPGs exactly.
  Pin a compatible `sharp` in any deploy image to preserve byte-parity.
- **`icons.js` drift.** `engine/icons.js` is vendored from the `make-bus-leaflet` skill; if that skill's
  `icons.js` changes, re-vendor it or byte-identical reproduction can break.
- **cwd independence.** The data dir resolves from the module path, not `process.cwd()`, so the app runs
  the same wherever it's launched (the local preview launcher supplies no working directory).
- **GitHub auth.** A stale Git Credential Manager token can cause *"Password authentication is not
  supported"*; `git credential-manager erase` (for `host=github.com`) then re-auth fixes it.
