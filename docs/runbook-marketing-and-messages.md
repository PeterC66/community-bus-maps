# Runbook R5 — Marketing site, public front & messages

**Serves:** maintaining the website · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** Keep the public site correct and current, and work the two message queues. The site has
two halves: **static shopfront pages** you edit by hand, and a **live public front** that generates
itself from published maps.

> **Pilot — the standing constraint on this runbook.** The site must not claim customers, uptime,
> response times or a guaranteed refresh cadence, because none exist yet. Wording that did ("maps
> **our customers** have published", "those are **live**, kept up to date", "we **will** get back to
> you", "**our team**", "always looks right") was removed once — don't let it back in. Seeded demo
> organisations must keep their **Sample** labelling. Any new page needs the
> `<script src="/js/site-banner.js" defer>` tag or it will silently be the one page with no pilot
> banner. See [`PILOT.md`](PILOT.md), and `faq.html#pilot` for the agreed wording.

## The static shopfront (`public/*.html`)

Plain HTML, edited directly, sharing one header/footer and `/css/styles.css`:

| Page | What it's for |
|---|---|
| `index.html` | the pitch / landing page |
| `examples.html` | a **fixed showcase** of sample maps (distinct from the live `/maps`) |
| `apply.html` | the Apply form → `application` (onboarding, R2) |
| `faq.html` | public questions — keep current as features land |
| `contact.html` | the contact form → a `message` |
| `legal.html` | privacy & attribution (G2) |
| `terms.html` | the customer agreement (G3) |

> **Shared footers are duplicated per page** (static HTML, no shared include), so a new footer link
> must be added to every page by hand. The **Terms** link is now in all of them (added across the
> shopfront 2026-07-25) — follow the same pattern for any future footer link.

### Adding a gallery example

`examples.html` is a hand-curated showcase (not the live list). To add one:

1. Export the map's **internal** and **external** JPGs and **downscale** them for the web (the existing
   cards are `1400×990`), into `public/examples/` with clear names
   (e.g. `march-area-internal.jpg`).
2. Add an `<article class="card example">` block copying an existing one: the two `<img>`s, an
   `Area`/`Place` badge, a title, a one-line description, and the outputs line.
3. Keep the OSM + BODS **attribution** line in the footer (it's already there — don't remove it).

## The live public front (P6) — generates itself

`/maps` (gallery), `/m/<slug>` (a published map: sheets, downloads, org credit, **report a problem**),
and `/o/<org-slug>` (an organisation's page) are built from the database — **you don't edit them**. A
map appears there only when **all three** hold (enforced in SQL): it has a **published** version, its
customer is **active**, and the customer has left it **listed**.

- **Publish ≠ public.** Publishing (R3) makes a version official; the customer's **listing** switch
  (`/app/maps/:id` → the public toggle) decides whether it shows. Either can be off.
- `robots.txt` + `sitemap.xml` are automatic from `PUBLIC_BASE_URL` (DEPLOY §2) — no upkeep.

## Per-customer branding (what customers control)

Customers brand their **public pages** (not the sheet) from `/app/branding`, via a **server-enforced
whitelist** — only these, everything else is dropped: **publicName**, **website** (http/https only),
**blurb**, **badge** (emoji or initials), and an **accent** from a fixed list
(blue/teal/green/purple/red/amber/slate). No contact details are brandable — enquiries come back
through "report a problem", so a customer's email is never scrapeable. You can set branding for a
customer if they'd like help. Branding on the **printed sheet** is deliberately not offered (it would
re-open the byte-identical render gate — expert work).

## The two message queues

Both write to the `message` table and surface **read-only** in `/app/admin` → **Messages**:

- **Contact** (`/api/contact`) — general enquiries from `contact.html` (kind `enquiry`).
- **Report a problem** (`/api/public/feedback`) — from a published map's public page (kind
  `feedback`), tagged with **which map**. Both are honeypot-protected and rate-limited.

**Working the queue** (there's no in-app reply yet — triage and act out-of-band):

1. Read new messages (the tab badge is the count).
2. **Map feedback** → check the map; pass anything actionable to the publishing organisation, and if a
   *published* map is actually wrong, treat it as an **incident** (R6, planned) — don't just reply.
3. **Enquiries / applications** → reply by email; if it's really an application, point them at Apply.
4. Note anything you acted on where it belongs (incident log, or the customer register).

## What-if

- **A page looks broken after an edit** → it's static HTML sharing one stylesheet; compare against a
  known-good page (`legal.html`) and check the `/css/styles.css` link and the header/footer markup.
- **A published map isn't showing publicly** → check the three conditions above (published *and* active
  customer *and* listed).
- **Spam through the forms** → they're rate-limited with a honeypot; if it worsens, that's a
  maintenance/security item (DEPLOY) — consider the CSRF/token follow-up.
