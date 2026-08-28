# Runbook R5 — Marketing site, public front & messages

<!-- docstamp v1.3 | 2026-08-28 | sha=436959f9 -->
**v1.3** · updated 28 August 2026

**Serves:** maintaining the website · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** Keep the public site correct and current, and work the two message queues. The site has two halves: **static shopfront pages** you edit by hand, and a **live public front** that generates itself from published maps.

> **Pilot — the standing constraint on this runbook.** The site must not claim customers, uptime, response times or a guaranteed refresh cadence, because none exist yet. Wording that did ("maps **our customers** have published", "those are **live**, kept up to date", "we **will** get back to you", "**our team**", "always looks right") was removed once — don't let it back in. Seeded demo organisations must keep their **Sample** labelling. Any new page needs the `<script src="/js/site-banner.js" defer>` tag or it will silently be the one page with no pilot banner. See [`PILOT.md`](PILOT.md), and `faq.html#pilot` for the agreed wording.

## The static shopfront (`public/*.html`)

Plain HTML, edited directly, sharing one header/footer and `/css/styles.css`:

| Page | What it's for |
|---|---|
| `index.html` | the pitch / landing page |
| `examples.html` | a **fixed showcase** of sample maps (distinct from the live `/maps`) |
| `apply.html` | the Apply form → `application` (onboarding, R2) |
| `pricing.html` | what would be bought and how a price would be arrived at — **no figures on it**, and every claim in the future conditional |
| `faq.html` | public questions — keep current as features land |
| `contact.html` | the contact form → a `message` |
| `opportunity.html` | "Take this on" — the pitch to hand the system to a CIC. **Footer link only, deliberately not in the nav**; it is outreach, not part of the shopfront journey |
| `legal.html` | privacy & attribution (G2) |
| `terms.html` | the customer agreement (G3) |

> **Shared footers are duplicated per page** (static HTML, no shared include), so a new footer link must be added to every page by hand. The **Terms** link is now in all of them (added across the shopfront 2026-07-25) and **Take this on** likewise (2026-08-02) — follow the same pattern for any future footer link, and see the sitemap note below, which is the half that gets forgotten.

### Adding a gallery example

`examples.html` is a hand-curated showcase (not the live list). To add one:

1. Export the map's **internal** and **external** JPGs and **downscale** them for the web (the existing cards are `1400×990`), into `public/examples/` with clear names (e.g. `march-area-internal.jpg`).
2. Add an `<article class="card example">` block copying an existing one: the two `<img>`s, an `Area`/`Place` badge, a title, a one-line description, and the outputs line.
3. Keep the OSM + BODS **attribution** line in the footer (it's already there — don't remove it).

## The live public front (P6) — generates itself

`/maps` (gallery), `/m/<slug>` (a published map: sheets, downloads, org credit, **report a problem**), and `/o/<org-slug>` (an organisation's page) are built from the database — **you don't edit them**. A map appears there only when **all three** hold (enforced in SQL): it has a **published** version, its customer is **active**, and the customer has left it **listed**.

- **Publish ≠ public.** Publishing (R3) makes a version official; the customer's **listing** switch (`/app/maps/:id` → the public toggle) decides whether it shows. Either can be off.
- `robots.txt` is automatic, and `sitemap.xml` generates the **map and organisation** entries by itself from `PUBLIC_BASE_URL` (DEPLOY §2). The **static** pages are a hand-kept list — `STATIC_PAGES` in `src/server.js` — so **a new shopfront page needs adding there as well as to the footers**. `terms.html` sat in every footer and out of the sitemap for a week because that step was missed; the rule is that the two lists name the same pages.

## Per-customer branding (what customers control)

Customers brand their **public pages** (not the sheet) from `/app/branding`, via a **server-enforced whitelist** — only these, everything else is dropped: **publicName**, **website** (http/https only), **blurb**, **badge** (emoji or initials), and an **accent** from a fixed list (blue/teal/green/purple/red/amber/slate). No contact details are brandable — enquiries come back through "report a problem", so a customer's email is never scrapeable. You can set branding for a customer if they'd like help. Branding on the **printed sheet** is deliberately not offered (it would re-open the byte-identical render gate — expert work).

## The two message queues

Both write to the `message` table and surface **read-only** in `/app/admin` → **Messages**:

- **Contact** (`/api/contact`) — general enquiries from `contact.html` (kind `enquiry`).
- **Report a problem** (`/api/public/feedback`) — from a published map's public page (kind `feedback`), tagged with **which map**. Both are honeypot-protected and rate-limited.

**Working the queue** (there's no in-app reply yet — triage and act out-of-band):

1. Read new messages (the tab badge is the count).
2. **Map feedback** → check the map; pass anything actionable to the publishing organisation, and if a *published* map is actually wrong, treat it as an **incident** — [R6](R6-incident-response.md) — don't just reply. **Check it against the data before believing or dismissing it, and check the same field on every other row while you are there.** The first genuine report (Ramsey, 2026-08-28) named one wrong place on one route; resolving all 253 stops on all eight routes turned it into four defects. A reporter can only see what is wrongly *present* — what is wrongly *absent* has no witness but the person it turned away, and on that map the omissions were both the majority and the more harmful half. **While every organisation is ours, "the publishing organisation" is us.**
3. **Enquiries / applications** → reply by email; if it's really an application, point them at Apply.
4. Note anything you acted on where it belongs (incident log, or the customer register).

## What-if

- **A page looks broken after an edit** → it's static HTML sharing one stylesheet; compare against a known-good page (`legal.html`) and check the `/css/styles.css` link and the header/footer markup.
- **A published map isn't showing publicly** → check the three conditions above (published *and* active customer *and* listed).
- **Spam through the forms** → they're rate-limited with a honeypot; if it worsens, that's a maintenance/security item (DEPLOY) — consider the CSRF/token follow-up.
