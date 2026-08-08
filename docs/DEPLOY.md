# Deploying and running the portal (P7)

<!-- docstamp v1.4 | 2026-08-08 | sha=0e63207f -->
**v1.4** · updated 8 August 2026

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
| `EMAIL_PROVIDER` / `EMAIL_FROM` | magic-link delivery. **Unset means sign-in links are printed to the log** — fine in dev, not in production |
| `METRICS_TOKEN` | set to expose `/metrics`; unset and the endpoint 404s |
| `STATUS_TOKEN` | set to accept `POST /api/admin/status` (the laptop's `push-status.mjs`); unset and it 404s |
| `PILOT_MODE` | **defaults ON.** Banner on every page, band on every rendered sheet, `Disallow: /` in robots.txt. Set to `0` to switch all of it off — see [`PILOT.md`](PILOT.md) |

## 3. Run it

```bash
docker compose up -d --build
```

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

```bash
systemctl stop cbm-portal            # or: docker compose stop portal
mv /var/lib/cbm /var/lib/cbm.broken  # keep the bad state for diagnosis
mkdir -p /var/lib/cbm
cp -a /backups/<timestamp>/portal.sqlite /var/lib/cbm/
cp -a /backups/<timestamp>/maps         /var/lib/cbm/
systemctl start cbm-portal
curl -fsS localhost:5180/health?deep=1
```

Then check a published map's public page still serves the same file sizes as before — the published bytes are the promise, so that is the real "restore succeeded" test. There is **one writer**: stop the server before any script that writes SQLite (`seed-demo`, `import-map`, `propose-update`) and before restoring.

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
