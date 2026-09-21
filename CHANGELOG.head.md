# Changelog

<!-- docstamp v1.0 | 2026-09-03 | sha=04ddfd22 -->
**v1.0** · updated 3 September 2026

Notable changes to BusMaps.uk. Loosely follows Keep a Changelog; dates are ISO (YYYY-MM-DD).

**Every entry is its own file under [`CHANGELOG.d/`](CHANGELOG.d/README.md), and that directory IS the changelog.** This page is the frame around a generated list of them. Write a fragment — a markdown file with a `date:` and a `title:` at the top — and nothing else; it takes about thirty seconds.

**`CHANGELOG.md` is generated and is NOT in git.** It is built from this file plus `CHANGELOG.d/` by `npm run changelog`, run from the repository root, and it is gitignored, so it exists only on the machine that built it. That is deliberate, and it is the second half of a fix whose first half was not enough. Splitting the prose into fragments on 2026-08-27 was meant to stop two sessions conflicting over one file — but the generated index stayed committed, and every commit regenerates it, so the contention moved from 2,407 lines of prose onto one line of index and became **universal**: measured 2026-09-03, **60 of the last 60 commits touched `CHANGELOG.md`**, against 145 of 200 before the split. A derived file in git is a conflict waiting for the next pair of concurrent sessions. Out of git there is nothing to conflict over.

**Where to read it, then.** `CHANGELOG.d/` itself — one file per change, which is what GitHub shows you. Or run `npm run changelog` and open the assembled page locally. Or the admin `/changelog` route on the running site, which builds the list from the fragments on every request and is therefore always current, which the committed file never was.

<!-- changelog-index:start -->

_The index is generated. Run `npm run changelog` from the repository root._

<!-- changelog-index:end -->

---

## Earlier entries

Everything before **2026-08-19** — back to the first `[0.0.1-P0]` release of 2026-07-23, including the `[0.9.0-pilot]` through `[0.0.1-P0]` release sections and the P0–P5 lessons learned — is in [`docs/_archive/CHANGELOG-to-2026-08-19.md`](docs/_archive/CHANGELOG-to-2026-08-19.md). It is not maintained.
