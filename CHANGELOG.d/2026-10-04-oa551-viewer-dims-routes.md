---
date: 2026-10-04
title: "On a sheet built with route tags, picking a route dims every other route in the viewer"
---

- **The viewer gains route focus (buses-data OA-551).** On `/m/<slug>` a click on any route badge, or on that route's button in the new row above the map, keeps that route's ink and badges at full strength and drops every other route to about 15%. The same click again, or Escape, shows every route. The buttons are real buttons with `aria-pressed`, and the choice is announced through the viewer's existing polite live region.
- **A sheet without tags is unchanged.** The viewer offers nothing when the SVG has no `data-route`, so every map in the gallery looks and behaves as before until it is rebuilt with `design.routeTags` on.
- **What it is not.** The Services row's own text lines carry no tag in the SVG, so the row itself is not the click target; its badge is. `scripts/test-route-focus.mjs` drives the logic behind a fake tree, and `prove-red-route-focus.mjs` removes five behaviours one at a time and requires it to fail.
