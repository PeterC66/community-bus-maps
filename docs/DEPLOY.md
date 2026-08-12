# Deploying and running the portal (P7)

<!-- docstamp v1.9 | 2026-08-12 | sha=ff3d3dd9 -->
**v1.9** · updated 12 August 2026

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
| `PILOT_MODE` | **defaults ON.** Banner on every page, band on every rendered sheet, `Disallow: /` in robots.txt. Set to `0` to switch all of it off — see [`PILOT.md`](PILOT.md) |

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

## 4. Smoke test after every deploy

```bash
curl -fsS localhost:5180/health?deep=1 | head -40
```

`?deep=1` is the **readiness** probe, not a ping: it queries the database, writes and deletes a probe file in `DATA_DIR`, checks the vendored engine files (including the P7 expert styles) and rasterises a tiny image through sharp. It returns **503** if any of those fail, so it is what a load balancer and the container `HEALTHCHECK` should use.

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
npm run prune:staged -- --days 90 --dry-run   # then without --dry-run
```

Removes staged payloads of **settled** monthly refreshes and the data an accepted refresh replaced, once they are older than `--days`. It never touches a pending update, a map's live data, or any rendered version. The Ops tab shows how much it would free.

Sessions expire themselves (the server purges hourly). Nothing else grows unbounded except renders, which are kept on purpose — every version stays downloadable.

## 7. Upgrading the app

1. `npm ci` (respect the lockfile — see the sharp warning below), then **`npm test`**.
2. **`npm run verify`** with `FIXTURE_DIR` + `PLACE_FIXTURE_DIR` pointing at the private fixtures. This is the release gate: it re-renders the area map, the place map **and the two expert styles** and requires them to be byte-identical.
3. Deploy, then `/health?deep=1`.

**The sharp/libvips warning is not boilerplate.** The print JPG is the product; a different libvips build can encode the same SVG to different bytes, which would silently break "the file we serve is the file that was approved". Treat any `sharp` bump as a change that must pass step 2 on the target platform before it ships.

## 8. Licensing gate

`docs/LICENSING.md` lists the data sources, what must be credited, and the open **bustimes.org terms** question. It is a launch go/no-go, not a footnote: the review lines at the bottom of that file are meant to be filled in before the public site is announced.

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
  see §3/§11 of `GO-LIVE.md` for why it isn't serving the public site yet (DNS).
- **Backups:** host cron (`crontab -l` as `ubuntu`) runs `docker compose run --rm backup` daily at
  03:15. A Windows scheduled task on the laptop (`BusMaps-PullBackups`, `schtasks /Query`) runs
  `C:\Claude\community-bus-maps-ops\pull-backups.ps1` daily at 08:00 to pull them off-box into
  `community-bus-maps-ops\backups\` (that folder is local-only, not this repo, not synced anywhere
  public — see that repo's own notes).
- **Content:** fresh database, one real customer (*BusMaps.uk (pilot)*), all 8 built towns + 5 built
  places imported via `scripts/deliver-map.mjs` and published via `scripts/publish-baseline.mjs` —
  see `GO-LIVE.md` §3 "Content on the live site".
- **Deploy history:** `da66dc9` (2026-08-11, `0.9.2-pilot`) → `7603d39` (2026-08-12, `0.9.3-pilot`, both update-flow tranches) → `5e20950` (2026-08-12, admin org-reassignment, #28) → **`59f3a17` (2026-08-12, `0.9.3-pilot`)**, carrying H9 (#30), the P8a rebuild (#32) and `delete-map.mjs` (#33). `/health?deep=1` is the record of what is actually on the box — trust it over any document, including this one.

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
