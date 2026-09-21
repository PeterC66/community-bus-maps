---
date: 2026-09-20
title: "O7's limit shipped for the public POSTs and stopped there — the four routes that actually spawn a generator had no bound at all, and the per-map lock that looks like one is answering a different question"
---

- **`technical-audit_2026-08-19` O7 asked for two things and buses-data OA-039 recorded one and a half as done.** The per-IP limit went onto five public POSTs, the bounded-caches half was answered three separate ways, and the sentence the audit wrote about the render routes — *"any authenticated editor can saturate the single VM"* — stayed true. `POST /api/maps/:id/preview` and `POST /api/maps/:id/save` called `rateLimited()` nowhere.

- **`withMapLock()` looks like the missing bound and is not.** It serialises runs **per map**, so one editor cannot stack requests on one map — and can still run every map they own at once. A per-map lock cannot answer a per-user question, and the difference is invisible from any single-map test.

- **Asking the wider question — which routes run a generator — finds FOUR an ordinary editor can reach, not two.** The other two are in `src/routes/proposed.js` behind the same `loadOwnedMap()` guard, and `/proposed/:pid/preview` renders **twice**, once for the before side and once for the after. A limit on the audit's two named routes is one a caller walks around by using the other two, so the budget lives in `src/http/helpers.js` and all four spend it.

- **Per USER, and the key is a namespace inside the existing counter map rather than a second one.** `rateLimited()`'s own header insists on one map, because a second instance hands a caller a fresh allowance by choosing a different route file; `render:<user id>` respects that and cannot collide with an address. Keying on the address instead would be wrong twice over — one organisation behind one office NAT would share a bucket, and one editor moving from the office to a phone would get a fresh one.

- **The three expert diagram routes solve and render too, and are deliberately left out.** They are behind `requireAdmin()`, so an editor cannot reach them and they are not a way around this; the audit's subject is an editor, and rationing ourselves is a different question. It is left open on OA-039 rather than settled by reflex.

- **The figure is `rateLimited()`'s own default and is not measured, which the code says in as many words.** Nothing here has timed a render and a cap fitted to an unmeasured cost would be a number pretending to be a finding. What IS measured is the distance from legitimate use: every browser caller serialises itself — `runPreview()` returns early while `inFlight` and re-runs at most once from `queued`, the landmarks sheet dialog awaits its own fetch — so a person driving the UI cannot have two renders outstanding and their rate is bounded by how long a render takes, not by how fast they click.

- **Seven assertions, shaped by the four ways a wrong fix passes a naive test** (`npm run test:render-budget`): where the first refusal falls, a save refused on a budget spent entirely on previews, a second editor served from the same address, a public POST still served from that address, and a stranger who is turned away by the guard costing the owner nothing. Every refusal is read by sentence as well as by status, so a 403 from the CSRF hook or a 409 from the publication freeze cannot stand in for one.

- **Four mutations, each watched red for its own reason** (`npm run test:prove-red-render-budget`): the check deleted, a counter per route, the check hoisted in front of the ownership guard, and — the one the harness is really for — `rateLimited(req.ip, 20)`, the obvious fix, which is shorter than the right one, passes anything that only counts to twenty-one, and reddens three assertions for three different reasons.
