# Conventions — community-bus-maps

<!-- docstamp v1.3 | 2026-09-02 | sha=f233ff30 -->
**v1.3** · updated 2 September 2026

The single sheet that settles the questions a script author would otherwise answer differently each time: what a flag is called, what an exit code means, which stream carries what, how a script that changes something asks permission, and which Node this repository runs. It describes what is **already true here** wherever there is a majority practice, and says so plainly where there is not.

It is one of three, one per repository. The other two are `make-bus-leaflet/references/conventions.md` in the **claude-skills** repository and `Documentation/README - Conventions.md` in **buses-data** — named rather than linked, because a relative link that climbs out of this repository resolves on the one laptop that has all three checked out side by side and 404s for everybody else. Where a rule is shared, all three say the same thing; where a repository genuinely differs (the portal is PR-per-change, `buses-data` is direct-push) each says its own.

**Writing this page settles the questions. Adopting it is item by item, in OA-224 Tier 3** — a script that disagrees with this page is not a bug to be fixed on sight, it is a migration that belongs in the item that owns that script.

## Exit codes

| Code | Means | Example |
|---|---|---|
| `0` | It worked, or the check found nothing wrong | any passing test |
| `1` | The thing being checked or done FAILED — the answer is "no" | a red test, a gate that found drift |
| `2` | The SCRIPT was used wrongly, or its own invariants are broken — the answer is "I cannot tell you" | a missing required flag, an exclusion list with no reason |
| `3` | The INPUT you pointed it at is not the shape it claims to be | `propose-update.mjs --src` pointing at a folder carrying no generator; `import-map.mjs` finding the vendored engine absent |

The distinction that matters is 1 against 2. A caller that treats every non-zero as "it failed" will report a typo in a flag as a broken map. `3` is a narrower case of the same idea and is used deliberately in two scripts; it is not a general-purpose code, and a new script should reach for `2` unless it genuinely needs to separate "you called me wrongly" from "what you pointed me at is wrong".

**A check that cannot find its subject must exit non-zero, never report clear.** This is the oldest rule here and it is why `test-contrast.mjs` fails when a selector it names is renamed rather than passing on zero cases.

## Streams

- **stdout carries the answer** — the verdicts, the counts, the thing a caller might parse or pipe.
- **stderr carries the reasons** — refusals, warnings, and anything explaining a non-zero exit.
- **A successful run is allowed to speak.** Do not read stderr only on failure: a script that warns on a zero exit is warning about something, and a caller that reads stderr only when the exit code is non-zero will never see it. Decide, per script, what a working run may tell you, and say so in its header.

## Flags

- `--apply` for a **local** mutator: the script does nothing but report by default, and only writes when `--apply` is given. This is the majority practice in `scripts/` (`grep -l "\-\-apply" scripts/*.mjs` counts them; `check-vendored --update` is the older spelling of the same idea).
- `--dry-run` plus `--yes` for anything that touches the **VPS**: the default is to do it, so the safety has to be the confirmation rather than the default. `--dry-run` shows the plan; `--yes` is the confirmation that lets it run unattended.
- The asymmetry is deliberate. A local mutator that runs by accident costs a `git checkout`; a deploy that runs by accident costs the live site, so it must be impossible to trigger without saying so.
- `--check` is the read-only form of a generator (`changelog-assemble --check`). It exits `1` when the generated file is out of date, which is what makes it a CI step.
- Long flags only, spelled `--like-this`. A flag that takes a value takes it as the next argument (`--only search`), not `--only=search`.
- **Read them with `scripts/lib/cli.mjs`** — `arg`, `has`, `all`, `die` and `confirm` (2026-09-02, OA-224 Tier 3.3). Thirteen scripts each had their own three-line reader in four spellings, and `confirm('local' | 'remote')` is the two vocabularies above as one function, so a script cannot invent a fifth.
- **A flag's value may not itself begin with `--`.** `--note --quiet` sets no note and leaves `--quiet` visible; before the shared reader it set the note to the string `"--quiet"` and swallowed the flag, silently, on scripts that write to the VPS. `argAllowingDashes` exists for a value that legitimately looks like a flag, and nothing here passes one.
- Keep an old flag working as an alias when you rename one. A flag name is an interface with CI, the runbooks and a person's muscle memory.

## Naming

- `test-<thing>.mjs` — an assertion suite. `prove-red-<thing>.mjs` — the harness that breaks `<thing>` on purpose and requires each mutation to redden the assertion that names it. `check-<thing>.mjs` — a gate that reads state and reports. A script that does something is a verb (`import-map.mjs`, `propose-update.mjs`, `rotate-secret.mjs`).
- The npm script is `test:<thing>` / `check:<thing>` for the matching file. **`npm test` discovers its tests** rather than listing them — see [`npm test` discovers its tests](DEVELOPING.md#npm-test-discovers-its-tests---adding-one-means-adding-the-file).
- Shared helpers go in `scripts/lib/<thing>.mjs` and are imported, never copied. `src/` is the running service; `scripts/` is everything run by a person or by CI.

## Importing for a path must not open a database

**`src/db/index.js` opens the SQLite file, applies `schema.sql` and runs every migration at module load.** Import it when you need `db`, and never for a constant: `src/db/paths.js` exports `DATA_DIR`, `DB_PATH` and `MAPS_DIR`, imports nothing but `node:path` and `node:url`, and is what a script that only reads files off disk should use. Three scripts were migrating the live database as a side effect of wanting to know where `data/maps` is, and two more had already noticed and worked around it by re-deriving the path with a comment saying why — which is how a fourth spelling of it gets written (2026-09-02, OA-224 Tier 3.3).

**One SHA-256, in `src/hash.js`.** `sha256` and `tokenHash`; a raw bearer token is never written to the database, and `tokenHash` takes the raw token so no caller can forget. It was spelled out at ten sites, two of which were the same security primitive under two names — a token hashed on the way in by one and looked up by the other, so the day the two differ every session stops resolving and nothing says why. The two audit tests still compute the hash themselves, deliberately: an independent computation in a test is the control, and a test using the function under test can only tell you it is deterministic.

## Routes

A section of `src/server.js` that is one audience behind one guard is a Fastify plugin in `src/routes/`, registered with its prefix and carrying the guard as a plugin-level `preHandler`, so a handler in that file cannot be added without it (OA-231, 2026-09-02; the admin console was first, the review gate second). A route that is the exception to its file's guard declares it as route config the guard reads — `{ config: { operatorRead: true } }` — never as a second call site. Route files import what they need from `src/http/helpers.js` and `src/maps/detail.js`; nothing in `src/routes/` reaches into `server.js`. The route table the app registers is recorded in `scripts/route-table.json` and asserted by `scripts/test-admin-plugin.mjs`; a cut that changes no route keeps that file byte-identical, and a change that does must re-record it in the same commit. **That snapshot has ONE owner and later cuts do not re-assert it** — a second copy of the assertion is a second thing to keep in step; a new section's own test adds only the door its guard is responsible for.

## Node

**Node 24.** The Dockerfile's base image is `node:24-slim`, pinned by digest, and all four workflows install 24. `node:sqlite` is the store and is still flagged experimental, so the runtime is not a free variable.

`package.json`'s `engines` still says `>=22`, which is looser than anything that is actually tested. That divergence is real and is OA-224 Tier 5's "one Node 24 pin everywhere"; it is named here rather than fixed here so that this page describes one rule and the migration is a change somebody can gate.

## Git

**PR per change, always.** The portal is a public-facing service and `main` deploys from it; there is no direct push. This is the opposite of `buses-data`, which is direct-push to `main` — the two repositories sit side by side in this account and the convention is per repository, so check which one you are in before pushing.

**Read the POST-merge run, not the PR's own green checks.** A PR is tested against the base it was cut from, and branch protection is not available on a private repo without GitHub Pro, so nothing requires a branch to be current before merging.

**Push `buses-data` before opening a portal PR that depends on it.** `verify.yml` checks out `buses-data` with no `ref:`, so a PR's byte gate runs the PR's engine against whatever is on that repository's `main` at that moment.

## Documents

Markdown paragraphs are **one continuous line** — never hard-wrap prose; a newline means a semantic break. Any script written into a document states the folder to run it from and explains every placeholder, or says there are none. Cite another document's section by **anchor**, not by naming it in prose, so the link is in the class a checker can verify.

Every change gets a `CHANGELOG.d/<date>-<slug>.md` entry; `npm run changelog` rewrites the index and `changelog-assemble.mjs --check` is in `npm test`, so an entry cannot land without the index catching up.
