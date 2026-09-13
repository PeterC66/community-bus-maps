// prove-red-sitemap.mjs — falsify the sitemap check (buses-data OA-284).
//
// Run from the repository root (no placeholders):
//     npm run test:prove-red-sitemap
//
// A green check that has never been seen to go red proves nothing, and this one
// was written the day its subject was fixed — so every assertion in it has only
// ever run against a site that already passes. Each arm below damages a COPY of
// the repository, re-runs `test-sitemap.mjs` inside that copy, and requires the
// verdict to name the fault it introduced. A mutation caught by a different
// message is a WRONG CAUSE and is reported as a problem, not as a pass.
//
// THE SIX ARMS ARE THE SIX THINGS THE CHECK CLAIMS TO SEE:
//
//   A  the organisation page goes back to a bare sendFile — THE bug, exactly as
//      it stood on the live site on 2026-09-08.
//   B  every organisation page gets the same title again. Silent with one
//      organisation and the whole reason this sat unnoticed; the test seeds two.
//   C  a canonical that points somewhere other than the advertised URL — the
//      `www` half of the same fault, which the Caddyfile's 308 masks.
//   D  the same fault on the MAP page, because the rule is about every shell the
//      server fills and not about the one that happened to be broken.
//   E  the shell's own <title> survives the splice, so the document has two.
//   F  THE ARM THAT MATTERS MOST: the sitemap stops advertising organisations at
//      all. The check's population is the sitemap's own, so a subject that
//      vanishes would otherwise take every assertion about it quietly green.
//      This is the shape that let a rule sit half-enforced in the first place.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbm-prove-sitemap-'));
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

/** Edit one file in the copy. A stale anchor is a broken HARNESS, not a finding. */
function damage(tmp, rel, find, replace) {
  const p = path.join(tmp, rel);
  const src = readFileSync(p, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`stale anchor in ${rel}: matched ${n} times, wanted 1\n  ${find}`);
  writeFileSync(p, src.replace(find, replace));
}

function runTest(tmp) {
  try {
    const out = execFileSync(process.execPath, [path.join(tmp, 'scripts', 'test-sitemap.mjs')],
      { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function arm(edits) {
  const tmp = scratch();
  try {
    for (const [rel, find, to] of edits) damage(tmp, rel, find, to);
    return runTest(tmp);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows holds the sqlite file briefly */ }
  }
}

// The `<title>`-stripping line of sendShell(), written raw so the harness's own
// copy of it cannot drift from the source through an escaping mistake.
const TITLE_STRIP = String.raw`.replace(/[ \t]*<title>[\s\S]*?<\/title>\r?\n?/i, '')`;

let problems = 0;
const results = [];

{
  const r = arm([]);
  if (r.code !== 0) {
    problems++;
    results.push(['✗ CONTROL', 'an intact copy passes', r.out.split('\n').filter((l) => l.includes('✗')).slice(0, 3).join(' | ') || r.out.slice(-400)]);
  } else {
    results.push(['ok CONTROL', 'an intact copy passes', 'both seeded organisations, both maps and all thirteen static pages']);
  }
}

const MUTATIONS = [
  {
    what: 'the organisation page goes back to a bare sendFile',
    why: 'THE fault, exactly as it stood on busmaps.uk on 2026-09-08: the raw shell, no canonical, and sitemap.xml advertising it anyway',
    edits: [['src/routes/public.js',
      "    return sendShell(reply, 'org.html', orgHead(req, publicOrg(pub)));",
      "    return reply.sendFile('org.html');"]],
    expect: '/o/testbury-town-council — no <link rel="canonical">',
  },
  {
    what: 'every organisation page gets the same title again',
    why: 'the half a live check against a one-organisation site cannot make. Two pages that each look perfect and are identical to each other is the fault that arrives with organisation number two',
    edits: [['src/routes/public.js',
      '    const title = `Bus maps published by ${org.name}`;',
      "    const title = 'An organisation’s bus maps';"]],
    expect: 'share a title',
  },
  {
    what: 'the organisation page names a different host in its canonical',
    why: 'the www/apex half. The Caddyfile 308s one to the other, so this is invisible to anything that only asks whether the page answers',
    edits: [['src/routes/public.js',
      '    const canonical = base + orgPageUrl(org.slug);',
      "    const canonical = 'https://www.busmaps.uk' + orgPageUrl(org.slug);"]],
    expect: '/o/testbury-town-council — its canonical says',
  },
  {
    what: 'the MAP page names a different host in its canonical',
    why: 'the rule is about every shell the server fills, not about the one that happened to be broken. Without this arm the check would be an OA-284 regression test rather than a standing rule',
    edits: [['src/routes/public.js',
      '    const canonical = base + (services ? servicesPageUrl(m.slug) : mapPageUrl(m.slug));',
      "    const canonical = 'https://www.busmaps.uk' + (services ? servicesPageUrl(m.slug) : mapPageUrl(m.slug));"]],
    expect: '/m/testbury — its canonical says',
  },
  {
    what: "the shell's own <title> survives the splice",
    why: 'the failure a page gets from being half-completed: two titles, and the browser takes whichever came first in the file rather than the computed one',
    edits: [['src/routes/public.js', TITLE_STRIP, '']],
    expect: '<title> tags',
  },
  {
    what: 'the sitemap stops advertising organisations at all',
    why: 'the arm that stops this check going quietly green. Its population is the sitemap itself, so a subject that disappears takes every assertion about it with it — and reads as a clean run',
    edits: [['src/routes/public.js',
      '      ...orgs.map((o) => url(orgPageUrl(o.slug))),\n',
      '']],
    expect: 'the ORGANISATION pages are among them',
  },
];

for (const m of MUTATIONS) {
  let r;
  try { r = arm(m.edits); }
  catch (e) { problems++; results.push(['✗ HARNESS', m.what, e.message.split('\n')[0]]); continue; }
  if (r.code === 0) { problems++; results.push(['✗ SURVIVED', m.what, 'the check stayed green']); }
  else if (!r.out.includes(m.expect)) {
    problems++;
    results.push(['✗ WRONG CAUSE', m.what,
      `expected "${m.expect}"; got: ${r.out.split('\n').filter((l) => l.includes('✗')).join(' | ').slice(0, 240)}`]);
  } else results.push(['ok caught', m.what, m.expect]);
}

console.log('\nprove-red-sitemap — a page that does not say which URL it is, and a subject that disappears\n');
for (const [verdict, what, detail] of results) {
  console.log(`  ${verdict.padEnd(14)} ${what}`);
  if (detail) console.log(`                 ${detail}`);
}
const caught = results.filter((r) => r[0] === 'ok caught').length;
console.log(`\n${MUTATIONS.length} mutations, ${caught} caught for their own reason, control ${results[0][0].startsWith('ok') ? 'green' : 'RED'}.`);
if (problems) {
  console.log('\nA SURVIVED mutation is a hole in test-sitemap.mjs. A WRONG CAUSE is a different\nhole: it noticed, but not through the assertion that claims to be about it.');
}
process.exit(problems ? 1 : 0);
