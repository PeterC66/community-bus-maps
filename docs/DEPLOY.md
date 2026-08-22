# Deploying and running the portal (P7)

<!-- docstamp v1.23 | 2026-08-22 | sha=0d2d6fb0 -->
**v1.23** · updated 22 August 2026

Small service, deliberately: **one Node process, one SQLite file, one data volume.** No database server, no queue, no build step. Scale by giving the VM more disk, not by adding components — the plan says single-VM until something actually binds.

Everything below assumes the decisions already locked in the planning docs: build locally, choose the host at launch; the render pipeline must stay byte-identical.

---

## 1. What has to persist

| Path (under `DATA_DIR`) | What it is | Backed up? |
|---|---|---|
| `portal.sqlite` (+ `-wal`, `-shm`) | customers, users, maps, versions, publish requests, proposed updates, audit | **yes** |
| `maps/<id>/data/` | the map's payload + generators + expert `diagram-layout.json` | **yes** |
| `maps/<id>/overrides.json` | the customer's canonical safe-subset edits | **yes** |
| `maps/<id>/renders/v*/` | every rendered version, **including the bytes an approver reviewed** | **yes** |
| `maps/<id>/proposed/<pid>/` | a staged monthly refresh | no — re-stageable centrally |
| `maps/<id>/archive/` | data replaced by an accepted refresh | no — superseded |

Nothing in this list is in git, and nothing in git is needed at runtime beyond the application itself.

## 2. Environment

Copy `.env.example`. The ones that matter in production:

| Variable | Why |
|---|---|
| `DATA_DIR` | the volume above. **Set it explicitly** — the default is `./data` inside the app dir |
| `HOST` / `PORT` | bind address; behind a proxy, `127.0.0.1:5180` |
| `PUBLIC_BASE_URL` | the public origin, used by `robots.txt` + `sitemap.xml` (P6) |
| `EMAIL_PROVIDER` / `EMAIL_FROM` / `RESEND_API_KEY` | magic-link delivery via Resend (`src/email/resend.js`, the only provider wired up). **Unset `EMAIL_PROVIDER` means sign-in links are printed to the log** — fine in dev, not in production. Needs SPF/DKIM at 20i for `EMAIL_FROM`'s domain. |
| `METRICS_TOKEN` | set to expose `/metrics`; unset and the endpoint 404s |
| `STATUS_TOKEN` | set to accept `POST /api/admin/status` (the laptop's `push-status.mjs`); unset and it 404s |
| `PILOT_MODE` | **defaults ON.** Banner on every page and a band on every rendered sheet. Set to `0` to switch all of it off — see [`PILOT.md`](PILOT.md). Does **not** control indexing; that is `ALLOW_INDEXING` below |
| `ALLOW_INDEXING` | **defaults OFF.** While off, `robots.txt` serves `Disallow: /` and the site cannot be found in a search engine. Set to `1` to become discoverable. Independent of `PILOT_MODE` since 2026-08-21, so the site can be indexed while still honestly labelled a pilot — see `src/config.js` §INDEXING |
| `ALLOW_SELF_APPROVAL` | **must be `1` on this host today, or nothing can be published.** Since 2026-08-20 an approver who submitted a version is refused when they approve it (`technical-audit_2026-08-19` S6). With one operator that means every publication, so the override is set — and each publication made under it is stamped `selfApproved: true` in the evidence and the audit row. Unset it the day a second person holds `approver`. |
| `ADMIN_EMAIL` | the address `npm run smoke:signin` sends its one real magic link to after a deploy. Must be a **registered, active** user, or no send is attempted and the check cannot pass. |

## 3. Run it

```bash
export GIT_SHA=$(git rev-parse --short HEAD) BUILT_AT=$(date -u +%FT%TZ)
docker compose up -d --build
```

The two exports stamp the build into `/health`, the site footer and every render's `meta.json`
(GO-LIVE.md §5) — harmless to skip, but then those fields all read `unknown`/blank.

Or without containers (systemd on a plain VM):

```ini
# /etc/systemd/system/cbm-portal.service
[Unit]
Description=BusMaps.uk portal
After=network.target

[Service]
Type=simple
User=cbm
WorkingDirectory=/opt/community-bus-maps
Environment=NODE_ENV=production
Environment=DATA_DIR=/var/lib/cbm
Environment=HOST=127.0.0.1
Environment=PORT=5180
ExecStart=/usr/bin/node src/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Put nginx/Caddy in front for TLS and the public hostname. Two proxy details the app relies on: forward `X-Forwarded-Proto` (the session cookie is marked `Secure` when the request is HTTPS) and don't strip `/api/` or `/m/` paths.

### 3a. Security headers live in the Caddyfile, and they are deployed separately

The `Caddyfile` in this repo carries the site's security headers - HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and a strict Content-Security-Policy (added 2026-08-19; until then every response carried none of them, `technical-audit_2026-08-19` S1). **This file is not deployed by `deliver-map.mjs`, `deploy.mjs` or the container build.** Caddy runs on the host, outside Docker, so shipping a new app image does nothing to it. If you change the `Caddyfile` you must copy and reload it yourself, or the change simply never happens.

**The whole thing is one command.** From `C:\Claude\community-bus-maps` (the repo root):

```bash
npm run deploy:caddy
```

That copies the `Caddyfile` up, installs it, runs `caddy validate`, reloads Caddy only if validation passed, and then reads the live headers back to prove the reload actually took effect. It gets the host and key from `.env`, so there is nothing to look up. To check the live headers without changing anything:

```bash
npm run deploy:caddy -- --check
```

**Why the verify step is not optional:** a reload that silently kept the old config looks exactly like a successful one. On 2026-08-20 the app was deployed and the `Caddyfile` was not, and the site ran for a while with the headers merged, the deploy reported done, and every response still carrying none of them. Only reading the headers back tells the two apart.

The manual sequence below is what that command does, kept for when something goes wrong in the middle of it.

**Getting onto the VPS from the laptop.** From `C:\Claude\community-bus-maps` (the repo root):

```bash
npm run ssh
```

That reads `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `DEPLOY_APP_DIR` out of `.env` and drops you into a shell already in the app directory, so there is no hostname or key path to remember. To run a single command without opening a shell, quote it as one argument after `--`:

```bash
npm run ssh -- "docker compose ps"
```

**Copying the Caddyfile up.** Also from `C:\Claude\community-bus-maps`, and note the trailing `:` on the destination - it means "your home directory on that host". `%DEPLOY_HOST%` is a placeholder for whatever `DEPLOY_HOST` is set to in `.env` (of the form `user@host`); substitute it by hand, since `scp` does not read `.env`:

```bash
scp Caddyfile %DEPLOY_HOST%:
```

**Then, in the shell that `npm run ssh` opened**, install and reload it. `~/Caddyfile` is where the `scp` above just put it; `/etc/caddy/Caddyfile` is fixed and is where Caddy actually reads from:

```bash
sudo cp ~/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`caddy validate` before `reload` on purpose: `reload` on a malformed file leaves the previous config running on some versions and fails the site on others, and finding out which by experiment is not a thing to do to a live site.

Then check from the **laptop** that the headers actually arrive, because a reload that silently kept the old config looks exactly like success:

```bash
curl -sI https://busmaps.uk/ | grep -iE "content-security-policy|strict-transport|x-content-type|referrer-policy|permissions-policy"
```

The CSP is strict (`script-src 'self'`, no `'unsafe-inline'`) and the site is built to stay inside it: there are **no inline `<script>` blocks anywhere in `public/`**, and three that used to exist were moved out to `/js/contact-kind.js`, `/js/app-dashboard.js` and `/js/app-login.js` on 2026-08-19 to keep it that way. If you add an inline script, the browser will silently refuse to run it and the page will half-work. Add a file under `public/js/` and a `<script src=... defer>` instead. After any change to a page's scripts, open `/`, `/maps`, `/m/<slug>` (any published map - `<slug>` comes from `/api/public/maps`), `/app/login.html` and a signed-in `/app`, and confirm the browser console shows no `Refused to ...` lines.

There is a way to test the whole header block without touching the live site or installing Caddy locally: run the portal (`npm start`, from the repo root) and put a proxy in front of it that reads the header values straight out of the `Caddyfile`. That is how this block was checked before it was first deployed - including confirming the CSP *blocks* an injected inline script, rather than only confirming the pages still load.

## 4. Smoke test after every deploy

```bash
curl -fsS localhost:5180/health?deep=1 | head -40
```

`?deep=1` is the **readiness** probe, not a ping: it queries the database, writes and deletes a probe file in `DATA_DIR`, checks the vendored engine files (including the P7 expert styles), rasterises a tiny image through sharp, and — since 2026-08-20 — checks that email is **configured** (`technical-audit_2026-08-19` O4: sign-in is the only door into this system, and a deployment that cannot email is one nobody can sign in to). It returns **503** if any of those fail, so it is what a load balancer and the container `HEALTHCHECK` should use.

**What it tells whom (S4, done 2026-08-20).** An anonymous caller now gets four fields — `status`, `service`, `version`, `time` — and nothing else. It used to hand anybody the git SHA, the build time, the exact sharp and libvips versions, the object-store path and eleven business counts, which is a CVE-targeting aid plus a public read-out of how small the operation is. Add `?token=$METRICS_TOKEN` (or a `Bearer` header, or an admin session) to get the whole thing back, including `checks{}`.

**The verdict stayed public on purpose, so nothing had to be reconfigured.** `?deep=1` still runs for an anonymous caller and still returns 503 when a dependency is down; only the per-check detail is gated. That is what the warning in the previous version of this section was about — gating the verdict would have turned every Uptime Robot poll into a 401 and paged about a fault that did not exist. Do not undo that without changing the monitor and the Dockerfile `HEALTHCHECK` in the same commit.

This URL is monitored from outside: an **Uptime Robot** check polls `https://busmaps.uk/health?deep=1` every five minutes and alerts by email (set up 2026-08-20, `technical-audit_2026-08-19` O2 — the alert address is recorded in `community-bus-maps-ops`, not here). It is not a free ping, so tightening the interval multiplies the rasterisations this box does.

**Readiness is not proof that anyone can sign in.** It checks that email is configured, not that the provider will accept a message today. `npm run deploy` therefore ends by running:

```bash
npm run smoke:signin
```

from the repo root on the laptop (`C:\Claude\community-bus-maps`). It POSTs one real sign-in request for `ADMIN_EMAIL` to the running service and then reads the **server log** for `magic link emailed` — the HTTP response is deliberately identical whether or not the address is registered, so it cannot be the evidence. It exits non-zero on a 503, on a provider that threw, on a link that went to the console instead of an inbox, and on no matching log line at all. `npm run deploy -- --skip-signin` skips it, and then nothing has proved a real sign-in email can be sent.

Then, signed in as an admin, open **`/app/admin` → Ops**: dependency health, per-map disk usage, what a prune could reclaim, and the activity counts. Same numbers as `/metrics` (Prometheus text, gated by `METRICS_TOKEN` or an admin session).

## 5. Backups

```bash
npm run backup -- --out /backups --keep 14        # or: docker compose run --rm backup
```

The database is copied with SQLite's `VACUUM INTO`, which writes a **consistent** copy of a committed state while the server is running — copying `portal.sqlite` with `cp` under WAL can capture a torn file plus a stale `-wal`, so don't. Each run writes `<out>/<timestamp>/` with `portal.sqlite`, `maps/<id>/{data,renders,overrides.json}` and a `manifest.json`, then prunes to `--keep` newest. Run it from cron/a timer daily, and keep at least one copy **off the box**.

### Restore drill (do it once, before you need it)

If running under `compose.yaml` as written (a named volume, not a bind mount at `/var/lib/cbm` —
that path was this section's original assumption; performed for real 2026-08-09 and corrected to
match what's actually deployed):

```bash
docker compose stop portal

# Snapshot the live volume for diagnosis before touching it, then restore from a backup.
# (DATA_DIR is /data inside the container; the volume name is <project>_portal-data.)
docker run --rm -v community-bus-maps_portal-data:/data \
  -v /opt/community-bus-maps/backups:/backups:ro alpine sh -c '
    mkdir -p /tmp/broken && cp -a /data/portal.sqlite* /tmp/broken/ 2>/dev/null
    rm -f /data/portal.sqlite /data/portal.sqlite-wal /data/portal.sqlite-shm
    cp -a /backups/<timestamp>/portal.sqlite /data/
    cp -a /backups/<timestamp>/maps /data/ 2>/dev/null || true
    chown -R 1000:1000 /data
  '

docker compose up -d portal
curl -fsS localhost:5180/health?deep=1
```

If running under a plain bind mount instead (`DATA_DIR=/var/lib/cbm`, systemd unit, no Docker):

```bash
systemctl stop cbm-portal
mv /var/lib/cbm /var/lib/cbm.broken  # keep the bad state for diagnosis
mkdir -p /var/lib/cbm
cp -a /backups/<timestamp>/portal.sqlite /var/lib/cbm/
cp -a /backups/<timestamp>/maps         /var/lib/cbm/
systemctl start cbm-portal
curl -fsS localhost:5180/health?deep=1
```

Then check a published map's public page still serves the same file sizes as before — the published bytes are the promise, so that is the real "restore succeeded" test. There is **one writer**: stop the server before any script that writes SQLite (`seed-demo`, `import-map`, `propose-update`) and before restoring.

**Drilled for real 2026-08-09** against the live host (at that point carrying only one admin user,
so a safe moment to actually destroy and restore rather than merely rehearse): stopped the portal,
deleted `portal.sqlite` from the running volume, restored from that day's `docker compose run --rm
backup` snapshot, restarted, and `/health?deep=1`'s `users: 1` confirmed the admin account survived
the round trip.

## 6. Housekeeping

```bash
npm run prune:staged -- --days 90             # dry run by default; add --yes to delete
```

Removes staged payloads of **settled** monthly refreshes and the data an accepted refresh replaced, once they are older than `--days`. It never touches a pending update, a map's live data, or any rendered version. The Ops tab shows how much it would free.

Sessions expire themselves (the server purges hourly). Nothing else grows unbounded except renders, which are kept on purpose — every version stays downloadable.

## 7. Upgrading the app

**Two things about the image changed on 2026-08-20 and both bite silently if missed.**

The Dockerfile's `FROM` is now **pinned by digest** (`node:24-slim@sha256:3638d9a6…`), because it said "pinned by digest-able tag" above a floating tag and a rebuild months apart could move the very bytes the product guarantees — which is not hypothetical, it is what the Liberation Mono incident was (`technical-audit_2026-08-19` V6). Bump it from Dependabot's monthly `docker` PR or with `docker buildx imagetools inspect node:24-slim`, run from anywhere; record the new digest in `CHANGELOG.md`, and re-run `npm run verify` before deploying, because a base-image change is a rasteriser change until proved otherwise.

**After any rasteriser change — a `sharp` bump or a base-image bump — check the sheets you have already published**, on the host, where the bytes actually live:

```bash
npm run ssh -- "cd /opt/community-bus-maps && docker compose run --rm portal node scripts/rerasterize-stored.mjs --check"
```

Run from the repo root on the laptop (`C:\Claude\community-bus-maps`); `/opt/community-bus-maps` is `DEPLOY_APP_DIR` on the host. It writes nothing — it re-rasterises each stored SVG to a scratch file and reports whether the bytes would change. If any would, **look at one of the changed sheets before doing anything else**: the Liberation Mono incident moved bytes too, and every sheet was wrong. Then `--apply` to bring the stored files back in line, and record it in `CHANGELOG.md`.

**Run for `sharp` `0.34.5` → `0.35.3` on 2026-08-22, against the real store: 152 stored JPGs, 0 would change, 0 failed.** That closes the question the bump left open — it had been shown to move no bytes on Windows, which is not the same claim as no bytes on `node:24-slim`, and until this run nobody had asked the host. No `--apply` was needed and no re-baseline follows.

**The rule when byte continuity and a security patch pull apart: the patch wins.** `sharp` carried a high-severity advisory for weeks on the grounds that the bytes are a product guarantee. A re-baseline is a normal, announced, recoverable event; an unpatched image parser in production is not. (In the event, `0.34.5 → 0.35.3` moved no bytes at all — but that was the outcome, not the reason.)

The image also copies a new top-level **`views/`** directory holding the signed-in app's HTML shells, which moved out of `public/` so `@fastify/static` can no longer serve them (S7 — `/app/admin.html` returned 200 to anyone while `/app/admin` correctly redirected). Miss that `COPY` line and every `/app` page 404s while the public site looks perfectly fine.

1. `npm ci` (respect the lockfile — see the sharp warning below), then **`npm test`**.
2. **`npm run verify`** with `FIXTURE_DIR` + `PLACE_FIXTURE_DIR` pointing at the private fixtures. This is the release gate: it re-renders the area map, the place map **and the two expert styles** and requires them to be byte-identical.
3. Deploy, then `/health?deep=1`.

**The sharp/libvips warning is not boilerplate.** The print JPG is the product; a different libvips build can encode the same SVG to different bytes, which would silently break "the file we serve is the file that was approved". Treat any `sharp` bump as a change that must pass step 2 on the target platform before it ships.

## 8. Licensing gate

`docs/LICENSING.md` lists the data sources and what must be credited (the **bustimes.org terms** question is resolved — see LICENSING.md §3). It is a launch go/no-go, not a footnote: the review lines at the bottom of that file are meant to be filled in before the public site is announced.

## 9. The live host, as built (2026-08-09)

Everything above is the general recipe. This is the as-built record of the one host that actually
exists, for picking this up cold — VPS/DNS decision rationale lives in `GO-LIVE.md`, this is just
"how do I get back in and what state is it in".

- **Host:** OVHcloud VPS, Ubuntu 26.04, IP + access details in `community-bus-maps-ops/OVHCloud settings.txt`
  (outside this repo — operator-only). User `ubuntu`, password auth and root login disabled.
- **SSH key:** a dedicated keypair at `~/.ssh/busmaps_vps` on the laptop (not the default identity —
  pass `-i` explicitly, or rely on `.env`'s `DEPLOY_SSH_KEY` for `scripts/deliver-map.mjs`).
- **App directory:** `/opt/community-bus-maps`, a plain `git clone` (not a deploy artifact) —
  `git pull && export GIT_SHA=$(git rev-parse --short HEAD) BUILT_AT=$(date -u +%FT%TZ) && docker
  compose build portal && docker compose up -d portal` is the whole upgrade.
- **GitHub access from the host:** a dedicated, read-only Deploy Key
  (`~/.ssh/id_ed25519_deploy` on the VPS, registered against this GitHub repo only — see repo
  Settings → Deploy keys). Not the laptop's key, and not write-capable.
- **Firewall:** `ufw` allows only 22/80/443.
- **Reverse proxy:** Caddy (`Caddyfile` in this repo, deployed to `/etc/caddy/Caddyfile`) —
  see §3/§11 of `GO-LIVE.md` for why it isn't serving the public site yet (DNS). Carries the
  security headers and the CSP since 2026-08-19 — **deployed by hand, not by any script**: see §3a.
- **Backups:** host cron (`crontab -l` as `ubuntu`) runs `docker compose run --rm backup` daily at
  03:15. A Windows scheduled task on the laptop (`BusMaps-PullBackups`, `schtasks /Query`) runs
  `C:\Claude\community-bus-maps-ops\pull-backups.ps1` daily at 08:00 to pull them off-box into
  `community-bus-maps-ops\backups\` (that folder is local-only, not this repo, not synced anywhere
  public — see that repo's own notes).
- **Content:** fresh database, one real customer (*BusMaps.uk (pilot)*), all 8 built towns + 5 built
  places imported via `scripts/deliver-map.mjs` and published via `scripts/publish-baseline.mjs` —
  see `GO-LIVE.md` §3 "Content on the live site".
- **Deploy history:** `da66dc9` (2026-08-11, `0.9.2-pilot`) → `7603d39` (2026-08-12, `0.9.3-pilot`, both update-flow tranches) → `5e20950` (2026-08-12, admin org-reassignment, #28) → `59f3a17` (2026-08-12, `0.9.3-pilot`, H9/#30, P8a rebuild/#32, `delete-map.mjs`/#33) → `e91b68c` (2026-08-13, #35 service-list link, #36 admin nav link) → `3254c02` (2026-08-13, **`fontconfig` fix — see CHANGELOG "the live host rendered every sheet in monospace"**, #37, then `scripts/rerasterize-stored.mjs --apply` run against all 13 maps/60 stored sheets to re-encode existing JPGs, same commit) → **`fc68a4c`** (2026-08-18, `0.9.4-pilot`, public text follows current bus policy instead of the 2021 strategy — BSIP funding claim replaced with LABG/EP-scheme framing, two new FAQ entries, #40). The box then ran ahead of this list unrecorded as far as **`fa4d6da`** (PR #44, sample refresh) — found on 2026-08-19 by reading the host rather than this document, which is exactly the case the sentence below is about. → **`e3e2339`** (2026-08-19, `0.9.4-pilot`, the P1 round of Peter's 32-comment map review: engine re-vendor, `Octolinear schematic`→`Simplified street map` and `nearby towns`→`nearby places`, and the per-state sheet-version stamp — #48, #49, carrying the undeployed #45/#46/#47 docs commits with it). Backup taken immediately before (`backups/2026-08-19T09-49-29`, 13 maps, 161.6 MB). Post-deploy `/health?deep=1`: `status: ok`, `gitSha: e3e2339`, `builtAt: 2026-08-19T09:49:56Z`, all four checks green (`sharp 0.34.5` / `vips 8.17.3`). Verified beyond the probe that the three published St Ives sheets still download HTTP 200 and that no `-draft` sidecars were created — every render predating this deploy carries no version line, and `draftStamp` is written to decline those rather than rewrite them. → **`fa0f3c0`** (2026-08-20, `0.9.4-pilot`, the P0 block of `technical-audit_2026-08-19` — security headers and a strict CSP, `npm test` and a dependency audit in CI, `deliver-map.mjs`'s health check made to fail, `trustProxy: 1`, `PRAGMA foreign_keys`, and `@fastify/static` `8.3.0` → `10.1.3` closing four highs — #56). Post-deploy `/health?deep=1`: `status: ok`, `gitSha: fa0f3c0`, `builtAt: 2026-08-20T02:07:25Z`, all four checks green. **This deploy is also the worked example of why §3a exists:** `npm run deploy` shipped the app and the `Caddyfile` stayed behind, so the security headers were merged, the deploy was reported done, and every live response still carried none of them. Nothing failed and nothing said so — it was found by reading `curl -sI`, not by any error. The `Caddyfile` was deployed separately about half an hour later and the headers verified present on `/` and on `/m/<slug>`. `npm run deploy:caddy` now does copy-validate-reload-verify in one command so the two halves cannot drift apart again. Verified beyond the header check, because headers arriving and the CSP not breaking pages are different questions: the homepage, `/maps` (26 map links, 13 thumbnails loading, so `img-src 'self'` covers the API-served images), a published `/m/<slug>` (SVG injected live, 122 text nodes, 951 path elements), `/contact.html?kind=issue` and `/app/login.html?error=expired` all render correctly with clean consoles — the last two being the pages whose inline scripts were moved out so `script-src` could stay strict. The CSP was confirmed *enforcing* in production, not merely present: an injected inline script did not execute and an external image was blocked. The signed-in `/app` was **not** checked live — that needs Peter's own session. `/health?deep=1` is the record of what is actually on the box — trust it over any document, including this one. → **`b0c94ee`** (2026-08-22, `0.9.4-pilot`, nav current-page marking and the Pricing accessibility line — #72). Verified live by the §3a method rather than by the probe, and this deploy is why that distinction matters: `public/js/nav-current.js` returned **404 before the deploy and 200 after**, it is referenced by all four page kinds checked (`/`, `/pricing.html`, `/maps`, `/faq.html`), the `aria-current` rules are present in the served `styles.css`, and the live page sets `aria-current="page"` on exactly the right link with a distinct colour plus a 2px `#5a8dff` underline. **`/health?deep=1` proved none of that and structurally could not have** — see the caution below.

**A caution about every `gitSha` quoted above, added 2026-08-22.** Several entries in this history quote a post-deploy `gitSha` from `/health?deep=1`, but `gitSha`, `builtAt` and the per-check `checks{}` are gated behind `opsAuthorised()` — a `METRICS_TOKEN` bearer or `?token=`, or an admin session. `scripts/deploy.mjs` step 5 curls that endpoint **with no token**, so it receives the short form (`status`, `service`, `version`, `time`) and never the three fields its own closing line instructed the operator to read. The deploy therefore never once confirmed *which commit* it had just put live: the check could not fail, because the values were absent rather than wrong. Fixed the same day — step 5 now prints the sha it resolved and built with, passes `METRICS_TOKEN` when one is set, and says plainly when the gate is the reason a field is missing. **Confirm a deploy by fetching something only the new build serves**, as was done for `b0c94ee`; treat a tokenless `/health` as a liveness check and nothing more.

### Running the upgrade, as actually done (2026-08-12)

Four steps, about five minutes. **Back up first, build second, switch third** — the order matters:

1. `docker compose run --rm backup` — takes ~30 s and writes to `<app dir>/backups/`. Do it even though cron backs up daily: a release that carries a migration wants a backup from *immediately* before it, not from 03:15.
2. `git pull`, and **read the new HEAD** rather than assuming the pull got what you expect.
3. `export GIT_SHA=$(git rev-parse --short HEAD) BUILT_AT=$(date -u +%FT%TZ) && docker compose build portal`. Those exports are not decoration — `compose.yaml` passes them as **build args** and the Dockerfile bakes them in, so without them `/health` reports `gitSha: unknown` and you lose the one reliable way to tell what is running. Building is safe: the old container serves throughout, so a failed build costs nothing.
4. `docker compose up -d portal` — the only step the public notices, a few seconds of 502 while the container is recreated.

Then check `/health?deep=1` for the expected `version` + `gitSha` and four green checks, and read the startup log. **Migrations run at import of `src/db/index.js`, before the server binds a port**, so a migration failure crash-loops the container rather than logging quietly — a healthy start with `database: ok` is itself the evidence that a migration succeeded.

**Rollback** is the same loop against the previous SHA (`git checkout <sha>`, rebuild, `up -d`). Schema changes here have been additive (`ALTER TABLE … ADD COLUMN`), and the older code's `SELECT *` tolerates an unknown column, so the database is usable by either build. That is a property worth preserving deliberately, not a coincidence to rely on blindly — check it holds for any new migration before you promise a rollback.

**Two traps for an AI assistant driving this:**

- **The Claude sandbox blocks SSH to this host** (as it blocks `curl` POSTs to production). An agent cannot run the deploy itself; it must hand the operator the commands and read back the output. Do not attempt to work around the block.
- **Windows PowerShell 5.1 strips embedded double quotes** when calling a native exe like `ssh`, so a remote command containing `grep -iE "a|b"` arrives at bash as `grep -iE a|b` and bash reads those `|` as pipes ("command not found"). Keep the remote command in a **single-quoted** PowerShell string (so `$(…)` and `$VAR` survive for the remote shell), and inside it avoid double quotes entirely — use `grep -i -e pat1 -e pat2`, where each pattern is its own argument. Also: `$host` is a reserved PowerShell variable; use `$target`.

- **Known gotcha if you ever recreate the data volume:** it defaults to `root:root`, but the
  container runs as the unprivileged `node` user (uid 1000, same as the host's `ubuntu` user, that's
  not a coincidence worth relying on elsewhere) — `chown -R node:node` on `/data` and `/backups`
  before the first start, or the container crash-loops on `EACCES` opening `portal.sqlite`.
