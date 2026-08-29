---
date: 2026-08-29
title: "Granting an output now renders it"
---

- **Granting the boarding plan took three acts, and the first one produced nothing (OA-007).** Walked for real on the St Ives Bus Station import, 2026-08-24: `PATCH /api/maps/14/outputs` set `boarding_plan: true`, returned **200**, and wrote no file at all — `renders/v1.0/` still held only the internal and external sheets. The sheet appeared only after a second delivery of the same S5 was staged as a proposed update and **accepted**, because accept is what renders. The working sequence was grant → re-deliver → accept → publish, and two of those four steps existed purely to make a flag take effect.
- **The grant now renders a new version when — and only when — the file is missing.** That sequence collapses to grant → publish.
- **The condition is the FILE, not the output's flags.** A `buildAlways` sheet (the schematic) is already in every version's folder, so enabling it stays an instant, free visibility change; a `requestOnly` one usually is not. But "expert", "request-only" and "build-always" are all proxies for the real question, and a map that happens to carry the file for some other reason should not be re-rendered either.
- **It writes a NEW version rather than adding a file to the signed-off one.** A published version's bytes are the bytes an approver reviewed, and nothing here rewrites them. The version is noted "Added Where to board" and audited as a save, because that is what it is.
- **A render failure does not revert the grant.** The flag was what was asked for and it succeeded; the response says the sheet was granted, that rendering it failed, and that the next save will produce it — rather than silently undoing an admin's decision.
- **Refused while a publication awaits review,** with the same reasoning the save route uses: adding a sheet moves the head, and an approver must always be reviewing the head.
- **The rule moved into `engine.js` and is pure, so it is testable without a server** — the same separation `chooseOutputs()` already has.
- **Three of the four new assertions were green against a broken rule when first written.** They shared one version folder, so a case meant to test the payload clause was satisfied by the file clause instead. Each case now uses the folder that isolates it, and each clause has been watched go red on its own fault. That is the finding worth keeping: a test that passes for the wrong reason looks exactly like one that passes.
