# Runbook R5 — Marketing site, public front & messages

<!-- docstamp v1.9 | 2026-09-01 | sha=ca2b8556 -->
**v1.9** · updated 1 September 2026

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

## Search engines — verification and the sitemap

**Both submissions are account actions in somebody's browser, not deployments.** Nothing in this repository changes, no script performs them, and there is no way to check from here whether they have been done — the only evidence is the two consoles themselves. So whoever does it has to say so somewhere a later reader will look, because nothing else in either repository will ever know. What the repository owes them is a sitemap that is fit to submit, and that half *is* checkable, so do it first.

### Pre-flight — is the sitemap worth submitting?

These four run from **any folder**; they only talk to the live site, and none of them takes a placeholder. Run them before you touch either console, because a submission is worth exactly as much as the URLs behind it.

```bash
curl -s https://busmaps.uk/robots.txt
```

Expect **no** `Disallow: /` line (that one appears whenever `ALLOW_INDEXING` is off — DEPLOY §2 — and while it is there a submission achieves nothing), and expect the `Sitemap:` line to name the apex.

```bash
curl -s https://busmaps.uk/sitemap.xml | grep -c "<loc>"
```

The count is **48 as at 2026-09-01** — thirteen static shopfront pages, seventeen published maps, their seventeen `/services` pages, and the pilot organisation, which is 13 + 17 + 17 + 1 and adds up. Give the breakdown as well as the total whenever you re-record it here: the figure written down on 2026-08-29 was 47 and the breakdown beside it summed to 45, and neither number was challenged for three days because a total on its own cannot be checked against anything. It moves whenever a map is published or un-listed, so treat it as a sanity figure rather than a constant; what matters is that it is not zero, not obviously short, and that its parts still add to it.

```bash
curl -s https://busmaps.uk/sitemap.xml | grep -o "<loc>[^<]*</loc>" | sed 's|</\?loc>||g' | while read -r u; do curl -s -o /dev/null -w '%{http_code}\n' "$u"; done | sort | uniq -c
```

A pass is the single line `48 200`, and the count in it must equal the count command 2 just printed. Any other status code is a URL Google will fetch, fail on, and hold against the property — a sitemap listing redirects or 404s is worse than a smaller sitemap that is all live. **This used to end in `grep -v '^200 '` and pass by printing nothing, which is the wrong shape for this check**: a `while read` loop that consumed no input at all prints nothing too, and so does one that a `curl` inside it silently truncated, so the absence of output could not tell a clean sitemap from a check that never ran. Tallying the codes makes the pass a positive statement with the population in it. Verified `48 200` on 2026-09-01.

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://www.busmaps.uk/
```

Expect **`308 https://busmaps.uk/`**. This one carried the only reason not to submit until 2026-08-31: `www` used to answer `200` in its own right — the `Caddyfile` named both hostnames, which is what made automatic TLS cover both — and the hand-written shopfront pages emitted no `rel="canonical"`, so each of them was reachable as two indexable copies with nothing to say which was authoritative. A crawl would have found that and reported *Duplicate without user-selected canonical* against the property. Both halves shipped and deployed, and both were then read back off the live site rather than inferred: `www` 308s to the apex **preserving the path and the query** (`https://www.busmaps.uk/m/st-ives/services?x=1` → the same path on the apex), and all thirteen shopfront pages carry a self-referential canonical, checked one by one on 2026-09-01. `buses-data` OA-172 retired with it.

### Where this stands for busmaps.uk

**Both were done on 2026-09-01** — the Google **Domain** property for `busmaps.uk` verified by the 20i `TXT` record, `sitemap.xml` submitted, and Bing brought across by *Import from Google Search Console*. `buses-data` OA-015 retired with it, and this paragraph is the record, because **the two consoles are the only other evidence that exists** and neither is readable from any repository: the backlog row that held these facts is deleted by the act of finishing, so if it were not written here it would be written nowhere. Everything below is therefore a procedure for the NEXT property — a second domain, or a re-verification after a DNS change — rather than work outstanding. What is still worth doing is the *afterwards* section at the end.

### 1. Google Search Console

Choose a **Domain property** for `busmaps.uk`, not a URL-prefix property. A domain property covers the apex and `www`, `http` and `https`, in one — which is the difference between reporting on this site and reporting on half of it, given the two-hostname wart above.

A domain property can only be verified by **DNS**, and DNS for this domain is at **20i**, which is registrar and nameserver and nothing else (the app runs on an OVHcloud VPS; 20i holds only the records). Add the record in the 20i control panel under the domain's **Manage DNS**: type `TXT`, host `@` — the domain root, not a subdomain — and value the string Google shows, which begins `google-site-verification=`. It sits alongside the existing SPF/DKIM records for magic-link mail and does not disturb them. Give it a few minutes, then press Verify.

**Leave the record in place permanently.** Google re-checks it periodically and silently un-verifies the property if it has gone; deleting it during a later DNS tidy-up is the way this quietly stops working.

With the property verified, open **Sitemaps** in the left-hand navigation. It is not a top-level item — it sits inside the **Indexing** group, below *Pages* and beside *Video pages* and *Removals*, which is enough to send somebody hunting for it; `https://search.google.com/search-console/sitemaps?resource_id=sc-domain%3Abusmaps.uk` goes straight there for this property. Under **Add a new sitemap** the field is labelled *Enter sitemap URL* and is **not** prefixed with the origin, whatever a half-remembered screenshot may say — enter the whole thing, `https://busmaps.uk/sitemap.xml`, and submit. A *Success* status means the file was fetched and parsed — it is not a statement that anything has been indexed, and Coverage will read "Discovered – currently not indexed" for most of the 48 for a while. Do not re-submit to hurry it along; re-submission tells Google nothing it does not already know.

**Expect *Couldn't fetch* on the first look, and do not chase it.** That was the status within a minute of the real submission on 2026-09-01, and it is **not** a report of a failed fetch — read the row across: *Type* **Unknown**, *Last read* **blank**, *Discovered pages* **0** is the state before Google has tried at all, and it clears by itself. What it is worth doing is proving the difference rather than waiting to find out, because everything checkable on our side was checked at the time and was fine: `200` as Googlebot, `Content-Type: application/xml`, a valid `urlset` with 48 `<url>` elements and no BOM, nothing in `robots.txt` blocking it, no rate limiter on that route, and `200` over **both** IPv4 and IPv6 — that last one being the check worth keeping, because an `AAAA` record pointing at a host that does not answer is the textbook cause of this message and is invisible to any `curl` run on a v4-only connection. The read-back that settles it is **URL Inspection** on `https://busmaps.uk/sitemap.xml` → **Test live URL**, which makes Google fetch it now and reports what its own crawler saw. That is the only instrument here that can tell *not tried yet* from *tried and failed*; ours can only say the file is fine.

### 2. Bing Webmaster Tools

Do Google first, because Bing's fastest path is **Import from Google Search Console**: it carries the verification and the submitted sitemap across together, and needs no second DNS record. If the import is refused for any reason, Bing verifies the same three ways as Google — a DNS `TXT` at 20i, a `<meta>` tag, or an XML file at the site root — and the DNS route is the one to prefer, for the same reason as above.

### What to look at afterwards, and when

Neither console has anything useful to say for the first few days. After a week, the questions worth asking are whether **Coverage/Pages** shows the map pages indexed rather than merely discovered, whether any URL is excluded for a reason that is our fault (a duplicate-canonical warning was the one to expect, and the two causes of it were removed on 2026-08-31, so one appearing now is new information rather than a known debt), and which queries in **Performance** actually reach the site — that last is the only measurement we have ever had of whether anyone is looking for this.

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
