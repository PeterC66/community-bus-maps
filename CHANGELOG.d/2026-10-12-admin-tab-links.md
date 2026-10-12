---
date: 2026-10-12
title: "The To-do list's Open buttons now open the admin tab they name"
---

- **The admin console opens the tab a link names.** `/app/admin#refreshes` (or `#applications`, `#requests`, any tab on the page) now lands on that tab instead of To do, and a fragment change while the page is open switches tab too. A missing or unknown fragment still lands on To do.
- **The To-do rows name their tab.** The applications row links to `#applications`, a map request and a build to `#requests`, and both proposed-update rows (our own and a customer's) to `#refreshes`. The BODS refresh-flag row still links to the bare page, because it is a message and not a staged update.
- **Why.** Every one of these rows linked to the bare `/app/admin`, and the page always opened on To do, so the "Open" on "Admin → Refreshes: open the map link for "Huntingdon" …" took the operator back to the row they had just clicked (reported 2026-10-12).
- **A new check.** `npm run test:worklist` now reads the tabs out of `views/app/admin.html` and fails if a worklist link names a tab the page lacks, or if a row for a tabbed queue links to the bare page; it was seen red by stripping the applications row's fragment.
- **What stays the same.** claude-skills' `portal_clicks` already drops a fragment when it names the screen, so the operator's worklist groups these clicks as before. What a customer sees: nothing, the console is admin-only.
