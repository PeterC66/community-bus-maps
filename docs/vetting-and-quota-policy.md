# Vetting & quota policy (Pol1)

**Serves:** accepting customers · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.0-P7`

**Purpose.** The criteria you apply when deciding an application (R2), and the default quotas — so
decisions are consistent and defensible. This is the generic rulebook; the **actual decisions** (real
organisations) go in the private [vetting decisions log](../../community-bus-maps-ops/vetting-decisions-log.md) (`ops/`).

> **Pilot.** No application has ever been approved. During the pilot, prefer a **small number** of
> organisations that will actually tell you what is wrong, and be explicit with them about what they
> are joining (R2, [`PILOT.md`](PILOT.md)). The criteria below are the standing rulebook regardless.

## Who qualifies

Approve an organisation that has a **legitimate connection to the area or place** it wants a map for,
and a plausible community purpose (helping people use the buses). The system's customer types:
`council · shop · business · school · function-organiser · charity-nt` (charity / National Trust) `· other`.

**The core test — authority over the subject:**

- **Area map** (town / parish / part-of-town): the council or parish for that area, or a body with a
  clear remit there.
- **Place map** (shop / school / station / venue / event): the operator of that place, or the
  organiser of that event.

Decline — politely — if approving would let them **imply an endorsement** by a bus operator, a
council, or an area they don't represent.

## Red flags → hold or decline

- No evident connection to the area or place.
- Commercial use that would imply operator/council endorsement.
- A request that only makes sense as **automated any-town coverage** — out of scope until the
  bustimes.org question is closed (see [LICENSING.md §3](LICENSING.md)).
- Anything that would put **personal data on a public page**.

When unsure, **hold** and ask for more information rather than guess.

## Default quotas

- **1 area + 3 places** per customer — the approve dialog's defaults.
- Editable per customer, any time, on the admin **Customers** tab.
- Raise on a reasoned request (e.g. a district council covering several parishes). **Record why** in
  the vetting log.
- Quota counts **non-archived** maps of each kind; a requested-but-unbuilt map already consumes a slot,
  and archiving a rejected/withdrawn request frees it.

## Recording the decision

Every application → **one line** in the private vetting decisions log: the authority check, the
decision (approve / hold / decline) and the reason. This is the audit of *judgement* that the database
doesn't hold — keep it current.
