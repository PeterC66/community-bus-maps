---
date: 2026-09-25
title: "A delivery round has a command that ends it in one email per customer"
---

- **`scripts/notify-update-round.mjs` is the caller the update-ready digest was missing (buses-data OA-152).** A round stages each map with `npm run deliver -- … --no-notify`, then runs this once on the VPS with the round's slugs (`--map st-ives,ramsey`) or the proposed-update ids (`--ids`). Each map resolves to its one pending update, and the grouping and wording are the server's own `notifyUpdateRound()`, the code behind `POST /api/admin/notify-update-ready-batch`, so no admin session is needed. `--dry-run` shows who would get which digest, counting recipients without printing them.
- **All or nothing before anything is sent.** An unknown slug, a map with nothing staged or an id that is not pending refuses the whole round with exit 1 and sends no email, so a typo cannot send a digest that leaves a map out. A send is audited as `notify.update-ready-batch`, like the route's.
- **The path points at it.** `propose-update.mjs --no-notify` now prints the command to run at the end of the round, and the headers of `propose-update.mjs` and `deliver-map.mjs` name it.
- **Tested.** `npm run test:notify` runs the script as a child against its scratch database: a dry run plans two digests and resolves a map to its newest pending update; the three refusals exit 1 with no audit row; a real round exits 0 and is audited once with the ids it resolved.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. It adds one ops script and two printed lines. No route, schema, engine or rendered-sheet change, so `verify:area` and `verify:place` do not move, and no customer is emailed by the deploy itself.
