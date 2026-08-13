# Community Bus Maps — portal image (P7).
#
# Single-process Node service: Fastify + node:sqlite + sharp. No build step, no
# database server, no queue — everything persistent lives in one volume (DATA_DIR).
#
# IMPORTANT (byte-parity): the print JPGs are produced by sharp/libvips, and the
# portal's promise is that a re-render reproduces the signed-off bytes. Changing
# the sharp or libvips version can change JPEG output, so `npm ci` against the
# committed package-lock is deliberate, and any sharp upgrade must be re-proved
# with `npm run verify` (which needs the private fixtures) BEFORE it is deployed.
# The base image is pinned by digest-able tag for the same reason.
FROM node:24-slim

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
 && apt-get install -y --no-install-recommends ca-certificates tini fonts-liberation fontconfig \
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
COPY scripts ./scripts
COPY LICENSE NOTICE README.md CHANGELOG.md ./
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
