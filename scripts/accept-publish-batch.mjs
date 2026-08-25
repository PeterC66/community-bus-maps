#!/usr/bin/env node
// accept-publish-batch.mjs — the mechanical half of "12 staged maps to accept
// + publish", automated; the judgement half stays human.
//
// This script does NOT decide which maps are fit to ship. It only executes,
// for maps someone has ALREADY looked at full resolution and approved, the
// same sequence a person would click through in the portal UI: withdraw any
// stale publish request -> accept the proposed refresh -> submit for review
// -> approve with the review checklist -> confirm the public API reflects it.
// The review checklist (appearance/legible/alternative) is the portal's own
// "recorded human confirmation" (src/publish/index.js) — this script ticks it
// on the strength of --reviewed-by having actually looked, exactly as an
// admin ticking it by hand in the UI would, not as a substitute for looking.
// Skipping the review pass and running this anyway defeats the one check that
// has caught a real regression before (the High Wycombe note-panel collision,
// 2026-08-19) — see Development Docs/open-actions.md in the buses-data repo.
//
//   npm run accept-publish -- --cookie "<cbm_session value>" \
//        --reviewed-by "Peter Cooper" --note "P1-round frequency tiers" --yes
//
//   npm run accept-publish -- --cookie "..." --reviewed-by "Peter Cooper" \
//        --only 30,31,33 --note "..."          (a subset of pending updates)
//
//   npm run accept-publish -- --dry-run --reviewed-by "Peter Cooper"
//        (no --cookie needed — lists the plan, makes no HTTP calls)
//
// --cookie is the value of the cbm_session cookie for an admin account —
// either pasted after signing in normally, or minted with --mint (below).
// Nothing here handles a password; the cookie is an opaque server-side
// session token, same as the browser carries.
//
// --mint does the same mint-and-revoke pattern used in earlier sessions: ssh
// into the host, insert one short-lived row in the `session` table for the
// admin user named by ADMIN_EMAIL (.env), drive every HTTP call over HTTPS,
// then delete that row and confirm — by reading it back — that it is gone.
// No user is created and no password is handled; every action this session
// token performs is audit-logged under the real admin account. That pattern
// was approved once (2026-08-18/19) and explicitly NOT as a standing
// approval — ask again before using --mint each time a new round runs.
//
// Side effects worth knowing before running this for real:
//   - Publishing re-renders nothing (accept does the rendering; publish is a
//     pure state flip), but accept DOES render, so a batch of N maps is N
//     renders, same cost as clicking through the UI N times.
//   - Each customer gets ONE digest email for the whole run ("N maps
//     published"), not one per map — see src/email/notify.js
//     compose('published-batch', ...) and the new
//     POST /api/admin/notify-published-batch. That's the whole point of this
//     script existing rather than just scripting the three existing HTTP
//     calls directly.
//   - A per-map failure is logged and the run continues to the next map
//     (the 12 maps are independent; one bad map's data has no bearing on
//     the other 11). An auth failure (401/403) on ANY call aborts the whole
//     remaining run immediately instead — that means the session died or was
//     never valid, and retrying it 11 more times would only produce 11 more
//     useless failures.
//
// Zero npm dependencies (Node >=22 for global fetch, matching package.json).

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const BASE_URL = (arg('base-url', process.env.PUBLIC_BASE_URL) || 'https://busmaps.uk').replace(/\/$/, '');
const REVIEWED_BY = arg('reviewed-by');
const NOTE = arg('note', '');
const ONLY = arg('only'); // comma-separated proposed-update ids, or unset = all pending
const YES = has('yes');
const DRY_RUN = has('dry-run');
const MINT = has('mint');
let COOKIE = arg('cookie');

if (!REVIEWED_BY) {
  console.error('✗ --reviewed-by "<name>" is required — this records who actually looked at the rendered sheets before this ran.');
  console.error('  This script does not look at anything itself; it only executes what --reviewed-by already approved.');
  process.exit(1);
}
if (!COOKIE && !MINT && !DRY_RUN) {
  console.error('✗ Need --cookie "<cbm_session value>" (sign in normally and copy the cookie) or --mint (ssh mint-and-revoke), or --dry-run to just see the plan.');
  process.exit(1);
}

const HOST = process.env.DEPLOY_HOST;
const SSH_KEY = process.env.DEPLOY_SSH_KEY;
const APP_DIR = process.env.DEPLOY_APP_DIR;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

function sshRun(remoteCmd) {
  const sshArgs = [...(SSH_KEY ? ['-i', SSH_KEY] : []), '-o', 'BatchMode=yes', HOST, remoteCmd];
  const r = spawnSync('ssh', sshArgs, { encoding: 'utf8' });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Mint a session row for the admin user named by ADMIN_EMAIL, 20 minutes'
// life — long enough for a 12-map round, short enough that leaving it behind
// by accident is not a standing hole. Reads the row back after inserting (not
// just trusting the INSERT's own exit code) and again after deleting it, per
// [[feedback_verify_claimed_actions]] — a stateful action is done when a read
// says so, not on an approval or a clean exit code.
function mintSession() {
  if (!HOST || !APP_DIR) throw new Error('--mint needs DEPLOY_HOST and DEPLOY_APP_DIR set (.env).');
  if (!ADMIN_EMAIL) throw new Error('--mint needs ADMIN_EMAIL set (.env) to know which user to mint a session for.');
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const crypto = require('crypto');
    const db = new DatabaseSync('/data/portal.sqlite');
    const user = db.prepare('SELECT id, email, role FROM user WHERE email = ? AND status = ?').get(${JSON.stringify(ADMIN_EMAIL)}, 'active');
    if (!user) { console.error('NO_SUCH_ADMIN'); process.exit(1); }
    if (user.role !== 'admin') { console.error('NOT_ADMIN:' + user.role); process.exit(1); }
    const token = crypto.randomBytes(32).toString('base64url');
    // The table holds the token's SHA-256, not the token (technical-audit_2026-08-25
    // N3). Inserting the raw value here would write a row the server can never
    // match, so the mint would appear to succeed and the first API call would 401
    // with nothing to explain it. The COOKIE still carries the raw token; only
    // the stored row is hashed.
    const stored = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 20 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)').run(stored, user.id, expires);
    const back = db.prepare('SELECT token FROM session WHERE token = ?').get(stored);
    if (!back) { console.error('INSERT_NOT_READABLE_BACK'); process.exit(1); }
    console.log('TOKEN:' + token);
  `.replace(/\n\s*/g, ' ');
  const r = sshRun(`cd ${APP_DIR} && docker compose exec -T portal node -e "${script.replace(/"/g, '\\"')}"`);
  const m = r.stdout.match(/TOKEN:(\S+)/);
  if (r.status !== 0 || !m) throw new Error(`mint failed (status ${r.status}): ${r.stderr || r.stdout}`);
  return m[1];
}

function revokeSession(token) {
  if (!HOST || !APP_DIR) return { revoked: false, reason: 'no host config' };
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/data/portal.sqlite');
    const crypto = require('crypto');
    const stored = crypto.createHash('sha256').update(${JSON.stringify(token)}).digest('hex');
    db.prepare('DELETE FROM session WHERE token = ?').run(stored);
    const back = db.prepare('SELECT token FROM session WHERE token = ?').get(stored);
    console.log(back ? 'STILL_PRESENT' : 'GONE');
  `.replace(/\n\s*/g, ' ');
  const r = sshRun(`cd ${APP_DIR} && docker compose exec -T portal node -e "${script.replace(/"/g, '\\"')}"`);
  return { revoked: r.stdout.includes('GONE'), raw: r.stdout.trim() };
}

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `cbm_session=${COOKIE}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`auth failed (${res.status}) on ${method} ${urlPath}: ${json?.error || res.statusText}`);
    e.authFailure = true;
    throw e;
  }
  if (!res.ok || !json || json.ok === false) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${json?.error || res.statusText}`);
  }
  return json;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  console.log('== accept-publish-batch ==');
  console.log(`  base URL    : ${BASE_URL}`);
  console.log(`  reviewed by : ${REVIEWED_BY}`);
  console.log(`  note        : ${NOTE || '(none)'}`);
  console.log(`  mode        : ${DRY_RUN ? 'DRY RUN — no calls will be made' : MINT ? 'mint-and-revoke session' : 'pasted cookie'}`);
  console.log('');

  if (MINT && !DRY_RUN) {
    console.log('-- minting a short-lived admin session on the host...');
    COOKIE = mintSession();
    console.log('✓ session minted (20 min lifetime), confirmed present by reading it back.');
  }

  let updates = [];
  if (!DRY_RUN) {
    const r = await api('GET', '/api/admin/proposed-updates');
    updates = r.updates;
  }
  if (ONLY) {
    const wanted = new Set(ONLY.split(',').map((s) => Number(s.trim())));
    updates = updates.filter((u) => wanted.has(u.id));
  }

  if (DRY_RUN) {
    console.log('(dry run — would fetch /api/admin/proposed-updates and process whatever is pending'
      + (ONLY ? ` restricted to ids [${ONLY}]` : '') + ')');
    console.log('\nNo calls made. Re-run with --cookie or --mint (and drop --dry-run) once you are ready.');
    return;
  }

  if (!updates.length) {
    console.log('Nothing pending to accept + publish. Nothing to do.');
    if (MINT) { const rv = revokeSession(COOKIE); console.log(`session revoked: ${rv.revoked ? 'confirmed gone' : 'NOT CONFIRMED — ' + rv.raw}`); }
    return;
  }

  console.log(`-- ${updates.length} map(s) pending:`);
  for (const u of updates) console.log(`   #${u.id}  ${u.map.name}  (map ${u.map.id})`);
  if (!YES) {
    const answer = await ask(`\nType "yes" to accept + publish all ${updates.length} listed above (as reviewed by ${REVIEWED_BY}): `);
    if (answer.trim().toLowerCase() !== 'yes') { console.log('Aborted — nothing was changed.'); return; }
  }

  const results = [];
  let aborted = false;
  for (const u of updates) {
    const label = `${u.map.name} (#${u.id})`;
    const entry = { id: u.id, mapId: u.map.id, mapName: u.map.name, steps: {}, ok: false };
    results.push(entry);
    if (aborted) { entry.steps.skipped = 'run aborted after an earlier auth failure'; continue; }
    try {
      console.log(`\n-- ${label}`);
      // GET /api/maps/:id answers `{ ok, map: mapDetail(m) }` — everything about the
      // map is one level DOWN. Reading `detail.pendingRequest` and `detail.slug` off
      // the envelope silently yielded undefined: the withdraw step never fired, and
      // the verify below fetched /api/public/maps/undefined, got a 404 body with no
      // `map` in it, and reported `public API reports "undefined"` for all eleven
      // maps in the 2026-08-19 batch — every one of which had in fact published
      // correctly. A uniform failure across every item is the tell that the fault is
      // in the harness, not the work.
      const { map: detail } = await api('GET', `/api/maps/${u.map.id}`);
      if (detail.pendingRequest) {
        console.log(`   withdrawing stale publish request #${detail.pendingRequest.id} first`);
        await api('POST', `/api/maps/${u.map.id}/publish-request/withdraw`, {});
        entry.steps.withdrew = detail.pendingRequest.id;
      }

      const noteText = `${NOTE ? NOTE + ' — ' : ''}reviewed by ${REVIEWED_BY} (batch)`;
      const accepted = await api('POST', `/api/maps/${u.map.id}/proposed/${u.id}/accept`, { note: noteText });
      entry.steps.accepted = accepted.version;
      console.log(`   accepted -> ${accepted.version}`);

      const submitted = await api('POST', `/api/maps/${u.map.id}/publish-request`, { note: noteText });
      entry.steps.submitted = submitted.request.id;
      console.log(`   submitted -> request #${submitted.request.id}`);

      const approved = await api('POST', `/api/review/${submitted.request.id}/approve`, {
        checklist: { appearance: true, legible: true, alternative: true },
        note: noteText,
        suppressNotify: true,
      });
      entry.steps.published = approved.publishedVersion;
      entry.customerId = approved.customerId;
      entry.mapUrl = `${BASE_URL}/app/maps/${u.map.id}`;
      entry.publicUrl = approved.publicUrl;
      console.log(`   published -> ${approved.publishedVersion}`);

      // Verify against the PUBLIC API, cache-busted, not the admin response —
      // per [[feedback_verify_claimed_actions]], the claim isn't trusted until
      // a read confirms it independently of the call that made the change.
      const slug = detail.slug;
      if (!slug) throw new Error('no slug on the map detail — cannot verify publication');
      const check = await fetch(`${BASE_URL}/api/public/maps/${slug}?_=${Date.now()}`, { cache: 'no-store' });
      const checkJson = await check.json().catch(() => null);
      // Distinguish "the map says the wrong version" from "the check itself did not
      // work". Reporting the second as the first is what made a clean run of eleven
      // look like a total failure.
      if (!check.ok || !checkJson || !checkJson.map) {
        throw new Error(`verification request failed: HTTP ${check.status} from /api/public/maps/${slug}`
          + (checkJson && checkJson.error ? ` — ${checkJson.error}` : ''));
      }
      const liveVersion = checkJson.map.version;
      if (liveVersion === approved.publishedVersion) {
        entry.steps.verified = liveVersion;
        entry.ok = true;
        console.log(`   verified live -> ${liveVersion}`);
      } else {
        entry.steps.verifyFailed = `public API reports "${liveVersion}", expected "${approved.publishedVersion}"`;
        console.log(`   ✗ VERIFY MISMATCH: ${entry.steps.verifyFailed}`);
      }
    } catch (e) {
      entry.steps.error = e.message;
      console.log(`   ✗ ${e.message}`);
      if (e.authFailure) {
        aborted = true;
        console.log('\n✗ Auth failure — aborting the rest of this run rather than repeating the same failure on every remaining map.');
      }
    }
  }

  const okResults = results.filter((r) => r.ok);
  if (okResults.length) {
    console.log(`\n-- sending one digest email per customer for ${okResults.length} published map(s)...`);
    const items = okResults.map((r) => ({
      customerId: r.customerId, mapName: r.mapName, versionKey: r.steps.published,
      mapUrl: r.mapUrl, publicUrl: r.publicUrl,
    }));
    try {
      const digest = await api('POST', '/api/admin/notify-published-batch', { items });
      for (const d of digest.results) console.log(`   customer #${d.customerId}: ${d.sent} sent, ${d.skipped} skipped (${d.maps} map(s))`);
    } catch (e) {
      console.log(`   ✗ digest send failed (the publishes above already happened regardless): ${e.message}`);
    }
  }

  if (MINT) {
    console.log('\n-- revoking the minted session...');
    const rv = revokeSession(COOKIE);
    console.log(`   ${rv.revoked ? '✓ confirmed gone' : '✗ NOT CONFIRMED — ' + rv.raw + ' (check the host by hand)'}`);
  }

  const reportDir = path.join(process.cwd(), 'data', 'accept-publish-reports');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(reportPath, JSON.stringify({ reviewedBy: REVIEWED_BY, note: NOTE, results }, null, 2));

  console.log('\n== summary ==');
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.mapName} (#${r.id})${r.ok ? '' : '  — ' + (r.steps.error || r.steps.verifyFailed || r.steps.skipped)}`);
  console.log(`\n${okResults.length}/${results.length} published and verified. Report: ${reportPath}`);
  if (okResults.length !== results.length) process.exitCode = 1;
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
