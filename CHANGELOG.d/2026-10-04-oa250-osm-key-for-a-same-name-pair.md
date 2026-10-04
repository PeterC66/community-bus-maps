---
date: 2026-10-04
title: "A same-name pair of places is answered by its element id"
---

- **The landmark chooser keys a place by its OpenStreetMap element id (`osm:<type>/<id>`) only where its `<cat>:<name>` is shared with another candidate.** Two Aldis a kilometre apart used to share the one key `shop:Aldi`, so a customer could answer both or neither; each now has its own row and its own answer. Every place nobody shares a name with keeps its `<cat>:<name>` key, so no answer already given moves (buses-data OA-250, step 3; the engine has read an `osm:` key first since claude-skills #197).
- **`editablePoiKeysFromDir()` lists every candidate's `osm:` key beside its `<cat>:<name>`,** so the safe subset accepts the answer and the next save does not strip it. `scripts/test-landmark-tiers.mjs` asks it on a fixture of two Aldis and a Boots, and was seen to go red with `answerKeys()` reduced to `p.key`.
- **Not done:** the editor's tick box, `/poi-tiers` and `diffLandmarks()` still speak `<cat>:<name>`; that is the rest of OA-250.
