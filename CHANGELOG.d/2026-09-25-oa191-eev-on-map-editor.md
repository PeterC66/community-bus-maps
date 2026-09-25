---
date: 2026-09-25
title: "The editor's-eye view now reaches the map editor"
---

- **The map editor page loads the editor's-eye toggle (buses-data OA-191, §H9).** The toggle, built 2026-08-12 in `259f54f`, worked on the dashboard, the review page and the admin console, but `views/app/editor.html` never loaded `public/js/editor-eye-view.js`. Its Admin nav link and the admin-only owner panel already carried `data-eev-hide`, so an admin who switched the view on and opened a customer's map still saw both, and no banner. The page now loads the script before `editor.js`, and `editor.js` calls `EEV.apply()` once the role-based nav is shown, the same pattern `app-dashboard.js` and `review.js` follow. That call also covers the owner panel: `buildOwnerPanel()` unhides it through the `hidden` attribute, and the toggle's inline `display: none` still wins over that.
- **Presentational only.** There is no auth, route, schema, engine or rendered-sheet change. An admin keeps every permission underneath.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live, deployed by the scheduled loop's `sched-2124` tick. The live site read `0.10.0-pilot+8a89cd1` before it, which is `origin/main` at the time of writing, so nothing else goes with it. **The §3a reading that can see it is `X-App-Version`**, which must move off `8a89cd1` to the merge, and the served `/app/maps/<id>` page must carry `/js/editor-eye-view.js`.
