// prove-red-operator-token.mjs — falsify the OPERATOR_TOKEN suite (OA-203).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-operator-token
//
// WHY THIS EXISTS. Almost everything OPERATOR_TOKEN adds is a REFUSAL — every
// route but two, every method but GET, every near-miss credential — and a
// refusal is the hardest thing to test green. A guard that has quietly stopped
// refusing passes every "the worklist still reads" assertion while handing a
// file-stored token the ability to approve organisations and invite admins,
// which is the exact fault the token exists to remove. A green run of
// test-operator-token.mjs means nothing until that suite has been watched go red.
//
// So each guard is broken ON PURPOSE and required to go red BY ITSELF, and the
// harness checks WHICH assertion objected rather than that something did. A
// mutation caught by the wrong assertion is reported as WRONG CAUSE: the suite
// would be sensitive to the damage, but not for the reason claimed.
//
// TWO PAIRS ARE THE POINT OF THE WHOLE FILE.
//
//   * "admits everybody" and "admits nobody" are the two directions of the same
//     guard. Only the second can be caught by the positive assertions, so
//     without it a suite of refusals would pass with the token switched off
//     entirely — the failure this project has met before, where a check was
//     green because its subject could not exist.
//
//   * "requireAdmin admits the token" and "…and the method guard is gone too"
//     differ by one line. The first leaves every POST refused; the second lets a
//     write through. That difference IS the evidence that `req.method !== 'GET'`
//     inside operatorRead() does something, which nothing else can show, because
//     both of the function's real call sites are GET handlers and a guard that
//     only ever sees GETs is otherwise indistinguishable from a constant.
//
// IT MUTATES A COPY AND NEVER THE REPOSITORY. `scripts/`, `src/`, `views/` and
// `public/` are copied into a scratch tree and the copy is damaged. Nothing is
// moved aside and restored, because a harness that restores in a `finally` still
// leaves the repository broken if it is killed between the two.

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
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-optoken-'));
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
    return { code: 0, out: execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-operator-token.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/* Matched on the whole line, anchored on the suite's own two-space indent: the
 * server logs JSON to stderr on every request and the suite writes em dashes
 * inside assertion names, so neither a split on ' — ' nor an unanchored '✗'
 * would read this output correctly. */
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
  console.log(`${results[0][0].padEnd(14)} ${results[0][1]}`);
  if (results[0][2]) console.log(`               ${results[0][2]}`);
  rmSync(tmp, { recursive: true, force: true });
}

const CHECK_TOKEN = '  return tokenMatches(bearerToken(req), process.env.OPERATOR_TOKEN);';
const ADMIT_AS_ADMIN = "  if (operatorRead(req)) return { id: 0, role: 'admin' };\n";

const MUTATIONS = [
  {
    what: 'operatorRead admits everybody',
    why: 'the credential stops being checked at all — the shape a refactor produces when a helper is inlined wrongly',
    edits: [['src/http/helpers.js', CHECK_TOKEN, '  return true;']],
    expect: 'no credential at all is still refused',
  },
  {
    what: 'operatorRead admits nobody',
    why: 'the other direction: without this arm the whole suite would pass with the token switched off, which is a check whose subject cannot exist',
    edits: [['src/http/helpers.js', CHECK_TOKEN, '  return false;']],
    expect: 'the token reads /api/admin/worklist',
  },
  {
    what: 'GET /api/maps stops accepting the token',
    why: 'half the worklist would silently print no maps rather than fail — the tool cross-references its local tree against this list',
    edits: [['src/server.js', '  const viaToken = operatorRead(req);', '  const viaToken = false;']],
    expect: 'the token reads /api/maps',
  },
  {
    what: 'GET /api/admin/worklist stops accepting it',
    why: 'the route the whole change exists for',
    // Re-anchored 2026-09-02 (OA-231): the route declares the exception as config and
    // the plugin's one guard reads it; switching the flag off is the same door closing.
    edits: [['src/routes/admin.js', "app.get('/worklist', { config: { operatorRead: true } }, async (req, reply) => {", "app.get('/worklist', { config: { operatorRead: false } }, async (req, reply) => {"]],
    expect: 'the token reads /api/admin/worklist',
  },
  {
    what: '/api/maps stops scoping its answer for anybody',
    why: 'the control that stops "the token sees both maps" being satisfied by a route that shows every customer their neighbours',
    edits: [['src/server.js', '  const scope = isAdmin ? {} : { customerId: user.customer_id };', '  const scope = {};']],
    expect: 'an editor session still sees only its own',
  },
  {
    what: 'requireAdmin admits the token, so it reaches every admin GET',
    why: 'the token spreading past its two routes is the failure the row was filed to avoid; the method guard still holds every write shut',
    edits: [['src/http/helpers.js', 'function requireAdmin(req, reply) {\n  if (!req.user) {', `function requireAdmin(req, reply) {\n${ADMIT_AS_ADMIN}  if (!req.user) {`]],
    expect: 'GET /api/admin/applications refuses the token',
  },
  {
    what: '…and the method guard is gone too, so it reaches every admin WRITE',
    why: 'the pair above minus one line. It is the only way to show that req.method !== GET does anything, both real call sites being GET handlers',
    edits: [
      ['src/http/helpers.js', 'function requireAdmin(req, reply) {\n  if (!req.user) {', `function requireAdmin(req, reply) {\n${ADMIT_AS_ADMIN}  if (!req.user) {`],
      ['src/http/helpers.js', "  if (req.method !== 'GET') return false;", '  if (false) return false;'],
    ],
    expect: 'POST a new admin user refuses it too',
  },
  {
    what: 'a third call site appears, on a route no forbidden-list names',
    why: 'the enumeration of forbidden routes can only cover what somebody remembered; this is the arm proving the source assertion covers the rest',
    edits: [['src/http/helpers.js', 'function requireApprover(req, reply) {\n  if (!req.user) {', `function requireApprover(req, reply) {\n${ADMIT_AS_ADMIN}  if (!req.user) {`]],
    expect: 'operatorRead is defined once and called exactly twice',
  },
  {
    what: 'an unset OPERATOR_TOKEN means everybody instead of nobody',
    why: 'a missing secret turning into an open door is the worst available reading of "unset", and every portal that has not set it yet is in that state',
    edits: [['src/http/helpers.js', CHECK_TOKEN, '  return !process.env.OPERATOR_TOKEN || tokenMatches(bearerToken(req), process.env.OPERATOR_TOKEN);']],
    expect: 'with OPERATOR_TOKEN unset, the token stops working',
  },
  {
    what: 'the ?token= query form comes back',
    why: 'technical-audit_2026-08-25 N7 — Caddy logs the full request URI, so a token in a query string is a live credential written in clear into a file under no retention rule',
    edits: [[
      'src/http/helpers.js',
      "const bearerToken = (req) => String(req.headers.authorization || '').replace(/^Bearer\\s+/i, '');",
      "const bearerToken = (req) => String(req.headers.authorization || (req.query && req.query.token) || '').replace(/^Bearer\\s+/i, '');",
    ]],
    expect: '?token= is not a way in',
  },
];

for (const m of MUTATIONS) {
  const tmp = scratch();
  let row;
  try {
    for (const [file, find, to] of m.edits) damage(tmp, file, find, to);
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
