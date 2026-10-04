---
date: 2026-10-04
title: "A map note can find its own clear ground"
---

- **Re-vendors `engine/note_place.js` (new) and `engine/place/gen_internal.js` from claude-skills #297 and #298 (buses-data OA-437), in portal #475 and #476.** `engine/vendored.json` is restamped, with `note_place.js` added as a vendored file.
- **What changed in the engine.** A `mapNotes` entry with no `x`, `y` or `at` is now placed by search: the widest wrap that finds a spot with no reserved box and no route ink under it, nearest the entry's `near` hint, else the bottom-left of the frame (#475). A searched entry can also carry `then` paragraphs, laid out with it as one block so a heading and its lines never land in different corners (#476). A note with a typed coordinate is not touched, and one with nowhere clear is drawn at its hint and warned about.
- **No gate fixture moves.** No stored note lacks a coordinate or carries `then`, and `verify:place` reproduces all four place sheets byte for byte.
- **What a customer sees.** Nothing yet. A map picks this up the next time it is rebuilt with a note that leaves its position to the engine.
