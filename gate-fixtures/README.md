# `gate-fixtures/` — the map packs this repository's byte gates run against

<!-- docstamp v1.0 | 2026-09-18 | sha=c00d3bc5 -->
**v1.0** · updated 18 September 2026

**What this is.** A vendored copy of two fixture packs that are produced in the private `buses-data` repository: one TOWN pack (`Areas/_portal-fixture`) and two PLACE packs (`Places/_portal-fixture`). Each is a complete map pack — everything a generator reads, plus the shipped SVGs it is compared against — so `npm run verify` can demonstrate the product's central technical claim, that the same inputs produce the same bytes, on any machine that has cloned this repository and nothing else.

**Why it is here rather than fetched.** Until 18 September 2026 `verify.yml` cloned `PeterC66/buses-data` with a personal access token, `CROSS_REPO_PAT2`, to read these packs. That token expires on **22 November 2026**, and because this repository requires the `verify` check and does not allow bypassing, its expiry would have blocked every pull request here outright until somebody turned branch protection off. The fix was not a longer-lived token. It is that a public repository gates fixtures it holds: no credential, no second checkout, and no verdict that depends on what somebody else pushed a minute ago. That is R5 of the process review of 17 September 2026, filed as `OA-398` in `buses-data`.

**What is deliberately not here.** The JPGs. Rasterisation is platform-dependent by design — Linux and the Windows laptop produce different glyph outlines — so a committed JPG buys a comparison that is expected to differ for ever; `verify-reproduce.mjs` guards its JPG arm with an `existsSync` and calls it informational, and [`render-parity.yml`](../.github/workflows/render-parity.yml) is the gate that really asks that question. The area pack in `buses-data` has excluded them since the day it was created; this folder now does the same for the place packs. Measured on the day: 78 tracked files and 8.5 MB with the JPGs, 73 files and 4.2 MB without. The other exclusion is markdown — `buses-data`'s own fixture README is written about `buses-data` and its relative links climb out of it, so vendoring it would have put prose here that resolves only on a laptop holding both trees. This file is the replacement.

## Keeping it in step

These packs are copies, and a copy that has quietly fallen behind does not make a byte gate red — it makes it green about last month's artwork. Refreshing has three steps, and only the third writes here:

1. Rebuild the map in `buses-data` and refresh the fixture there — `refresh_area_fixture.js` in the engine for the town pack, [`scripts/refresh-place-fixture.mjs`](../scripts/refresh-place-fixture.mjs) in this repository for a place pack. Both write into `buses-data`, from an S5 render that only the laptop has.
2. Re-vendor. From this repository's root (`C:\Claude\community-bus-maps`), with no placeholders — `--buses` is needed only when `buses-data` is somewhere the script cannot guess:

```bash
npm run fixtures:vendor -- --apply
```

3. Commit this folder, saying in the message which `buses-data` commit the bytes came from.

**Where the freshness question is asked.** Not here: this repository has no `buses-data` to compare against, which is the point. `npm run fixtures:vendor` with no `--apply` is the read-only form, and it runs from the laptop and as a step in `buses-data`'s own `gates.yml`, which can clone this public repository for nothing. That is the estate's standing rule — a check belongs in the suite that fires when its SUBJECT changes — and the subject of *has the vendored copy fallen behind* is the fixture in `buses-data`.

**It is falsifiable, and the falsification runs in `npm test`.** [`scripts/prove-red-vendored-fixtures.mjs`](../scripts/prove-red-vendored-fixtures.mjs) builds both trees in the temp directory and requires the check to go red on a changed byte, an unvendored file and an orphan; to stay GREEN on the two deliberate exclusions, which is the half that can go wrong quietly; and to exit 2 rather than 1 when there is no source to compare against, because *could not look* reported as a finding is one of this estate's named failure shapes.

## Which packs, and why these

`Areas/_portal-fixture/St Ives` is the town pack. One town is enough for `verify:area` — determinism is proved as well by one as by three — but `verify:defaults` is the gate that needs coverage, because it forces each `design:`/`labels:` escape hatch off in turn and asserts each one still changes at least one sheet. A key that changes nothing on any fixture is dead code. St Ives exercises every one of them today, and **that is a measurement rather than a property**: it was not true two days before it was first measured, and if `verify:defaults` ever reports a key as identical on every sheet, the first question is whether the key died or whether this town simply stopped exercising it. The answer is usually to add a second pack here, not to exclude the key.

`Places/_portal-fixture/High Wycombe Aldi` and `High Wycombe High Street` are the place packs. Two, because the boarding sheet is only built for the second of them, and a gate that certified the boarding generator without ever running it is the fault [`prove-red-selfsufficient.mjs`](../scripts/prove-red-selfsufficient.mjs) exists to prevent.
