# Product

<!-- docstamp v1.4 | 2026-09-29 | sha=ce9a241e -->
**v1.4** · updated 29 September 2026

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two equally core audiences, two halves of one funnel:

- **Public visitors** — residents, passengers, and search/link traffic who land on the shopfront, browse the public gallery, view/download a published map, read its text-equivalent page, or submit a "something looks wrong" report. Also prospective organisations evaluating whether to apply.
- **Approved organisations** — town/parish council clerks first, then shops, businesses, schools, function organisers, the National Trust and similar. **Most are managed customers** (the default offer since 2026-09-25, buses-data OA-469): we build their map, agree it with them by email, and send each new version for their yes, so they never sign in and the portal emails them nothing — every message comes from a person. **Some ask for the editor**, and inside the app as **editors** they recolour routes, toggle landmarks, choose outputs, save versions, and request new maps within quota. A platform **approver** reviews every version's change summary and print-ready output against a checklist before it can publish. An **admin** reviews applications, approves organisations, works the map-request queue, and adjusts quotas.

## Product Purpose

Gives an approved organisation printable bus maps for a place they care about (a town/parish, or a single point like a shop or school), kept up to date, without their needing design or GIS skill or any time in an app — while every publish is reviewed by a human and every render is provably reproducible. For the organisation that wants it, the editor lets them tweak the map themselves.

## Positioning

**A managed service first, an editor second.** By default we build the map, agree it with the customer by email, publish it once they say yes, and send each refreshed version for their yes in the same way; the customer's only work is to answer *is it right?* The editor is offered to any customer who asks for it, and is never the first thing they meet. No price is named anywhere until one is set (buses-data OA-029).

Underneath both is one deterministic engine, not a mapping tool: given a map's prepared data + config + a customer's overrides, the renderer produces byte-identical SVG/JPG output every time — no AI, no external calls, no live-data drift at render time. An editor customer self-serves against that safe subset (recolour, relabel, toggle, re-render); everything upstream of it (fetching bus/map data, onboarding a new area, the monthly "what changed?" refresh) stays centrally expert-gated and arrives as a proposed update the customer accepts or declines. This split is what makes the editor safe, and it is also what lets us make a managed customer's changes quickly.

## Operating Context

- **Pilot, not live**: `PILOT_MODE` is on by default — every page carries a pilot banner, every rendered sheet a red "PILOT — SAMPLE MAP" band, `robots.txt` disallows all, seeded demo organisations show a Sample badge. The pilot has its first customer (September 2026); every other organisation and most maps in the system are seeded demo data or our own samples. Copy must never claim customers, uptime, response times, or a guaranteed refresh cadence.
- **Two map types, four possible outputs**: area maps (a whole town/parish/part of a larger town) and place maps (centred on one point). Outputs: internal geographic, internal schematic (octolinear, expert opt-in), internal diagram (tube-map style, admin-hand-pinned, request-only — **parked since 2026-09-10**, buses-data OA-297, so not offered today), and external (tube-map of reachable places).
- **Version + review lifecycle**: an editor's save creates a private draft version; submitting freezes editing and hands off to an approver; publishing sets the official public version and retires the previous one; every step is audited. The editor who makes a change never publishes it — a deliberate separation of duties.
- **Monthly data refresh**: a central pipeline stages a proposed update each month; the customer reviews a change summary + old-vs-new preview and accepts (re-applying their edits as a new draft) or declines.
- **Public page per published map**: sheets to view/download, the publishing organisation's branding, a "something looks wrong" feedback form, and an accessible text-equivalent page at `/m/<slug>/services` — listed in a public gallery.

## Capabilities and Constraints

- **Determinism contract**: same inputs → byte-identical output, always. No network calls and no AI at render time. Absent config falls back to previous behaviour. This must never be relaxed to make a gate pass.
- **Three server-enforced approval gates**: organisation approval, map request + quota, publish review. No path may bypass them; client-side checks are UX only, never security. Note publish ≠ public.
- **Generators are vendored per map** (`data/maps/<id>/data/`); editing the shared engine changes nothing for maps already generated.
- **Licensing**: **public repo** (since 2026-09-03 — source-available, not secret), Business Source License 1.1, converting to Apache-2.0 on 2030-08-09. Free for non-commercial/internal use; competing commercial use needs a separate licence.
- **Attribution is not optional**: OpenStreetMap (ODbL) and BODS (OGL) attribution must appear per `NOTICE`.
- **No secrets, customer data, or map data in git** — `data/` and `backups/` are gitignored; verify what `git add -A` actually staged before committing, in a repo with a public remote.
- Stack: Node + Fastify + `node:sqlite`, no template engine, no frontend framework. (Existing codebase — not an open stack decision.)

## Brand Commitments

- User-facing brand is **BusMaps.uk**; the repository name (`community-bus-maps`), `package.json` name, and `/healthz` service id deliberately stay unchanged and are never user-visible — anything a user sees says BusMaps.uk.

## Evidence on Hand

- Live seeded demo covers every UI state (empty dashboard, single-map, multi-map organisation; pending application; a requested map; two published maps with live public pages; a version submitted for review; pending monthly updates; branding; public feedback) — see `scripts/seed-demo.mjs` and the README quick-start.
- No real customer testimonials, logos, pricing, or usage numbers exist yet; none may be fabricated or implied while PILOT_MODE reflects reality.

## Product Principles

1. Managed comes first: a customer's default experience is an email with the sheets attached and one question, not a sign-in. The editor stays safe because the deterministic render tier and the expert-gated data tier are kept structurally separate — never blur that line for convenience.
2. A human reviews every publish; the workflow should make the reviewer's evidence (change summary, print-ready output, checklist) easy to inspect, not easy to rubber-stamp.
3. Public-facing copy and states must stay truthful to pilot reality — no implied customers, uptime, or cadence the system doesn't actually have.
4. One organisation, one set of maps, one clear owner per action (editor drafts, approver/admin publishes) — the separation of duties is a product guarantee, not an implementation detail.
5. Both audiences (public visitor and organisation staff) are served by the same underlying render guarantee: what a visitor sees published is exactly what was reviewed.

## Accessibility & Inclusion

- Primary self-serve audience is UK local government (town/parish councils), extending to public-facing organisations (schools, National Trust, etc.) — public-sector accessibility duties apply. Design and build to meet the **Public Sector Bodies (Websites and Mobile Applications) Accessibility Regulations 2018** (WCAG 2.1/2.2 AA) across both the self-serve app and the public shopfront/gallery/map pages, not just the pages a council itself operates — several customer organisations are themselves public bodies subject to the same duty, and the portal's own public pages should not fall below it either.
- The existing text-equivalent page per published map (`/m/<slug>/services`) is a deliberate accessible alternative to the printed/visual sheet — preserve and extend this pattern rather than treating the visual map as the only source of truth.
