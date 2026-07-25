// Ops instrumentation (P7).
//
// Everything an operator needs to answer "is this healthy, and what is it using?"
// without shelling into the box: a readiness probe that actually exercises the
// three things that break (the database, the object store, the rasteriser), and a
// snapshot of size/activity used by `/api/admin/ops`, the admin console's Ops tab
// and the optional `/metrics` endpoint.
//
// Nothing here mutates anything, and every probe fails soft — a monitoring
// endpoint that throws is worse than one that reports a problem.

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { db, DATA_DIR } from '../db/index.js';
import { MAPS_DIR, mapDir, mapDataDir, rendersDir, proposedRoot, archiveRoot } from '../maps/store.js';
import { ENGINE_DIR } from '../render/renderMap.js';
import { EXPERT_DIR } from '../maps/engine.js';

const STARTED = Date.now();

/** Recursive size of a folder in bytes (0 when it does not exist). */
export function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else { try { total += statSync(p).size; } catch { /* vanished */ } }
    }
  }
  return total;
}

/**
 * Readiness: the DB answers, the object store is writable, the engine files are
 * present, and sharp can rasterise. Used by `/health?deep=1` and by the deploy
 * docs' smoke test.
 */
export async function readiness() {
  const checks = {};
  try {
    db.prepare('SELECT COUNT(*) AS c FROM map').get();
    checks.database = { ok: true };
  } catch (e) { checks.database = { ok: false, error: e.message }; }

  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, `.write-probe-${process.pid}`);
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    checks.objectStore = { ok: true, path: DATA_DIR };
  } catch (e) { checks.objectStore = { ok: false, error: e.message }; }

  const engineFiles = ['render.js', 'icons.js'].map((f) => path.join(ENGINE_DIR, f));
  const expertFiles = ['gen_internal_schematic.js', 'gen_internal_diagram.js', 'schematize_internal.js', 'diagram_internal.js']
    .map((f) => path.join(EXPERT_DIR, f));
  const missing = [...engineFiles, ...expertFiles].filter((f) => !existsSync(f)).map((f) => path.basename(f));
  checks.engine = missing.length ? { ok: false, missing } : { ok: true };

  try {
    // 8x8 white PNG → JPEG: proves libvips is loadable and can encode.
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    checks.rasteriser = { ok: true, sharp: sharp.versions.sharp, vips: sharp.versions.vips };
  } catch (e) { checks.rasteriser = { ok: false, error: e.message }; }

  return { ok: Object.values(checks).every((c) => c.ok), checks };
}

/** Per-map disk usage + version counts, plus totals. */
export function storageSnapshot() {
  const rows = db.prepare('SELECT id, slug, name, kind FROM map WHERE data_dir <> \'\' ORDER BY id').all();
  const maps = rows.map((m) => {
    const renders = dirSize(rendersDir(m.id));
    const data = dirSize(mapDataDir(m.id));
    const staged = dirSize(proposedRoot(m.id));
    const archived = dirSize(archiveRoot(m.id));
    let versions = 0;
    try { versions = readdirSync(rendersDir(m.id)).length; } catch { /* none yet */ }
    return {
      id: m.id, slug: m.slug, name: m.name, kind: m.kind,
      bytes: { data, renders, staged, archived, total: dirSize(mapDir(m.id)) },
      versions,
    };
  });
  const sum = (f) => maps.reduce((a, m) => a + f(m), 0);
  return {
    dataDir: DATA_DIR,
    mapsDir: MAPS_DIR,
    totals: {
      maps: maps.length,
      bytes: sum((m) => m.bytes.total),
      dataBytes: sum((m) => m.bytes.data),
      renderBytes: sum((m) => m.bytes.renders),
      // Reclaimable: staged payloads of settled refreshes + archived old data.
      stagedBytes: sum((m) => m.bytes.staged),
      archivedBytes: sum((m) => m.bytes.archived),
      versions: sum((m) => m.versions),
    },
    maps,
  };
}

/** Counts + the few dates an operator looks at, for the Ops tab. */
export function activitySnapshot() {
  const one = (sql) => db.prepare(sql).get();
  return {
    versions: one('SELECT COUNT(*) AS c FROM map_version').c,
    publishedMaps: one('SELECT COUNT(*) AS c FROM map WHERE published_version_id IS NOT NULL').c,
    pendingPublishRequests: one("SELECT COUNT(*) AS c FROM publish_request WHERE status = 'pending'").c,
    pendingProposedUpdates: one("SELECT COUNT(*) AS c FROM proposed_update WHERE status = 'pending'").c,
    settledProposedUpdates: one("SELECT COUNT(*) AS c FROM proposed_update WHERE status <> 'pending'").c,
    auditEvents: one('SELECT COUNT(*) AS c FROM audit_log').c,
    sessions: one("SELECT COUNT(*) AS c FROM session WHERE expires_at > datetime('now')").c,
    lastVersionAt: (one('SELECT MAX(created_at) AS c FROM map_version') || {}).c || null,
    lastPublishAt: (one("SELECT MAX(created_at) AS c FROM audit_log WHERE action = 'version.publish'") || {}).c || null,
    lastAuditAt: (one('SELECT MAX(created_at) AS c FROM audit_log') || {}).c || null,
  };
}

export function processSnapshot(version) {
  const mem = process.memoryUsage();
  return {
    version,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    pid: process.pid,
    uptimeSeconds: Math.round((Date.now() - STARTED) / 1000),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
  };
}

/** The whole picture (admin Ops tab). */
export async function opsSnapshot(version) {
  return {
    at: new Date().toISOString(),
    process: processSnapshot(version),
    readiness: await readiness(),
    activity: activitySnapshot(),
    storage: storageSnapshot(),
  };
}

/**
 * Prometheus text exposition of the same numbers — flat, no dependencies. Kept
 * deliberately small: sizes, counts and readiness, which is what a single-VM
 * deployment actually alerts on.
 */
export async function metricsText(version) {
  const s = storageSnapshot();
  const a = activitySnapshot();
  const p = processSnapshot(version);
  const r = await readiness();
  const lines = [];
  const push = (name, help, type, value, labels = '') => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}${labels} ${value}`);
  };
  push('cbm_up', 'Portal readiness (1 = every dependency healthy).', 'gauge', r.ok ? 1 : 0);
  push('cbm_uptime_seconds', 'Seconds since this process started.', 'gauge', p.uptimeSeconds);
  push('cbm_rss_bytes', 'Resident set size of the portal process.', 'gauge', p.rssBytes);
  push('cbm_maps_total', 'Maps with an object store.', 'gauge', s.totals.maps);
  push('cbm_maps_published_total', 'Maps with a published version.', 'gauge', a.publishedMaps);
  push('cbm_versions_total', 'Rendered map versions.', 'gauge', a.versions);
  push('cbm_store_bytes', 'Object-store bytes in use.', 'gauge', s.totals.bytes);
  push('cbm_store_render_bytes', 'Object-store bytes held by rendered versions.', 'gauge', s.totals.renderBytes);
  push('cbm_store_reclaimable_bytes', 'Staged + archived bytes a prune could reclaim.', 'gauge', s.totals.stagedBytes + s.totals.archivedBytes);
  push('cbm_publish_requests_pending', 'Versions awaiting sign-off.', 'gauge', a.pendingPublishRequests);
  push('cbm_proposed_updates_pending', 'Monthly updates awaiting a customer decision.', 'gauge', a.pendingProposedUpdates);
  push('cbm_sessions_active', 'Unexpired sign-in sessions.', 'gauge', a.sessions);
  for (const [name, c] of Object.entries(r.checks)) {
    push('cbm_check_ok', 'Per-dependency readiness (1 = healthy).', 'gauge', c.ok ? 1 : 0, `{check="${name}"}`);
  }
  return lines.join('\n') + '\n';
}
