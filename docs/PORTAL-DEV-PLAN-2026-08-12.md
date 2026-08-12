# Portal development plan — 12 August 2026

<!-- docstamp v1.0 | 2026-08-12 | sha=8ad7f9b0 -->
**v1.0** · updated 12 August 2026

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
| 3 | H9 — admin's editor's-eye view: don't offer an admin the actor's button on a map that's someone else's move | — |
| 4 | Part B place-name search — index `places.json` written at publish time; header entry point decided after Part A (Part A is already shipped) | — |
| 5 | Rebuild P8a (online-first published maps: viewer, text alternative, accessibility page) against current `main`; branch `p8a-maps-online` is 123 commits behind with 36 conflicts, treat as a spec + reference implementation, not a mergeable branch | — |

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
