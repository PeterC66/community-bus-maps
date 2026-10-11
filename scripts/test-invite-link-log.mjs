// test-invite-link-log.mjs — a production container with no email provider does
// NOT print a live sign-in link to its log (codebase review 2026-10-11, portal G12).
//
//   node scripts/test-invite-link-log.mjs   (or: npm run test:invite-link-log)
//
// Run it from the repository root (`C:\Buses\community-bus-maps`). It takes no
// arguments and there are no placeholders; `--child` is the flag it passes to
// ITSELF, below, and is not for a caller.
//
// WHAT WAS WRONG. The three admin invite routes (approve an application, invite a
// user, grant a map to a local adviser) each did `if (!r.sent) console.log(link)`.
// `sendMagicLink` returns `sent:false` exactly when EMAIL_PROVIDER is unset — the
// development default, and also the state a misconfigured PRODUCTION container is
// in. The sign-in route was already gated (`signInSendable()` refuses that
// configuration under NODE_ENV=production); the invite routes were not, so a
// production instance with no provider wrote a bearer link for a real person into
// the container log, which the json-file driver keeps for 30 MB. The response
// field (`inviteLink`) already carried the link to the admin, so the print added
// nothing but exposure.
//
// WHAT THIS READS. Not a captured `console.log` — the process's REAL stdout. The
// scenario runs in a CHILD process so that NODE_ENV and EMAIL_PROVIDER are what
// the module snapshots at load (DEV_LINKS is read once), and so that the parent
// can assert on everything the child wrote, exactly as the container's log driver
// would see it. Two children, one variable between them:
//
//   production, no provider   -> stdout carries no `token=`, and the response
//                                STILL carries the link (the admin's copy is kept)
//   development, no provider  -> stdout DOES carry `token=` — the control, which
//                                proves the capture would have seen the leak
//
// Seen red first: run against the pre-fix routes, the production child printed
// the link and the first assertion failed.
//
// Runs against a throwaway DATA_DIR; it never touches real portal data, needs no
// network, and sends no email.

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

// --- the child: one admin, one invite, one approval, on a scratch database ---
if (process.argv.includes('--child')) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-test-invite-log-'));
  process.env.DATA_DIR = scratch;
  process.env.DB_PATH = path.join(scratch, 'portal.sqlite');
  process.env.CBM_NO_LISTEN = '1';
  delete process.env.EMAIL_PROVIDER;   // the no-provider state, in both children

  const db = await import('../src/db/index.js');
  const { app } = await import('../src/server.js');

  const sqlPlus = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
  const adminId = db.insertUser({ email: 'admin@example.com', name: 'Admin', role: 'admin', customer_id: null });
  const session = `tok-${adminId}-child`;
  db.insertSession(session, adminId, sqlPlus(7 * 86_400_000));
  const CSRF = 'test-csrf-token-value';
  const post = async (url, body) => {
    const r = await app.inject({
      method: 'POST', url,
      headers: { 'content-type': 'application/json', cookie: `cbm_session=${session}; cbm_csrf=${CSRF}`, 'x-csrf-token': CSRF },
      payload: body || {},
    });
    let json = null; try { json = r.json(); } catch { /* not JSON */ }
    return { status: r.statusCode, json };
  };

  const invite = await post('/api/admin/users', { email: 'editor@example.org', role: 'editor', name: 'An Editor' });
  const appnId = db.insertApplication({ org_name: 'Ely Town Council', org_type: 'council', contact_name: 'A Clerk', email: 'clerk@ely.example' });
  const approve = await post(`/api/admin/applications/${appnId}/approve`);
  // One line the parent can find and set aside: the responses are SUPPOSED to
  // carry the link, and must not be mistaken for the log.
  console.log(`RESPONSE ${JSON.stringify({ invite, approve })}`);
  await app.close();
  // The scratch folder is left for the OS, as the sibling suites leave theirs:
  // on Windows the open SQLite handle makes an rmSync here fail with EPERM.
  process.exit(0);
}

// --- the parent -----------------------------------------------------------
let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

function runChild(nodeEnv) {
  const env = { ...process.env, NODE_ENV: nodeEnv };
  delete env.EMAIL_PROVIDER;
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, encoding: 'utf8', timeout: 60_000 });
  const lines = (r.stdout || '').split(/\r?\n/);
  const responseLine = lines.find((l) => l.startsWith('RESPONSE '));
  const log = lines.filter((l) => !l.startsWith('RESPONSE ')).join('\n') + '\n' + (r.stderr || '');
  const responses = responseLine ? JSON.parse(responseLine.slice('RESPONSE '.length)) : null;
  return { status: r.status, log, responses };
}

console.log('\nProduction with no provider: the log carries no link');
const prod = runChild('production');
check('the child ran to completion', prod.status === 0, `exit ${prod.status}\n${prod.log}`);
check('the invite route answered 200', prod.responses?.invite?.status === 200, JSON.stringify(prod.responses?.invite));
check('the approve route answered 200', prod.responses?.approve?.status === 200, JSON.stringify(prod.responses?.approve));
check('…and both said the email did NOT go (no provider)',
  prod.responses?.invite?.json?.emailed === false && prod.responses?.approve?.json?.emailed === false);
check('the process wrote no `token=` to stdout or stderr', !/token=/.test(prod.log), prod.log.trim().slice(0, 400));
check('…while the invite RESPONSE still carries the link to the admin',
  /token=/.test(prod.responses?.invite?.json?.inviteLink || ''), JSON.stringify(prod.responses?.invite?.json));
check('…and so does the approve RESPONSE',
  /token=/.test(prod.responses?.approve?.json?.inviteLink || ''), JSON.stringify(prod.responses?.approve?.json));

console.log('\nThe control: in development the same two routes DO print the link');
const dev = runChild('test');
check('the child ran to completion', dev.status === 0, `exit ${dev.status}\n${dev.log}`);
const printed = (dev.log.match(/token=/g) || []).length;
check('the process printed a link for each of the two routes', printed === 2, `${printed} occurrence(s) of token=\n${dev.log.trim().slice(0, 400)}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
