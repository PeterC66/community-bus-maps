# CHANGELOG.d — one file per change

Write your changelog entry here. **This directory IS the changelog** — `CHANGELOG.md` is a generated page built from `CHANGELOG.head.md` plus these fragments, and since 2026-09-03 it is **gitignored**, so it exists only on the machine that built it. Anything you type into it is overwritten by the next `npm run changelog` and would not have been committed anyway.

## Why

`CHANGELOG.md` had reached **2,407 lines** and was touched by **65 of the last 200 commits**. That is two separate problems living in one file. Two sessions working on the same day both append to the same place and conflict every time — and when they do not conflict, one of them quietly carries the other's half-written entry into a commit whose message describes neither. And anybody who opens the file to read the last week pays for two months of history to get there.

Both problems are the file, not the writing. One file per entry fixes both: concurrent sessions write different paths, so git has nothing to merge, and a reader loads a short index plus only the entries they actually want.

## Why the index left git too, on 2026-09-03

**The split above did not stop the conflicts, and this README used to say it had.** It claimed the index was safe because it is sorted deterministically, "so two sessions regenerating independently produce identical bytes". That is false and was false the day it was written: determinism means the same FRAGMENT SET produces the same bytes, and two concurrent sessions have different sets, by one file each — so their indexes differ by one line, in the same place, which is the definition of a conflict.

**It was measured rather than argued.** On 2026-09-03, **60 of the last 60 commits touched `CHANGELOG.md`**, against 145 of 200 before the split. The split moved the contention off 2,407 lines of prose and onto one line of index, and made it *universal*: before, only a commit with something to say touched the file; after, every commit regenerated it. Portal PRs #215 and #216 collided on exactly that line, and both sessions had declared their files to each other without either one naming it.

**So the derived file left git.** `CHANGELOG.head.md` is tracked and holds the prose; `CHANGELOG.md` is generated and ignored. Nothing derived is in git, so nothing derived can conflict — and the fragments, which are what you actually write, never conflicted in the first place.

A git merge driver was written first and thrown away. It worked, and it is the wrong shape: not having a conflict beats resolving one automatically, and it needed a `git config` line in every clone that git silently ignores when somebody forgets. Two things learned building it are worth keeping, because neither is obvious. **A merge driver cannot see the other side's new files** — at the moment git invokes one, `git ls-files`, the working tree and `git ls-tree HEAD` all hold your side only, and `git rev-parse MERGE_HEAD` fails outright, because MERGE_HEAD is written *after* the merge attempt. And **GitHub's server-side merge does not use local merge drivers at all**, so a PR would have gone on showing as conflicting whatever the driver did.

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

That rebuilds the local `CHANGELOG.md` from `CHANGELOG.head.md` and these fragments. **Commit the fragment only** — `CHANGELOG.md` is gitignored, and running the generator at all is optional, for when you want the assembled page in front of you.

`npm run changelog:check` validates the FRAGMENTS — front matter present, the filename agreeing with its own `date:`, and no two names differing only in case, which are two files on this laptop and one on the Linux server. It runs in CI and in `npm test`. It no longer asks whether an index is stale, because there is no committed index to be stale.

## Rules worth knowing

**The prose is never copied into the generated page.** The index carries the date, the title and a link. If entries were duplicated into the top-level file this whole exercise would be the same 2,407 lines wearing a new hat.

**To read the changelog** without generating anything: this directory, which is what GitHub shows you; or the admin `/changelog` route on the running site, which builds the list from these files on every request and is therefore always current — which the committed index never was, being only ever as fresh as the last person who remembered to run the generator.

**A fragment that cannot be parsed is a hard error, not a skipped row.** Missing front matter, a malformed date, an absent title — all fail the run. Silently dropping an entry from the index is exactly the failure this directory exists to make impossible, and a dropped row looks identical to nobody having written one.

**Fragments are not deleted.** There is no "consume on release" step. They are the record; the index is the view.

**Entries before 2026-08-19** were never fragments — they are in [`../docs/_archive/CHANGELOG-to-2026-08-19.md`](../docs/_archive/CHANGELOG-to-2026-08-19.md), split out on 2026-08-27 and not maintained. Three documents cite entries in there by name, which is why it was archived rather than deleted.
