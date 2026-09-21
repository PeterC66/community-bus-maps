# Vetting & quota policy (Pol1)

<!-- docstamp v1.4 | 2026-09-12 | sha=54f6edbc -->
**v1.4** · updated 12 September 2026

**Serves:** accepting customers · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** The criteria you apply when deciding an application (R2), and the default quotas — so decisions are consistent and defensible. This is the generic rulebook; the **actual decisions** (real organisations) go in the private vetting decisions log, `P2-vetting-decisions-log.md` in the ops folder (`C:\Claude\community-bus-maps-ops\`).

> **Pilot.** No application has ever been approved. During the pilot, prefer a **small number** of organisations that will actually tell you what is wrong, and be explicit with them about what they are joining (R2, [`PILOT.md`](PILOT.md)). The criteria below are the standing rulebook regardless.

## Who qualifies

Approve an organisation that has a **legitimate connection to the area or place** it wants a map for, and a plausible community purpose (helping people use the buses). The system's customer types: `council · shop · business · school · function-organiser · charity-nt` (charity / National Trust) `· other`.

**The core test — authority over the subject:**

- **Area map** (town / parish / part-of-town): the council or parish for that area, or a body with a clear remit there.
- **Place map** (shop / school / station / venue / event): the operator of that place, or the organiser of that event.

Decline — politely — if approving would let them **imply an endorsement** by a bus operator, a council, or an area they don't represent.

## Red flags → hold or decline

- No evident connection to the area or place.
- Commercial use that would imply operator/council endorsement.
- A request that only makes sense as **automated any-town coverage** — out of scope until the bustimes.org question is closed (see [LICENSING.md §3](LICENSING.md)).
- Anything that would put **personal data on a public page**.

When unsure, **hold** and ask for more information rather than guess.

## Default quotas

- **1 area + 3 places** per customer — the approve dialog's defaults.
- Editable per customer, any time, on the admin **Customers** tab.
- Raise on a reasoned request (e.g. a district council covering several parishes). **Record why** in the vetting log.
- Quota counts **non-archived** maps of each kind; a requested-but-unbuilt map already consumes a slot, and archiving a rejected/withdrawn request frees it.

## Local advisers — a different question, asked of a different person

A **local adviser** is somebody who knows a town we draw and has agreed to look at a draft before it is published. They are not a customer and they do not work for one; they are usually a member of the public who wrote in about a sheet and turned out to be right. The role exists because the person who knows whether a bus map is wrong is rarely the person paying for it (buses-data OA-154).

**They are asked, never approved.** There is no application form and nothing to vet in the sense above, because they are being asked a favour rather than granted a service. The judgement is simply *does this person know the ground* — normally already answered, because they have told us something true about it. Ask on the admin **Advisers** tab: an email address and a map, which creates the account, grants the map and sends the sign-in link in one action.

**What they can reach, and the rule that keeps it that way.** One map's current draft, watermarked on screen, with no downloads of any kind, nothing about the organisation paying for the sheet, and no other map. Their reach is a per-map **grant** and not an organisation: an adviser holds no `customer_id`, and the database refuses to give them one, because a customer id is exactly what the editor's own access check matches on — an adviser carrying one would be an editor of that organisation's whole estate.

**Sign-in, never a shareable link.** Everything an adviser sees is behind the same magic-link sign-in as every other account. A preview link that worked without signing in would be forwardable, and a forwarded unpublished sheet is how an unchecked bus map reaches a Facebook group.

**Stopping.** Use *Stop asking* on the same tab. The account and the record of having been asked both stay — who was shown which draft, and when, is a question asked months later — and they simply stop seeing the map.

## Recording the decision

Every application, **and every adviser asked**, → **one line** in the private vetting decisions log: the authority check, the decision (approve / hold / decline) and the reason. This is the audit of *judgement* that the database doesn't hold — keep it current.
