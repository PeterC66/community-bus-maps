# Using your bus maps — a guide for customers (C1)

<!-- docstamp v1.14 | 2026-09-06 | sha=20c06d0b -->
**v1.14** · updated 6 September 2026

*A plain guide for approved organisations. If you run the service, this is the document you hand to each new customer.*

**Last reviewed:** 2026-08-24 · **Applies to:** the portal at `0.10.0-pilot`

> **This is a pilot.** The system works end to end, but you would be among the first organisations to use it — there is no track record behind it yet, no service level, and no charge. Things may change, and we may pause or withdraw parts of it (with reasonable notice; you keep any sheets you have already downloaded). In exchange we want to hear what does not work. Everything below describes how the system is built to work.

Welcome. Once your organisation is approved you can generate, tweak and keep up to date **printable bus maps** for the places you care about. Here's how.

## Signing in

There's **no password**. On the sign-in page enter your email and we send you a **one-time link** — click it and you're in. Your sign-in lasts a while on that device; use **Sign out** on a shared computer. If a link expires, just request another.

## Your dashboard

After signing in you see **your maps** and your **quota** (how many area and place maps you may hold — one area and a few places during the pilot). You only ever see your own organisation's maps.

- **Area map** — a whole town, parish, or part of a town.
- **Place map** — centred on one point: a shop, school, station, venue or town centre.

## Asking for a map

Use **Request a map**, choose area or place, and give it a name (and, if you like, a note about what you need). We build the map data for you centrally — bus and street data takes judgement, so that part isn't self-serve. When it's ready it appears on your dashboard, ready to edit.

## Editing a map

Open a map to make it yours. You can change:

- **Route colours** — pick from a colour-blind-friendly palette.
- **Landmarks (points of interest)** — switch icons on or off here, or open **Landmarks** for the fuller version: your town's streets with every place marked on them, and three answers for each — **Must show**, **Show if there is room**, **Do not show**. You can answer a whole category at once, and give a place the name people locally use. There are a lot of places, so the screen keeps count: **the number sits on the buttons themselves** — *Not looked at yet 12*, *Answered 133* — and **Not looked at yet** narrows the list to the rest. Leaving somewhere exactly as it is counts as an answer, so you can stop half way and pick up where you left off. Once you have been all the way through, that button reads **0** and stays there: it is not broken, it is empty, and what fills it later is a place OpenStreetMap has added since — so it is worth a glance after each monthly update. **The map and the list are two views of the same thing.** Click a symbol on the map and that place opens in the list, ready to answer; pick a place in the list and the map travels to it and zooms in, so you never have to hunt for the one you just chose. Zoom in and the plain dots become the actual symbols the printed sheet uses, so you are deciding about the thing you will see on the paper. Road names are drawn to help you get your bearings, and there is a **Road names** button if you would rather they were not. It is the one part of the map only you can get right: the places come from OpenStreetMap, which lists what somebody happened to map rather than what a bus passenger is looking for.

  The two controls are not the same thing, and the difference is worth a sentence. Unticking a landmark above stops its icon being *drawn* but keeps its space reserved. Answering **Do not show** in the chooser takes it off the map altogether, which is what actually gives the room back to everything else — so a sheet re-arranges a little when you save that.

  Three smaller things worth knowing. **Your first draft deliberately has far too many places on it** — every one is there because OpenStreetMap has it and nobody has yet said it does not belong, so taking places off is the most useful thing you can do and the answer we least often get. **A row you answer disappears from *Not looked at yet* straight away**, so that filter always shows what is genuinely left; the list holds its place while it goes, so you are not thrown back to the top. And **a few places have no name in the map's data at all** — chemists and surgeries, whose names the printed sheet never shows, so nobody ever recorded one. Those read *Unnamed pharmacy* in italics: click the row to see where it is on the map, and if you know the place, put its name in the box. That name is then the one the sheet will use.
- **Which outputs it produces** — the **internal (geographic)** street map, a straightened **schematic**, and the **external** "where the buses go" map are yours to switch on and off. Two are the exception, and both show an **Ask us** button instead of a tick-box. The tube-map-style **diagram** is positioned by hand rather than generated, so it is quoted separately. **Where to board** — a large-scale plan of one place with an index of destinations telling a reader which stop to stand at — can only be drawn where the national stop register names every stop around that place unambiguously, so we check your place before offering it. Press either button and we will come back to you with what it would involve.

You see a **live preview** as you change things. When you're happy, **Save new version**. Your first version (1.0) is the map exactly as we built it; each save adds a new numbered version and keeps the earlier ones. Bigger changes — moving things, the diagram layout, the geography — are done by us; ask if you need one.

## Branding your public page

Under **Branding** you can set how your organisation appears on your public map pages: a **display name**, **website**, a one-line **blurb**, a **badge** (an emoji or your initials) and an **accent colour**. This decorates the *web page around the map* — it is deliberately **not** printed on the map sheet, and no phone or email is shown publicly (enquiries reach you through the map's "report a problem" form).

## Publishing (getting it checked and made official)

A version you save is a private **draft**. To make it official, open the **Publish** panel and hit **Send ‹your version› for review** (the button carries the version number). A reviewer then checks it against a safety checklist and either **publishes** it or sends it back with a note. **You don't publish your own map** — that second pair of eyes is deliberate, because people rely on the result. While a version is awaiting review, editing is paused so nothing changes underneath it; you can **withdraw** to keep editing.

## Making it public (or not)

Publishing makes a version *official*; a separate **listing** switch controls whether it appears on the public site (`/maps`, your organisation page, and its own page). So you can have an official map that you keep unlisted until you're ready to announce it.

## Your map online

Once a map is published *and* listed, it has its own page — `/m/<your-map>` — that you can link to from anywhere: your website, a newsletter, a QR code on a noticeboard. You don't have to host anything, and the page always shows the version currently published, so a correction or a monthly update reaches everyone who follows that link.

The page shows the map itself rather than a flat picture of it: readers can drag it about and zoom in for the detail, on a phone as well as a laptop, and it stays sharp however far they zoom. Both sheets are there (the one for within your area and the one for journeys out of it), and the print files are a click away.

Two things worth knowing:

- **Every map is also published as text.** Below the map is a link to its **service list** — every route, its operator, the days it runs, the stops it serves and where it goes, written out. That is what a blind reader gets instead of the map, and it is what makes the page safe for a council or school to link to. Please link to it alongside the map if you put ours on your own site; [`/accessibility.html`](../public/accessibility.html) has a paragraph you can paste into your own accessibility statement.
- **The page says how old the information is.** It shows the month your map's data is correct as at, and after a while without an update it tells readers plainly that it may be out of date and to check with the operator. That's deliberate: a page on the internet looks current in a way a leaflet on a noticeboard doesn't. Accepting the monthly updates is what keeps the notice away.

Putting the map *inside* a page on your own website — rather than linking to ours — isn't available yet. It's the next piece of work; tell us if you want it and we'll know it matters.

## Downloading print-ready sheets

For any version you can download the **print-ready files** — an SVG and a 300 dpi A4 JPG for each output. Print them, put them on a noticeboard, add them to a newsletter. **Keep the credits** that appear on the sheet, and always point people to the operator or bustimes.org for live times — a printed map is a guide, not today's departures.

## Monthly updates

Bus services change. When they do, we prepare a **proposed update** for your map from fresh data. The intention is monthly; during the pilot the cadence is not guaranteed. You get an **old-vs-new preview**; **Accept** and your colours and landmark choices are re-applied to the new data as a new version (which then goes for the usual review), or **Decline** to keep what you have. You stay in control of what gets published.

Accepting doesn't send the new version for review straight away — it lands back on your dashboard as a fresh draft, carrying your existing choices over. If you'd like to revise anything — colours, landmarks, which outputs it produces — this is your chance to edit before you submit it for review, just as you would with any other draft.

**The preview also tells you about new places.** The places on your map come from OpenStreetMap, and people add to it all the time — a new surgery, a shop that has changed its name. Anything that has appeared since your last version is listed on the update, because until you say otherwise it will be **shown if there is room**, which means accepting the update can quietly put a new symbol on your sheet. They are the ones waiting under **Not looked at yet** in *Landmarks*, so answering them is a two-minute job and worth doing before you submit the new version for review. Places that have GONE from OpenStreetMap are listed too, and there is nothing to do about those: whatever you had said about them is kept, in case they come back.

## If something looks wrong

On any published map's public page there's a **"report a problem"** link — tell us and we'll look into it — though the pilot is run by one person alongside other work, so we can't promise how quickly. For anything else, use the **contact** form. Thank you for helping keep local bus information clear and correct.
