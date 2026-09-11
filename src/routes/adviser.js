// THE LOCAL ADVISER'S SEAT — buses-data OA-154 Phase D1. One plugin, three
// routes, under /api/adviser.
//
// WHO THIS IS FOR. Somebody who knows a town we draw and has been asked for a
// view on a draft before it is published. They are a member of the public. They
// do not work for a customer, they are not paid, and the one favour they are
// doing us is looking carefully at a sheet — so everything here is shaped by two
// facts: they must be able to SEE the current draft the moment it exists, and
// they must be able to do nothing else at all.
//
// WHY IT IS ITS OWN PLUGIN RATHER THAN A WIDER READ ON THE EDITOR'S. Because the
// editor's routes are written for somebody who owns the map, and every one of
// them would then need to ask a second question. The rule this repository has
// already learned twice — one file, one refusal vocabulary (see pages.js and
// admin.js) — applies at least as hard when the audience is a stranger: a route
// added to THIS file inherits requireAdviser from the hook below and can still
// only reach a map loadAdvisedMap() approves, and a route added to editor.js
// cannot accidentally acquire an adviser audience, because an adviser is refused
// by loadOwnedMap() and loadReadableMap() by name.
//
// WHAT IS DELIBERATELY ABSENT, and each absence is a test in
// scripts/test-adviser-seat.mjs:
//   * no downloads. Not the SVG file, not the JPG, not the PDF. The sheet is
//     served as inline SVG marked DRAFT — see below.
//   * no other map. The grant is per map and nothing here lists a map without one.
//   * nothing about the customer. Not the name, not the branding, not the quota.
//     An adviser is not told which organisation, if any, is paying for the sheet —
//     they were asked about a TOWN.
//   * no messages, no publish route, no save route, no overrides. Advising happens
//     by email and in Correspondence/ until OA-083 Phases 1–2 land, which is what
//     Phase D2 is waiting for.
//
// THE VERSION SHOWN IS THE MAP'S WORKING HEAD (`current_version_id`), not the
// published one. That is the whole point: the Ramsey adviser answered on drafts
// that were emailed to him one at a time, the third one never went, and the map
// went back live on 10 September without his ever seeing it. A seat that showed
// the published version would have changed nothing about that.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { getVersionById, listAdviserGrantsForUser, listMapsWithLiveAdviserGrants } from '../db/index.js';
import { loadAdvisedMap } from '../maps/detail.js';
import { effectiveOutputs } from '../maps/engine.js';
import { versionDir, mapDataDir } from '../maps/store.js';
import { inlineSvg } from '../public/inlineSvg.js';
import { draftLabel, ensureDraftMarked } from '../render/draftStamp.js';
import { watermarkSvgDocument } from '../render/watermark.js';
import { parseOutputs, requireAdviser, str } from '../http/helpers.js';

/** The words tiled across every sheet an adviser is shown. */
export const ADVISER_WATERMARK = 'DRAFT — not published';

/** One version, as little of it as the screen needs. */
const versionShape = (v) => (v ? {
  number: `${v.major}.${v.minor}`,
  state: v.review_state,
  createdAt: v.created_at,
  // The same words the footer of the sheet itself will carry, so the page and the
  // artwork cannot disagree about what the reader is looking at.
  label: draftLabel(v.review_state, `${v.major}.${v.minor}`, v.created_at),
  published: v.review_state === 'published',
} : null);

/** One map, as little of it as the screen needs. Note what is NOT here. */
const mapShape = (m, grant) => ({
  id: m.id,
  name: m.name,
  kind: m.kind,
  subject: m.subject || null,
  version: versionShape(m.current_version_id ? getVersionById(m.current_version_id) : null),
  askedAt: grant ? grant.created_at : null,
  askedNote: grant ? grant.note || null : null,
});

/** Which sheets this map's current version actually HAS on disk, in order. */
function sheetsFor(map, storageKey) {
  if (!storageKey) return [];
  const dir = versionDir(map.id, storageKey);
  return effectiveOutputs(parseOutputs(map.outputs), mapDataDir(map.id))
    .filter((o) => existsSync(path.join(dir, `${o.base}.svg`)))
    .map((o) => ({ base: o.base, label: o.label }));
}

export default async function adviserRoutes(app) {
  // ONE DOOR. Every route below is behind it, exactly as admin.js's 22 are behind
  // requireAdmin — so a fourth route cannot be added here without the guard.
  app.addHook('preHandler', async (req, reply) => {
    if (!requireAdviser(req, reply)) return reply;
  });

  /**
   * The maps I have been asked to look at.
   *
   * For an ADMIN this answers with every map that has a live grant, rather than
   * with the admin's own (always empty) grants. The reason is that the only way to
   * check what an adviser is being shown is to look at it, and the alternative —
   * signing in as them — is the one thing an access model must never make
   * convenient. `mine` says which answer the caller got, so the page can say so
   * too rather than implying an admin has been asked for a view.
   */
  app.get('/maps', async (req, reply) => {
    const mine = req.user.role === 'adviser';
    const rows = mine
      ? listAdviserGrantsForUser(req.user.id)
      : listMapsWithLiveAdviserGrants();
    return {
      ok: true,
      mine,
      maps: rows.map((r) => ({
        id: r.map_id,
        name: r.map_name,
        kind: r.map_kind,
        subject: r.map_subject || null,
        askedAt: mine ? r.created_at : null,
        advisers: mine ? undefined : r.advisers,
      })),
    };
  });

  /** One map: what it is, which version is current, and which sheets it has. */
  app.get('/maps/:id', async (req, reply) => {
    const { map, grant, code, error } = loadAdvisedMap(Number(req.params.id), req.user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const shape = mapShape(map, grant);
    return { ok: true, map: { ...shape, sheets: shape.version ? sheetsFor(map, map.cur_key) : [] } };
  });

  /**
   * One sheet of the current version, as inline SVG, marked.
   *
   * THREE MARKINGS, AND EACH ANSWERS A DIFFERENT QUESTION.
   *
   *   draftStamp   rewrites the footer's own version line to "Draft 5.0 · 11 Sep
   *                2026 14:02". It is the line a reader looks at to ask *which*
   *                copy this is, and it is already how an unpublished download is
   *                marked for a customer — so an adviser and an editor read the
   *                same words about the same version.
   *   watermark    tiles "DRAFT — not published" across the artwork. This one is
   *                about the SCREENSHOT: there is no file here to forward, so the
   *                thing that leaves this page is a picture of it, and a picture
   *                carries nothing but its own pixels. An unverified sheet
   *                reaching a Facebook group is the failure this is for.
   *   the shell    says it again in words above the image, because a watermark is
   *                a warning and not an explanation.
   *
   * INLINE SVG AND NOT A FILE, for the same reason: it is scalable and readable at
   * any zoom, which is what a careful reader needs, and it is not a download. No
   * Content-Disposition, no .svg URL to right-click, and every `<a download>` the
   * other views offer is absent from this page's markup.
   *
   * Not cached in the module, unlike the public inline route, because an adviser
   * is looking at a version that MOVES — the working head is re-rendered on every
   * save, and a stale sheet here would be the one fault this whole seat exists to
   * remove.
   */
  app.get('/maps/:id/sheets/:base', async (req, reply) => {
    const { map, code, error } = loadAdvisedMap(Number(req.params.id), req.user);
    if (!map) return reply.code(code).send({ ok: false, error });
    const key = map.cur_key;
    if (!key) return reply.code(404).send({ ok: false, error: 'This map has nothing drawn yet.' });

    const base = str(req.params.base, 40);
    if (!sheetsFor(map, key).some((s) => s.base === base)) {
      return reply.code(404).send({ ok: false, error: 'No such sheet on this map.' });
    }
    const source = path.join(versionDir(map.id, key), `${base}.svg`);
    if (!existsSync(source)) return reply.code(404).send({ ok: false, error: 'Not found.' });

    const ver = getVersionById(map.current_version_id);
    let file = source;
    if (ver && ver.review_state !== 'published') {
      try {
        const marked = await ensureDraftMarked(source, draftLabel(ver.review_state, `${ver.major}.${ver.minor}`, ver.created_at));
        if (marked) file = marked;
      } catch (e) {
        // Same fall-back as the download route: a sheet we could not mark is still
        // watermarked below and still says DRAFT in the page around it.
        req.log.error(e);
      }
    }

    let svg;
    try {
      svg = inlineSvg(file, {
        title: `${map.name} — draft`,
        desc: 'An unpublished draft of a bus map, shown to a local adviser for comment.',
        onDrop: (what) => req.log.warn(`inline SVG sanitiser removed ${what} from adviser view of map ${map.id}/${base}`),
      });
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ ok: false, error: 'Could not prepare that sheet.' });
    }

    reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
    // An unpublished draft must not sit in a shared cache, and must not be re-read
    // from a private one either: the version behind this URL changes on every save.
    reply.header('Cache-Control', 'no-store');
    return reply.send(watermarkSvgDocument(svg, ADVISER_WATERMARK));
  });
}
