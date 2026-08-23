# engine/expert/ — the vendored EXPERT-STYLE engines (P7)

<!-- docstamp v1.4 | 2026-08-23 | sha=eb7485e4 -->
**v1.4** · updated 23 August 2026

The third and fourth outputs of a map — the **octolinear schematic** and the **tube-map diagram** — are produced here. Unlike the area generators (which travel with each map's data) and the place engine (which is copied *into* each place map's data), these are **portal-owned**: a town's render folder never carried them, they are identical for every map, and they are the expert side of the product. `src/maps/store.js` marks their outputs `engine: 'expert'`, so `resolveGen()` returns an absolute path out of this folder.

| file | source | role |
|---|---|---|
| `schematize_internal.js` | `make-bus-leaflet/assets/schematize_internal.js` (verbatim) | geometry **pre-stage**: rewrites the map's geometry as octolinear pseudo lat/lon into a `schematic/` workspace, then runs the map's own `gen_internal.js` there |
| `diagram_internal.js` | `make-bus-leaflet/assets/diagram_internal.js` (verbatim) | the same idea, topology-only: collapses corridors to straight runs into a `diagram/` workspace, honours the expert's `diagram-layout.json` pins, writes `diagram/solved-nodes.json` |
| `gen_internal_schematic.js` | new (portal) | thin wrapper so the pre-stage behaves like a normal portal generator |
| `gen_internal_diagram.js` | new (portal) | ditto for the diagram |
| `gen_boarding.js` | `make-bus-leaflet/assets/gen_boarding.js` (verbatim) | the fifth output, **"Where to board"** — a place's stops at walking scale plus a destination-keyed index naming the stand. Not a pre-stage and not a wrapper: it is the whole sheet, and it draws no route lines at all |

## Why the wrappers exist

Three small things, all of which would otherwise bite:

1. **Artefact naming.** `src/render/renderMap.js` maps a generator to the SVG it writes; the wrappers are named for `internal-schematic.svg` / `internal-diagram.svg`.
2. **A loud failure.** Both pre-stages are opt-in (`routes.json` → `internalSchematic` / `internalDiagram`) and exit 0 with "nothing to do" when the key is absent, which would leave the portal copying a file that was never written. The wrappers exit non-zero instead — though in practice `resolveGen()` reports the output as *unavailable* for such a map, so it is never attempted.
3. **`LEAFLET_DIR` must not reach the child.** The portal always sets `LEAFLET_DIR` to the map's data folder. A pre-stage spawns `gen_internal.js` with `cwd` = the **workspace** and inherits the environment — and `gen_internal` prefers `LEAFLET_DIR` over `cwd`, so an inherited value sends that render back to the parent folder and silently reproduces the ordinary geographic map. The wrappers delete it for the child and pass everything else (`SKILL_ASSETS` for icons, `OVERRIDES_FILE` for the customer's recolours/POI hides) straight through — which is why a customer's safe-subset edits show up on these sheets too.

## The boarding plan (2026-08-23)

`gen_boarding.js` is here for the same reason the two pre-stages are — it is portal-owned, identical for every map, and no map's render folder ever carried it — but it is otherwise unlike them. It does not re-run `gen_internal.js`, it needs no wrapper (its own name already yields `boarding.svg` through `renderMap.js`), and it reads two inputs nothing else reads: `stands.json` (the NaPTAN stand register for the frame, written by `naptan_stands.py`) and `boarding_index.json` (the destination → stand decision, written by `boarding_index.py`). Both travel with the map's payload, exactly as `routes.json` does; the portal never runs the Python that produces them.

Its output is gated **twice**. `requiresConfig: 'boardingPlan'` is the ordinary opt-in. `requiresFiles: ['stands.json', 'boarding_index.json']` is new, and exists because this generator *exits non-zero* on a missing input rather than drawing an empty sheet — which, without the second gate, would fail the whole map's render instead of leaving one output unavailable.

Two things about it are worth knowing before changing it:

- **A customer's `routeColors` reach it** (2026-08-23), so a route recoloured in the editor is the same colour on all five sheets. **`hiddenOperators` deliberately does not**: the stand a destination is boarded at was decided across every route serving it, so dropping routes here can strand a destination still reachable elsewhere. The generator refuses under `STRICT_GUARDS` rather than half-apply it. If that ever needs to work, the index has to be rebuilt, not filtered.
- **It declines rather than guess.** No `boardingPlan` block, or a stands verdict other than `OK`, and it writes nothing and exits non-zero. That is the same posture `requiresConfig` gives an output whose config key is absent, and it is the product rule: a stand letter we invented is worse than no letter at all.

## Place-map support (2026-08-08)

Both pre-stages work for a **place** map too, not just area: they detect one by checking for `gen_internal_place.js` beside the map's `routes.json` (present because the place engine vendors it — see `engine/place/README.md`), and if found, reproduce that wrapper's two place-specific fixes directly on the workspace output, rather than running `gen_internal_place.js` itself (which resolves `gen_internal.js`/`internal.svg` relative to `DIR`/`cwd` — assumptions the workspace subfolder breaks): the **version stamp** via `LEAFLET_VERSION` set before the run, and the **title** token ("Buses within `<town>`" → "Buses serving `<place>`") swapped on the copied SVG afterwards. Before this fix, a place's schematic/diagram — had one ever been enabled — would have rendered with the wrong, area-shaped title and an unstripped `vv1.x` version stamp; no place map had opted into either output yet, so nothing shipped with the bug. An area map is unaffected (no `gen_internal_place.js` in its data folder, so the place branch never runs) — proved by the byte-identical gate below still passing unchanged.

## The pin editor

`diagram-layout.json` in a map's data folder holds the expert's hand-placed junction pins. It is written by the portal's pin editor (`/app/maps/:id/diagram`, **admin-only**; `src/expert/index.js` + `public/app/diagram.js`, adapted from the skill's `assets/diagram_edit.js`), read by `diagram_internal.js` on every later render, and **carried forward** when a monthly refresh swaps in fresh data (`carryExpertTuning()` in `src/maps/engine.js`) — the engine re-resolves a pin by its stored lat/lon if a node key moved. Previews solve in a per-map sandbox; only Save touches the live map, and it then goes through the ordinary versioned render, so the result is a draft that still needs review.

## Provenance & the gate

Byte-for-byte copies of the skill assets as of the vendor date. `scripts/verify-reproduce-place.mjs` picks the boarding plan up when a place fixture's `routes.json` carries a `boardingPlan` block — proved on `Places/_portal-fixture/High Wycombe High Street` (67,252 B SVG, pixel-identical JPG), and watched go red on a one-character change to the vendored file. `scripts/verify-reproduce.mjs` picks both styles up automatically when the fixture's `routes.json` opts in, and requires the regenerated SVG **and** the re-rendered print JPG to be byte-identical to the shipped ones (proved on St Ives v6.6: schematic 253,112 B / 1,054,471 B, diagram 252,096 B / 1,077,051 B). Re-vendor — re-copy and re-run the gate — if the skill engines change.

> **Pilot.** The schematic and diagram sheets carry a `PILOT — SAMPLE MAP` band, added to the finished SVG outside the engine (`src/render/pilotStamp.js`). Nothing here knows about it and the gated outputs stay byte-identical — see [`../../docs/PILOT.md`](../../docs/PILOT.md).

