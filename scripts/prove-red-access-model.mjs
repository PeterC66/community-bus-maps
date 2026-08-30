// prove-red-access-model.mjs — falsify the access-model round (OA-008, OA-183).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-access-model
//
// WHY THIS EXISTS. Almost everything the round added is a REFUSAL — a disabled
// account's session refused, an unowned import refused, an over-quota move
// refused — and a refusal is the hardest thing to test green. Code that has
// quietly stopped refusing passes every "an active user can still do X"
// assertion while letting a switched-off account keep working, which is the
// exact fault the round exists to close. A green run of test-access-model.mjs
// means nothing until that suite has been watched go red.
//
// So each guard is broken ON PURPOSE and required to go red BY ITSELF, and the
// harness checks WHICH assertion objected rather than that something did. A
// mutation caught by the wrong assertion is reported as WRONG CAUSE: it would
// mean the suite is sensitive to the damage, but not for the reason claimed.
//
// TWO OF THE MUTATIONS BREAK A CONTROL RATHER THAN A REFUSAL — a guard that
// refuses EVERYBODY, and a revocation that fires on every save. Those are the
// arms that prove the paired controls are load-bearing, which is the whole
// reason the suite has them: a test that only asserts a refusal passes just as
// well when the route is broken for everyone.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `scripts/`, `src/`, `views/` and
// `public/` are copied into a scratch tree and the copy is damaged. Nothing is
// moved aside and restored, because a harness that restores in a `finally`
// still leaves the repository broken if it is killed between the two.

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* The suite reaches for its subjects relative to its own location, so a copy of
 * it runs the copied, damaged code. `node_modules/` and `engine/` are linked
 * rather than copied — they are large, and nothing here damages them. */
function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-access-'));
  for (const dir of ['scripts', 'src', 'views', 'public']) {
    cpSync(path.join(ROOT, dir), path.join(tmp, dir), { recursive: true });
  }
  for (const dir of ['node_modules', 'engine']) {
    const from = path.join(ROOT, dir), to = path.join(tmp, dir);
    try { symlinkSync(from, to, 'junction'); }
    catch { cpSync(from, to, { recursive: true }); }
  }
  writeFileSync(path.join(tmp, 'package.json'), readFileSync(path.join(ROOT, 'package.json')));
  return tmp;
}

/** Edit one file in the scratch copy. Fails loudly if the anchor has moved — a
 *  mutation whose anchor no longer matches is a STALE harness, not a pass. */
function damage(tmp, rel, find, replace) {
  const p = path.join(tmp, rel);
  const src = readFileSync(p, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`stale anchor in ${rel}: matched ${n} times, wanted 1\n  ${find}`);
  writeFileSync(p, src.replace(find, replace));
}

function runSuite(tmp) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-access-model.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/* Matched on the whole line, not split on ' — ': the suite uses an em dash both
 * as its name/detail separator AND inside several assertion names, so splitting
 * would truncate every expected name at its first dash.
 *
 * Anchored on the suite's own two-space indent, because the suite SPAWNS the
 * importer and relays its stdout — and the importer's own refusals are written
 * with a leading "✗" too. An unanchored match reported "✗ --src not found" as a
 * failed assertion, which is a harness misreading its subject's output: the same
 * fault it is here to catch, one level up. */
const failedLines = (out) => out.split('\n').filter((l) => /^ {2}✗ /.test(l));
const caughtBy = (out, name) => failedLines(out).some((l) => l.includes(name));

let problems = 0;
const results = [];

// ---------------------------------------------------------------- 0. control
{
  const tmp = scratch();
  const r = runSuite(tmp);
  if (r.code !== 0) { problems++; results.push(['✗ CONTROL', 'an intact copy did not pass — the copy is broken, not the guards', failedLines(r.out).map((l) => l.trim()).join(' | ')]); }
  else results.push(['ok CONTROL', 'an intact copy passes', '']);
  rmSync(tmp, { recursive: true, force: true });
}

const MUTATIONS = [
  {
    what: 'the request hook stops looking at user.status',
    why: 'this is the state the row found — status checked on the way IN and never on the way through',
    file: 'src/server.js',
    find: "if (req.user && req.user.status !== 'active') {",
    to: 'if (false) {',
    expect: 'a disabled account is refused (403)',
  },
  {
    what: 'the hook refuses EVERY account instead of the switched-off ones',
    why: 'proves the paired controls bite: a suite that only asserts refusals is green when the door is shut on everybody',
    file: 'src/server.js',
    find: "if (req.user && req.user.status !== 'active') {",
    to: 'if (req.user) {',
    expect: 'an active user reaches /api/me',
  },
  {
    what: 'the hook refuses the request but leaves the session row alive',
    why: 'the credential surviving is what makes the admin Sessions tab list a phantom, and what the two-step workaround existed for',
    file: 'src/server.js',
    find: '    deleteSession(sessionToken);',
    to: '    void sessionToken;',
    expect: '…and the session row was deleted',
  },
  {
    what: 'the hook refuses /api/auth/ as well',
    why: 'a disabled person told 403 by the only route that would clear their own cookie',
    file: 'src/server.js',
    find: "if (u.startsWith('/api/') && !u.startsWith('/api/auth/')) {",
    to: "if (u.startsWith('/api/')) {",
    expect: 'a disabled account may still log out',
  },
  {
    what: 'disabling through the admin route stops revoking sessions',
    why: 'this is the second half of the finding — the window left open at the moment it most needs closing',
    file: 'src/server.js',
    find: '    revokedSessions = deleteSessionsForUser(u.id);',
    to: '    revokedSessions = 0;',
    expect: '…and revokes all three of its live sessions',
  },
  {
    what: 'every user save revokes that user\'s sessions',
    why: 'the other control: a revocation that always fires satisfies the assertion above and signs everybody out on a rename',
    file: 'src/server.js',
    find: "  if (updated.status !== 'active' && u.status === 'active') {",
    to: '  if (true) {',
    expect: 'renaming a user revokes nothing',
  },
  {
    what: 'one app shell drops the client-side guard',
    why: 'eight script tags is exactly the list that is right on the day it is written; the ninth shell is the one nobody adds it to',
    file: 'views/app/editor.html',
    find: '  <script src="/js/account-guard.js"></script>\n',
    to: '',
    expect: 'every app shell loads /js/account-guard.js',
  },
  {
    what: 'the owner route stops counting quota',
    why: 'moving a map between tenants spends a slot in the receiving one; unchecked, it is silently overspent',
    file: 'src/server.js',
    find: '    if (cap != null && held >= cap) {',
    to: '    if (false) {',
    expect: 'a move that would overspend quota is refused',
  },
  {
    what: 'the owner route accepts any signed-in user',
    why: 'a route that re-homes an asset between tenants is not one an editor may travel',
    file: 'src/server.js',
    find: "app.post('/api/admin/maps/:id/owner', async (req, reply) => {\n  if (!requireAdmin(req, reply)) return;",
    to: "app.post('/api/admin/maps/:id/owner', async (req, reply) => {\n  if (!requireUser(req, reply)) return;",
    expect: 'an editor is refused the owner route',
  },
  {
    what: 'the importer goes back to warning and carrying on',
    why: 'the exact prior behaviour — a console.warn, then submit, review, publish, and a 404',
    file: 'scripts/import-map.mjs',
    find: "if (!request && !process.argv.includes('--customer') && !allowUnowned) {",
    to: 'if (false) {',
    expect: 'the importer refuses a map with no --customer',
  },
  {
    what: 'the importer refuses even when --unowned is given',
    why: 'a refusal with no way through is one that gets bypassed with a hand-written INSERT within a week',
    file: 'scripts/import-map.mjs',
    find: "const allowUnowned = has('unowned');",
    to: 'const allowUnowned = false;',
    expect: '…and --unowned is still an explicit way through',
  },
];

for (const m of MUTATIONS) {
  const tmp = scratch();
  let row;
  try {
    damage(tmp, m.file, m.find, m.to);
    const r = runSuite(tmp);
    if (r.code === 0) {
      problems++;
      row = ['✗ SURVIVED', m.what, 'the suite stayed GREEN — nothing is testing this'];
    } else if (caughtBy(r.out, m.expect)) {
      row = ['ok caught', m.what, `by "${m.expect}"`];
    } else {
      problems++;
      row = ['✗ WRONG CAUSE', m.what, `expected "${m.expect}", got: ${failedLines(r.out).map((l) => l.trim()).join(' | ') || '(no ✗ line)'}`];
    }
  } catch (e) {
    problems++;
    row = ['✗ STALE', m.what, e.message];
  }
  rmSync(tmp, { recursive: true, force: true });
  results.push(row);
  console.log(`${row[0].padEnd(14)} ${row[1]}`);
  if (row[2]) console.log(`               ${row[2]}`);
}

console.log(`\n${MUTATIONS.length} mutations + 1 control.`);
if (problems) {
  console.error(`${problems} arm(s) did not behave — the suite is not proving what it claims.\n`);
  process.exit(1);
}
console.log('Every mutation was caught, by the assertion named for it, and the control stayed green.\n');
