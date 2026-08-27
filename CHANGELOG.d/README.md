# CHANGELOG.d — one file per change

Write your changelog entry here, not in `CHANGELOG.md`. That file is a generated index and anything you type into it will be overwritten by the next `npm run changelog`.

## Why

`CHANGELOG.md` had reached **2,407 lines** and was touched by **65 of the last 200 commits**. That is two separate problems living in one file. Two sessions working on the same day both append to the same place and conflict every time — and when they do not conflict, one of them quietly carries the other's half-written entry into a commit whose message describes neither. And anybody who opens the file to read the last week pays for two months of history to get there.

Both problems are the file, not the writing. One file per entry fixes both: concurrent sessions write different paths, so git has nothing to merge, and a reader loads a short index plus only the entries they actually want.

## Writing one

Create `CHANGELOG.d/YYYY-MM-DD-short-slug.md`. The date in the filename must match the `date:` in the front matter — `changelog-assemble.mjs` refuses a fragment where they disagree, because a mismatch sorts one way and reads another.

```markdown
---
date: 2026-08-27
title: "The header says where you are"
---

- **What changed, in bold, then why.** The house style is a bullet per claim,
  with the evidence in the same sentence. Look at any existing fragment.
```

Then, from the repository root (`C:\Claude\community-bus-maps`), with no placeholders:

```bash
npm run changelog
```

That rewrites the index in `CHANGELOG.md`. Commit the fragment and the regenerated `CHANGELOG.md` together.

`npm run changelog:check` is the same thing in read-only mode — it exits 1 if the index does not match the fragments on disk, and it runs in CI so an entry cannot be added without the index catching up.

## Rules worth knowing

**The prose is never copied into `CHANGELOG.md`.** The index carries the date, the title and a link. If entries were duplicated into the top-level file this whole exercise would be the same 2,407 lines wearing a new hat.

**A fragment that cannot be parsed is a hard error, not a skipped row.** Missing front matter, a malformed date, an absent title — all fail the run. Silently dropping an entry from the index is exactly the failure this directory exists to make impossible, and a dropped row looks identical to nobody having written one.

**Fragments are not deleted.** There is no "consume on release" step. They are the record; the index is the view.

**Entries before 2026-08-19** were never fragments — they are in [`../docs/_archive/CHANGELOG-to-2026-08-19.md`](../docs/_archive/CHANGELOG-to-2026-08-19.md), split out on 2026-08-27 and not maintained. Three documents cite entries in there by name, which is why it was archived rather than deleted.
