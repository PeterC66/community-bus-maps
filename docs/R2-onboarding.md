# Runbook R2 — Customer onboarding

<!-- docstamp v1.3 | 2026-08-12 | sha=905c4e04 -->
**v1.3** · updated 12 August 2026

**Serves:** accepting customers · **Owner:** operator · **Last reviewed:** 2026-07-25 · **Against:** `0.8.1`

**Purpose.** Turn a public application into an **active customer with an editor who can sign in** — through the admin console, applying the vetting policy (**Pol1**). This closes the **first approval gate** (organisation).

> **Pilot.** There are no customers yet, so the next person you onboard is the **first**. Say so explicitly when you welcome them (Step 4): the system is a pilot, there is no service level, the monthly cadence is an intention not a promise, their maps will carry a pilot band until the pilot ends, and what you want in return is to hear what does not work. The public copy already says all of this — don't let the welcome email be the one place that oversells. See [`PILOT.md`](PILOT.md).

## Where applications come from

The public **Apply** form (`/apply.html` → `POST /api/apply`) writes an `application` row: org name + type, contact name, email, optional phone/website, and their message. They surface in **`/app/admin` → Applications** (the badge is the pending count).

## Step 1 — Vet (Pol1)

Open the application and apply the [vetting & quota policy](Pol1-vetting-and-quota-policy.md): authority over the area/place, a plausible purpose, no endorsement or personal-data red flags. Decide **approve / hold / decline**, and record the decision + reason in the private vetting log.

## Step 2 — Approve (creates customer + editor + invite)

In **Applications → Approve**, you can set:

- **Quota** — area maps (default **1**) + place maps (default **3**), per Pol1.
- **Editor name** — defaults to the applicant's contact name.

Approving, in one action:

- creates the **customer** (type carried from the application; your quotas);
- creates the first **editor** user (role `editor`, the application's email);
- marks the application approved and links it to the customer;
- issues a **passwordless invite** — a magic sign-in link;
- writes it all to the **audit log**.

> **Guard:** if that email **already has an account**, approve returns a 409 — the person is already a user. Approve the organisation another way, or ask them to sign in.

## Step 3 — Get the invite to them

- **Dev (no `EMAIL_PROVIDER`):** the link is **printed to the server console** and shown to you in the approve dialog. Copy it and send it to the applicant yourself (or use it to test).
- **Production:** once `EMAIL_PROVIDER` is set (see [DEPLOY.md §2](DEPLOY.md)), the invite is emailed automatically. Until then, onboarding depends on you handing the link over out-of-band.

## Step 4 — Record + welcome

- Add the customer to the private [customer register](../../community-bus-maps-ops/customer-register.md) (`ops/`): org, contact, type, quota, status, onboarded date.
- Send a welcome pointing them at the **customer user guide** (which opens with the pilot caveat) and telling them you'll build their first map. Set expectations honestly — see the pilot note above. They can also **Request a map** themselves from their dashboard, within quota.

## Step 5 — Their maps

- A customer **requests** a map (area/place) from their dashboard within quota → it lands in **`/app/admin` → Map requests**. **Approve** it → it moves to **"Approved — awaiting a build"** in the same tab, with the command that builds it → **build + import** it (**R1**), which fulfils that request row **in place** (one map, quota counted once).
- Or you build proactively (R1) and attach it to them by name.
- **If the town they want is currently a demo map** (e.g. St Ives, St Neots) → **policy: one live map per town, ever.** Don't create a second row alongside the demo's. Retire the demo's map first, then build theirs fresh at v1.0 — the mechanics (`scripts/delete-map.mjs`, then the normal import) are in [R1-create-map.md](R1-create-map.md), section *Taking over a demo-held town*. Don't approve the map request until you're ready to do both steps together — an approved-but-unbuilt request for an already-taken slug will fail the build with the same `--slug` collision error, one step later than you'd want to discover it.

## What-if

- **Wrong quota** → edit it inline on the **Customers** tab any time.
- **Declined** → **Reject** the application (marked rejected; no account created). Note why in the vetting log.
- **They can't sign in** → they can request a fresh link at the `/app` sign-in page (printed to the console in dev); check the email matches the account exactly.
- **Suspend or close a customer** → set status on the **Customers** tab (they keep their data but lose access). Treat a suspension prompted by a problem as an incident (**R6**, planned).
