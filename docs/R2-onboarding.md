# Runbook R2 — Customer onboarding

<!-- docstamp v1.7 | 2026-09-12 | sha=dd46bf5a -->
**v1.7** · updated 12 September 2026

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

### Step 2a — Turn OFF *Sample maps* for a real organisation (PILOT)

**Approving does not do this and cannot safely guess it.** A new customer is created with both per-customer opt-outs **ON** — `customer.is_sample` and `customer.watermark_enabled` both default to 1, and approve sets neither — because each defaults towards the honest state rather than the confident one. For an organisation that is genuinely ours — a test account, a demo — that is correct and you leave it alone. For a real external organisation it is **wrong the moment they publish**, and it is wrong in a way that lands on their own badge.

**Why it matters more than it sounds.** While *Sample maps* is on, every sheet they publish carries the red band reading *PILOT — SAMPLE MAP · Made to test the system. **Not published by any organisation.** Do not rely on it for travel.* That middle sentence is a claim about the map, and the first organisation ever to register would have found it printed directly above their own name. Until 2026-09-12 there was no way to turn it off at all (buses-data OA-320); now there is, and the only thing between a real customer and that sentence is this step.

In **Admin → Customers**, on that organisation's row:

- **Sample maps** — turn **off**. This is a correctness question, not a preference, and it is not theirs to choose.
- **Watermark downloads** — decide separately, **with them**. This one genuinely is a preference: it puts a diagonal *BusMaps.uk* across the JPG for anyone who is not the owning customer or an admin, and some organisations will want it kept. The two sit side by side in the table because they are flipped at the same moment, not because they are the same question.

**What happens to sheets that already exist.** If you are handing an organisation a map we published ourselves, **reassign the map's owner** rather than rebuilding it: the reassignment reconciles that map's stored renders as part of the same action, so the band comes off the sheets already in the object store, and any version they render afterwards is drawn without the band from the start. **There is no button for this in the admin console** — it is the API call in [R1, *What-if / rollback*](R1-create-map.md#what-if--rollback): `POST /api/admin/maps/<id>/owner`, admin, needing a sign-in from the last 30 minutes. **Read the `restamped` object in its reply rather than assuming**, because the owner change is committed before the reconciliation is attempted: `{"error": true}` means the map moved and its stored sheets did not, which leaves the old band over its new owner's badge and looks exactly like success.

**If that reports an error — or you have flipped `is_sample` directly in the database —** reconcile the whole store by hand. One line, run from the repository root on the laptop (`C:\Claude\community-bus-maps`), with no placeholders:

```bash
npm run ssh -- "cd /opt/community-bus-maps && docker compose run --rm portal node scripts/restamp-renders.mjs"
```

It writes nothing without `--apply`; add it to the quoted command once the dry run says what it would change. The full reasoning, and what stays site-wide once a real organisation is publishing, is in [PILOT.md, *What it does*](PILOT.md#what-it-does).

## Step 3 — Get the invite to them

- **Dev (no `EMAIL_PROVIDER`):** the link is **printed to the server console** and shown to you in the approve dialog. Copy it and send it to the applicant yourself (or use it to test).
- **Production:** once `EMAIL_PROVIDER` is set (see [DEPLOY.md §2](DEPLOY.md)), the invite is emailed automatically. Until then, onboarding depends on you handing the link over out-of-band.

## Step 4 — Record + welcome

- Add the customer to the private customer register, `P1-customer-register.md` in the ops folder (`C:\Claude\community-bus-maps-ops\`): org, contact, type, quota, status, onboarded date.
- Send a welcome pointing them at the **customer user guide** (which opens with the pilot caveat) and telling them you'll build their first map. Set expectations honestly — see the pilot note above. They can also **Request a map** themselves from their dashboard, within quota.

## Step 5 — Their maps

- A customer **requests** a map (area/place) from their dashboard within quota → it lands in **`/app/admin` → Map requests**. **Approve** it → it moves to **"Approved — awaiting a build"** in the same tab, with the command that builds it → **build + import** it (**R1**), which fulfils that request row **in place** (one map, quota counted once).
- Or you build proactively (R1) and attach it to them by name.
- **If the town they want is currently a demo map** (e.g. St Ives, St Neots) → **policy: one live map per town, ever.** Don't create a second row alongside the demo's. Retire the demo's map first, then build theirs fresh at v1.0 — the mechanics (`scripts/delete-map.mjs`, then the normal import) are in [R1-create-map.md](R1-create-map.md), section *Taking over a demo-held town*. Don't approve the map request until you're ready to do both steps together — an approved-but-unbuilt request for an already-taken slug will fail the build with the same `--slug` collision error, one step later than you'd want to discover it.

## What-if

- **Wrong quota** → edit it inline on the **Customers** tab any time.
- **Declined** → **Reject** the application (marked rejected; no account created). Note why in the vetting log.
- **They can't sign in** → they can request a fresh link at the `/app` sign-in page (printed to the console in dev); check the email matches the account exactly.
- **Suspend or close a customer** → set status on the **Customers** tab. Suspension takes their maps off the public site and out of the search index, and it keeps every byte of their data. **It does NOT stop their people signing in or editing** — nothing joins the customer's status into the session. If access itself must stop, that is a per-user act: set each of their users to `disabled` on the **Users** tab, which since 2026-08-30 also ends every session that user is holding and tells you how many it ended. Treat a suspension prompted by a problem as an incident — [**R6**](R6-incident-response.md).
