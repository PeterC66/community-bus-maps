# Go-live plan — putting the pilot on busmaps.uk

<!-- docstamp v1.0 | 2026-08-08 | sha=b7bb8064 -->
**v1.0** · updated 8 August 2026

**For:** the operator. **Status:** planning. Nothing deployed yet.

`DEPLOY.md` says *how* to run the thing on a box you already have. This says *which* box, *what has to be built first*, and *how the laptop and the live site work together afterwards*. Read this one first; `DEPLOY.md` becomes the reference once the host exists.

The single sentence that shapes everything below: **the central pipeline runs on the laptop and the portal runs on the host, and today there is no mechanism that connects them.** Every other decision falls out of that.

---

## 1. The host

**Recommendation: a small Linux VPS running the existing `compose.yaml`, with Caddy in front for TLS.** Hetzner CX22 (~€4.35/mo) or a UK provider if location matters more than price. 20i stays as registrar and DNS only.

### Why not 20i hosting

The free plan you hold — and 20i's shared/reseller web space generally — is the wrong shape, not merely too small. This app needs a long-running Node 24 process, a writable disk that survives restarts, and native `sharp`/libvips binaries. Shared web space gives none of those. 20i's own VPS / Managed Cloud products would work, but they start above the £10/month line and buy you nothing the alternatives don't. Keep 20i for what it is already good at: the domain and the DNS records.

### Why a VPS rather than Render

Render is the more obvious "just deploy it" answer and it would work: Starter web service $7/mo, always-on, plus a persistent disk at $0.25/GB/mo — 10 GB is ample (the current store is 75 MB across 12 maps), so ~$9.50/mo ≈ £7.50. Managed TLS, deploy on git push, no OS to patch. Render's **free** tier is not an option at any price: free services cannot attach a persistent disk and the filesystem is wiped on every restart, which would destroy `portal.sqlite` and every rendered version.

The VPS wins on the thing that actually matters here:

| | VPS + Docker | Render |
|---|---|---|
| Getting maps in | **works today** — `rsync` the render dir, `ssh`, run `import-map.mjs`. Zero new code. | needs an upload API built **before you can publish a single map** |
| Running `npm run verify` on the real target | `ssh` in and run it | awkward; the release gate lives where you can't easily reach it |
| Backups off the box | `rsync` to the laptop from cron | needs a third-party store |
| Cost | ~£3.70/mo | ~£7.50/mo |
| OS patching, firewall | **yours** (`unattended-upgrades` + Caddy covers most of it) | theirs |
| Restore drill in `DEPLOY.md` §5 | runs as written | needs translating |

`DEPLOY.md`, `compose.yaml` and the restore drill were all written assuming a single VM with a shell. Render would mean rewriting the operational half of the project to avoid one afternoon of server setup.

**Reconsider Render if** you ever want to stop owning a Linux box — but by then the HTTP import endpoint (§2.1) should exist anyway, which removes the main objection.

---

## 2. Blockers — things that must be built before a deploy is possible

These are not polish. Each one stops the launch.

### 2.1 Map delivery from laptop to host

`scripts/import-map.mjs` and `scripts/propose-update.mjs` write directly to `DATA_DIR` and to SQLite, with the server stopped ("one writer"). Neither speaks HTTP — `grep -l "fetch(" scripts/*.mjs` returns nothing. Once the portal is on a host, `/bus-work` has no way to deliver a built map into it.

**Phase 1 (launch):** an `ssh`-based delivery script on the laptop — rsync the S5 render dir up, `docker compose stop portal`, run the import inside the container, start it again, hit `/health?deep=1`. One laptop command, consistent with the fool-proofing plan's "laptop = one command". Small, and it needs the VPS's shell.

**Phase 2 (later):** `POST /api/admin/import` with a token, same shape as the existing `STATUS_TOKEN` / `push-status.mjs` pattern — the *server* does the write, so the single-writer rule holds by construction and the stop/start dance disappears. Build it when the ssh script starts to hurt, or if you move to Render.

### 2.2 First admin on a clean database

The only code path that creates an admin user is `scripts/seed-demo.mjs`, which also invents Broadmeadow Parish Council, Fenmarsh District Council and Oakfield Community Transport Trust and seeds maps to them. On a fresh live database you can currently either run the demo seed — putting three fictional organisations on the public site — or have no way to sign in at all.

**Needed:** a `scripts/create-admin.mjs` that makes exactly one admin user and nothing else.

### 2.3 Email for magic links

`src/server.js:81` — `const DEV_LINKS = !process.env.EMAIL_PROVIDER;` — is the whole of it. There is no send path. With no console in front of you, nobody but you can sign in.

**Needed:** an `src/email/` module and a provider. Resend or Brevo's free tier is enough (thousands of messages a month, far past pilot volume), plus SPF/DKIM records at 20i so the mail doesn't land in a council's spam folder. The invite flow in the admin console returns the magic link in the API response *only* while `EMAIL_PROVIDER` is unset, so this also closes that gap.

### 2.4 `trustProxy`

`Fastify({ logger: true, bodyLimit: 256 * 1024 })` at `src/server.js:90` does not set `trustProxy`. Behind Caddy or any proxy this breaks two things:

- **`authLink()` (`src/server.js:88`) builds sign-in URLs from `req.protocol`**, which is `http` when the proxy terminates TLS. You would email people `http://busmaps.uk/auth/verify?token=…` — a session token over plaintext on the first hop.
- **The rate limiter keys on `req.ip` (`src/server.js:103`)**, which becomes the proxy's address. Every visitor then shares one 20-per-minute bucket on apply/contact/feedback: one bot locks the forms for everybody.

`trustProxy: true` fixes both. (The session cookie itself is already safe — `isHttps()` at `src/server.js:85` reads `x-forwarded-proto` directly.)

### 2.5 Byte-parity proved on Linux

The whole product promise is that the file served is the file that was approved. The fixtures were rendered by the skill on Windows; the host will run `node:24-slim`. A different libvips build can encode the same SVG to different JPEG bytes.

**Do this before choosing anything else, because it is cheap and it could change the plan:** build the Docker image locally, mount the fixtures, run `npm run verify` inside it. If it passes, target parity is proved and Windows-vs-Linux is a non-issue. If it fails, that is a much bigger conversation and better had now than after DNS is pointed.

---

## 3. Pre-go-live checklist

Blockers from §2 are assumed. Grouped by who has to do them.

### Code

| | Item | Notes |
|---|---|---|
| ☐ | `create-admin.mjs` | §2.2 |
| ☐ | Email provider module | §2.3 |
| ☐ | `trustProxy: true` | §2.4 |
| ☐ | Version stamping | §5 |
| ☐ | `ssh` delivery script on the laptop | §2.1 |
| ☐ | CSRF tokens on state-changing POSTs | Listed as a follow-up in `ROADMAP.md`. `SameSite=Lax` already blocks cross-site POST, so this is **defensible to defer for a pilot with a handful of known users** — but record it as an accepted risk rather than forgetting it. |

### Operator — legal and paper

| | Item | Notes |
|---|---|---|
| ☐ | Print one A4 of each of the four outputs; confirm the OSM + BODS + "check live times" line is present and legible | The two open rows in `LICENSING.md` §5. A screen credit is not a paper credit. |
| ☐ | Final read of `/legal.html`, add a "last reviewed" date | Still marked a working draft (`ROADMAP.md`, `LICENSING.md` §4) |
| ☐ | Final read of `/terms.html` | Same treatment; not yet reviewed at all |
| ☐ | Launch go/no-go signed off in `LICENSING.md` §5 | The file is versioned so the decision and its date survive |

`bustimes.org` is **closed** — the site owner confirmed on 2026-08-07 that the use is acceptable with no attribution required. That gate is done.

### Host setup

| | Item |
|---|---|
| ☐ | VPS provisioned; non-root user; SSH keys only; `ufw` to 22/80/443; `unattended-upgrades` |
| ☐ | Docker + compose; `docker compose up -d --build`; verify `/health?deep=1` |
| ☐ | Caddy in front — automatic TLS, forwards `X-Forwarded-Proto`, does not strip `/api/` or `/m/` |
| ☐ | DNS at 20i: A (+ AAAA) for `busmaps.uk` and `www` → host IP; SPF/DKIM for the mail sender |
| ☐ | Env set: `DATA_DIR`, `PUBLIC_BASE_URL=https://busmaps.uk`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `METRICS_TOKEN`, `STATUS_TOKEN`, `PILOT_MODE=1` |
| ☐ | Daily cron: `npm run backup -- --out /backups --keep 14` |
| ☐ | Backups pulled **off the box** — rsync to the laptop, into the SyncBack set |
| ☐ | **Restore drill actually performed** (`DEPLOY.md` §5) before the site matters |

`STATUS_TOKEN` is not optional in practice: it is what lets the laptop's `push-status.mjs` put the byte-identical gate and engine staleness into the live worklist, which is how `/bus-work` keeps working once the portal is remote.

### Content on the live site

Don't lift the local `data/` up wholesale — it carries three invented organisations and a deliberately messy demo state (pending applications, a submitted review, staged refreshes).

**Recommendation:** fresh database on the host; create one genuine organisation — *BusMaps.uk (pilot)* — and import the real towns into it. That is honest and matches what `PILOT.md` already says out loud: every map on the site is one we made ourselves. It also keeps `/maps` from being an empty shopfront on day one.

---

## 4. Operating once live

Two environments, not three. A separate staging box doubles the cost and the ops for a pilot with no customers; the safety net is the test suite, the byte-identical gate, and a restore-tested backup.

**Local (laptop) — unchanged.** `npm run dev` on 5180 against its own `data/`, its own SQLite, demo seed and all. This stays the place where features get built and where the messy demo state lives. Nothing about going live changes local development.

**Live (host) — pilot only.** Real maps, real organisation, `PILOT_MODE=1` so every page carries the banner, every sheet the red band, and `robots.txt` says `Disallow: /`.

### The release loop

1. Build and test on the laptop as now.
2. `npm test` **and** `npm run verify` (both fixtures) — green locally.
3. Bump `package.json` version, update `CHANGELOG.md`, tag the commit, push.
4. On the host: `git pull && docker compose up -d --build`.
5. `curl -fsS localhost:5180/health?deep=1` — confirm it returns the version **you just deployed** (§5).
6. Spot-check a published map's public page: same file sizes as before.

Rollback is `git checkout <previous tag> && docker compose up -d --build`. The data volume is untouched by a deploy, which is the point of keeping it out of the image.

### Where the two touch

| Flow | Direction | Mechanism |
|---|---|---|
| New/refreshed map | laptop → live | §2.1 delivery script |
| Worklist status | laptop → live | `push-status.mjs` + `STATUS_TOKEN` (already built) |
| What needs doing | live → laptop | `/bus-work` reads the live portal's queues |
| Backups | live → laptop | nightly rsync into the SyncBack set |

---

## 5. Versioning the portal pages

**Yes — and it is worth doing before launch, not after.** Once other people are looking at the site, "which build were you on when you saw that?" becomes unanswerable without it, and the answer is currently hard-coded and already at risk of drifting.

### What is wrong now

`src/server.js:64` declares `const VERSION = '0.9.0-pilot';` as a literal, duplicating `package.json`. Two places, one fact — they will diverge on the first release someone does in a hurry. And no version appears anywhere a human can see it: not on any page, not in the footer, not on a rendered sheet's metadata.

### What to add

Four surfaces, in descending order of value:

1. **`renders/<v>/meta.json` records the app build that produced the sheet.** This is the important one. The product is byte-identical output; when someone says "this map looks wrong", the first question is which app and engine build made it. Right now that is unrecoverable.
2. **`/health` reports `version`, `gitSha`, `builtAt` and `pilotMode`.** Turns step 5 of the release loop from "it responded" into "it is running the code I just pushed, and it is still in pilot mode".
3. **A muted line in the site footer** — `v0.9.1 · a1b2c3d`. A screenshot from a councillor then tells you the build. There is no template engine, so use the pattern already established for the pilot banner: generate it into `/js/site-banner.js` rather than editing seventeen HTML files by hand.
4. **A `<meta name="app-version">` tag** on every page from the same generated script — machine-readable, so a check can assert it after deploy.

### The discipline around it

- **One source of truth:** read the version from `package.json` at boot and delete the literal at `src/server.js:64`.
- **Git sha** injected at build time via a Docker `ARG`, falling back to reading `.git` when running locally.
- **Bump the version on every deploy** and tag the commit. `CHANGELOG.md` already carries the narrative; the tag makes rollback a one-liner.

Keep this distinct from the versions already in play — **map** versions (`v1.1`, on the public page), **document** versions (the docstamp hook), and **engine/template** versions (S6). Four different things called "version" is exactly why the app one needs a visible, unambiguous home.

---

## 6. Suggested order

1. **Prove byte-parity in the Linux container** (§2.5). Cheap, and it could invalidate everything else.
2. Code blockers: `create-admin`, email, `trustProxy`, version stamping (§2.2–2.4, §5).
3. Provision the VPS, deploy with a fresh database, confirm `/health?deep=1`.
4. Delivery script; import the real maps (§2.1).
5. Backups + the restore drill, then DNS.
6. Operator's paper and legal checks; sign off `LICENSING.md` §5.
7. Announce to whoever the pilot audience is.

Ending pilot mode is a **separate, later** decision with its own checklist in `PILOT.md` — it needs a first real customer and a track record, not a successful deploy.
