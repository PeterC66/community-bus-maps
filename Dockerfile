# Community Bus Maps — portal image (P7).
#
# Single-process Node service: Fastify + node:sqlite + sharp. No build step, no
# database server, no queue — everything persistent lives in one volume (DATA_DIR).
#
# IMPORTANT (byte-parity): the print JPGs are produced by sharp/libvips, and the
# portal's promise is that a re-render reproduces the signed-off bytes. Changing
# the sharp or libvips version can change JPEG output, so `npm ci` against the
# committed package-lock is deliberate, and any sharp upgrade must be re-proved
# with `npm run verify` BEFORE it is deployed. (`verify` no longer needs a
# private fixture: it reads a committed one, see scripts/lib/fixtures.mjs.)
#
# AND THE RULE WHEN THOSE TWO PULL APART, written down because it came up for
# real (technical-audit_2026-08-19 S2): A SECURITY PATCH OUTRANKS BYTE
# CONTINUITY. sharp carried a high-severity advisory whose only fix was a major
# bump, and the bump was deferred for weeks on the grounds that the bytes are a
# guarantee. That reasoning does not survive contact with a real customer: a
# re-baseline is a normal, announced, recoverable event, and an unpatched image
# parser in production is not. If a rasteriser upgrade moves the bytes, take the
# upgrade, re-baseline, and say so in a CHANGELOG.d/ fragment.
#
# What that looks like in practice, in order:
#   1. bump sharp; `npm run verify` (SVG gates — unaffected by the rasteriser,
#      so this is the check that the upgrade broke nothing structural);
#   2. `node scripts/render-parity-probe.mjs` on the laptop, then
#      `--write-baseline` if the bytes moved;
#   3. AFTER deploying, on the host:
#      `docker compose run --rm portal node scripts/rerasterize-stored.mjs --check`
#      — would re-rendering the already-published sheets produce different bytes?
#      If yes, LOOK at one of them before applying. The Liberation Mono incident
#      moved bytes too, and every sheet was wrong.
#
# Measured for the 0.34.5 -> 0.35.3 bump (libvips 8.17.3 -> 8.18.3) on
# 2026-08-20: not one byte moved, on Windows OR on Linux. The parity workflow ran
# the same probes before and after -- on THIS image, geometry stayed byte-
# identical at 418,761 B and text at 683,470 B, with the Arial ink ratio at
# 4.376 -- and all 37 stored JPGs in the dev store re-rasterised identically.
# That is the happy case, not the guaranteed one; step 3 above is still the
# check, because next time it may not be.
# The base image is pinned BY DIGEST for the same reason.
#
# It said "pinned by digest-able tag" until 2026-08-20 and then wrote
# `FROM node:24-slim`, which is a floating tag: the comment described an
# intention, not the line beneath it (technical-audit_2026-08-19 V6). A rebuild
# months apart could pull different fontconfig, freetype or libvips-adjacent
# packages and silently move the very bytes the product guarantees -- which is
# not hypothetical here. It is exactly what the Liberation Mono incident was:
# fontconfig went missing from the image, every live sheet was mis-set for four
# days, and the parity probe still reported PASS.
#
# node:24-slim as at 2026-08-05, resolved 2026-08-20. This is the multi-arch
# INDEX digest, so it still selects the right architecture; the `node:24-slim`
# tag in front of it is decoration for a human reader and is ignored by Docker
# once a digest is present.
#
# TO BUMP: take the new digest from Dependabot's PR (.github/dependabot.yml has
# a `docker` ecosystem entry for exactly this, monthly), or by hand with
#   docker buildx imagetools inspect node:24-slim
# run from anywhere. Record the new digest in a CHANGELOG.d/ fragment on each bump, and
# re-run `npm run verify` before deploying -- a base-image change is a
# rasteriser change until proved otherwise.
FROM node:26-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146

# libvips is bundled with sharp's prebuilt binary; CA certs + tini are the only
# other infrastructure.
#
# fonts-liberation is NOT optional and must not be tidied away. Every sheet is
# set in Arial -- 120 times in the St Ives internal sheet alone -- and Arial is
# a Microsoft font that is not present on Linux. The render-parity probe
# (.github/workflows/render-parity.yml) measured the consequence: with no font
# to resolve Arial to, this image rendered the text probe differently from both
# the Windows laptop AND a bare Ubuntu runner. Because customers re-render on
# the host through the safe-subset editor, that means customer-rendered sheets
# would not match the ones built centrally.
#
# Liberation Sans is METRICALLY COMPATIBLE with Arial -- identical advance
# widths -- so labels keep their positions and nothing reflows or collides.
# The glyph shapes still differ from real Arial, so this makes the host
# self-consistent; it does not make it pixel-identical to the laptop. See
# docs/GO-LIVE.md 2.5 for the options that would.
#
# fontconfig is the OTHER HALF of that fix and is equally not optional. Font
# FILES alone do not make "Arial" resolve to Liberation Sans -- the metric alias
# that maps one to the other lives in fontconfig-config, at
# /etc/fonts/conf.d/30-metric-aliases.conf. Installed 2026-08-13 after the live
# host was found rendering every sheet in Liberation MONO: with the files present
# but no alias to follow, fontconfig failed to match Arial and fell back to the
# first family it could see, and LiberationMono sorts before LiberationSans.
# Monospace is ~16% wider than Arial, so the Beaconsfield Simpson Centre title
# overran its 200mm Services panel by 16.5mm and every other sheet was silently
# mis-set too. Note the trap this walked into: GO-LIVE.md 2.5 read the text
# probe moving 670,430 -> 676,537 B as proof Arial now resolved to Liberation
# Sans. The bytes did move -- but only because the fallback changed to Liberation
# Mono. A byte count cannot tell you WHICH face was chosen; only naming the
# resolved family can.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini fonts-liberation fontconfig age \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5180 \
    DATA_DIR=/data

# GO-LIVE.md §5: the image doesn't carry .git (see COPY list below), so the
# build must pass these explicitly — `docker build --build-arg GIT_SHA=$(git
# rev-parse --short HEAD) --build-arg BUILT_AT=$(date -u +%FT%TZ) ...` — or
# /health and the footer/meta version badge fall back to "unknown".
ARG GIT_SHA=unknown
ARG BUILT_AT
ENV GIT_SHA=${GIT_SHA} \
    BUILT_AT=${BUILT_AT}

WORKDIR /app

# Dependencies first, so a code change doesn't re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application: the server, the vendored engines, the public site, the ops scripts.
COPY src ./src
COPY engine ./engine
COPY public ./public
# The signed-in app's HTML shells, kept OUT of public/ so they cannot be served
# statically (technical-audit_2026-08-19 S7). Miss this line and every /app page
# 404s while the public site looks fine.
COPY views ./views
COPY scripts ./scripts
# CHANGELOG.md is NOT here: it is generated from CHANGELOG.head.md plus
# CHANGELOG.d/ and is gitignored (2026-09-03), so a fresh clone does not have
# one and a COPY naming it would fail the build on any machine that had not
# run `npm run changelog` first. The admin /changelog route builds its list
# from the fragments below on every request instead.
COPY LICENSE NOTICE README.md CHANGELOG.head.md ./
COPY CHANGELOG.d ./CHANGELOG.d
COPY docs ./docs

# The object store + SQLite live in the volume, never in the image.
VOLUME ["/data"]
EXPOSE 5180

# Readiness (not just liveness): exercises the DB, the store and the rasteriser.
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5180)+'/health?deep=1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
