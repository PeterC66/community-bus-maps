---
date: 2026-10-10
title: "Old versions of a map can be retired, and the row stays"
---

- **`scripts/prune-versions.mjs` retires the earlier versions of a map that piled up in development (buses-data OA-572, step 1).** It removes a version's render folder and stamps the new `map_version.retired_at` column; the row stays, so `nextVersion()` never hands the number out again, the publish request that carried its sign-off still has a version to point at, and `dataChangesSince()` still walks its refresh. That is Peter's ruling of 10 October: retire, not erase. Dry run by default, `--yes` to act, one `version.retire` audit row per version, and `--all` lists every map and refuses to act.
- **What may go is decided in one place, `src/publish/retire.js`, so the admin button, the editor button and the managed-customer retention job still to come cannot disagree with it.** The published version, the working head, the revert target, the highest number and anything under review are never retirable. A version that was never published may be retired by an editor; one that was published and since superseded only by an admin, with a reason, because its immutable one-year-cached URL will 404.
- **The editor's version list leaves retired versions out**, since they have nothing left to show, download or compare; the revert picker already refused a version whose files are gone. `SCHEMA_VERSION` is 8; a v7 release reads a v8 database and simply lists a retired version again, with no downloads.
- **`npm run test:prune-versions` asks the rule case by case and runs the script against a throwaway portal; `npm run test:prove-red-prune-versions` breaks nine things and requires the test to refuse each one for its own reason.**
