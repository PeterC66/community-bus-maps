# engine/place/ — the vendored PLACE map engine

Area maps carry their generators *with each map's data* (see `../README.md`). **Place maps do
not** — the `make-place-bus-leaflet` skill keeps one engine in the skill and never copies it into
a place's render folder, so a staged place payload has the `*.json` inputs but no generators. To
render place maps the portal therefore **vendors the place engine here** and the importer
(`scripts/import-map.mjs`) copies these three files into each place map's `data/` folder, exactly
where the area generators would otherwise sit.

| file | source | role |
|---|---|---|
| `gen_internal.js` | `make-bus-leaflet/assets/gen_internal.js` (verbatim) | draws the internal map — the **same** generator area maps use (road-following via `internalRoads` + `roads_geo.json`/`routes_paths.json`, all baked into the payload → no network) |
| `gen_external_places.js` | `make-place-bus-leaflet/assets/gen_external_places.js` (verbatim) | draws the **aggregated-destination** external radial (one spoke per reachable place); already honours top-level `routeColors` overrides |
| `gen_internal_place.js` | new (portal) | thin wrapper: runs `gen_internal.js`, then fixes the title ("Buses serving <place>") and the version stamp — the two things `gen_internal` can't express for a place. No network, no `overrides.json` mutation. |

All three are env/flag driven the same way as the area engine (`LEAFLET_DIR`, `SKILL_ASSETS`,
`OVERRIDES_FILE`, `EDITOR_KEYS`), so the deterministic-render contract is unchanged.

**Expert framing (river-hide / frozen viewport).** Some places ship a small `overrides.json` of
*expert* framing. That is not a customer edit, so the importer stores it as the map's
`data/base-overrides.json` and the portal merges it *under* the customer's safe-subset overrides at
render time (`src/maps/engine.js`). A place with no such framing has no `base-overrides.json` and
behaves exactly like an area map (empty base ⇒ byte-identical baseline).

**Provenance.** These are byte-for-byte copies of the skill assets as of the vendor date; the
`scripts/verify-reproduce-place.mjs` gate proves the vendored engine reproduces a skill-rendered
place leaflet byte-for-byte. Re-vendor (re-copy + re-run the gate) if the skill engine changes.

> **Pilot.** Rendered place sheets carry a `PILOT — SAMPLE MAP` band, added to the finished SVG
> outside the engine (`src/render/pilotStamp.js`). Nothing here knows about it and the reproduce gate
> is unaffected — see [`../../docs/PILOT.md`](../../docs/PILOT.md).
