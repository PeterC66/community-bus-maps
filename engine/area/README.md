# `engine/area/` — the vendored AREA generators

<!-- docstamp v1.2 | 2026-09-02 | sha=41bca982 -->
**v1.2** · updated 2 September 2026

Area (town) maps used to carry their own generators inside the delivered payload: `import-map.mjs` required `gen_internal.js` and `gen_external.js` in `--src`, and refused the import without them. The map skill stopped staging a generator into S3/S4 on 2026-08-04, so a modern `S5-render` folder has no `.js` in it at all and every real area delivery failed its pre-flight until somebody copied the two files in by hand.

`Areas/_portal-fixture/St Ives` is a pre-2026-08-04 snapshot that still carries its generators, so `npm run verify` stayed green throughout. The gate could not see the bug, because the gate's own fixture was the one shape that still worked.

So the area engine is vendored here, exactly as `engine/place/` already is, and `import-map.mjs` falls back to it when the payload carries no generators. A payload that DOES carry them still wins — an older map, or a town with a hand-edited generator, imports byte-for-byte as it always did.

## What is here, and what is deliberately not

- `gen_external_radial.js` — the external template. The payload's `gen_external.js` is a renamed copy of it. There were **two** until 2026-09-02: `gen_external_busway.js` was dropped (buses-data OA-224 Tier 4.1) after a month in which no committed sheet was drawn by it and a day in which it could not run at all, unnoticed by every gate in the estate, because nothing ran it. `--external-style` survives it and takes only `radial`; any other value is refused by name, so a runbook or a shell history still passing `busway` gets a message rather than a pack imported under the wrong intention.

- **`gen_internal.js` is NOT here.** It is shared by area and place maps alike, and it is already vendored once at `engine/place/gen_internal.js`. Copying it a second time would create two files that must stay identical and are free to drift — the exact failure this project has already hit more than once. The area fallback reads that single copy. If the layout ever changes so that `engine/place/` is not the obvious home for a shared file, move it up to `engine/` and update both callers; do not duplicate it.

Keep every file here byte-identical to its counterpart in the skill (`make-bus-leaflet/assets/`), modulo line endings, the same rule `engine/place/` follows. Since 2026-08-25 something checks that instead of trusting it: `../vendored.json` names both files here with a hash, and `npm test` fails if either is edited without a re-vendor. It was written because `gen_external_radial.js` had been stale since 2026-08-21 — missing the March X32 badge-overlap fix and the `sheetQr` default — and no gate named the file.
