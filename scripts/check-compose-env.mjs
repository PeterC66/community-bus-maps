// check-compose-env.mjs — every variable the app READS must be one the container
// is actually GIVEN (OA-203, 2026-08-31).
//
//   npm run check:compose-env          (also runs inside `npm test`)
//
// THE TRAP. The `portal` service in compose.yaml has no `env_file`. Compose reads
// `.env` only to substitute `${VARS}` into that file, so a key present and
// correctly spelled in the host's `.env` never reaches the container unless it is
// ALSO named under `environment:`. The failure is silent in the worst way: the
// operator sees the value in the file, the app takes its unset branch, and
// nothing anywhere says the two disagree.
//
// IT HAS NOW HAPPENED FOUR TIMES — ALLOW_SELF_APPROVAL and ALLOW_INDEXING
// (2026-08-21), BACKUP_RECIPIENT (2026-08-25), OPERATOR_TOKEN (2026-08-31) — and
// compose.yaml has carried a capitalised warning about it since the second. The
// fourth was sprung by somebody who had READ that warning earlier the same hour.
// That is the useful part: the warning is in compose.yaml, and compose.yaml is
// not the file you open when you add a config variable. You open `.env.example`
// and `docs/DEPLOY.md`. A guard placed where the mistake is made is a guard; a
// guard placed where the mistake is EXPLAINED is a comment.
//
// WHAT COUNTS AS "GIVEN". Two sources, both real: the `environment:` block of the
// portal service, and the Dockerfile's own `ENV`, which is why HOST, PORT and
// DATA_DIR need no compose line. Anything else must appear in EXEMPT below with a
// reason — so "this one is deliberate" is on the record rather than being the
// absence of a complaint.
//
// AND THE EXEMPTION TABLE IS CHECKED TOO, in the other direction: an entry naming
// a variable the app no longer reads is a finding. Otherwise the table becomes
// the place stale decisions go to be believed.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Deliberately NOT delivered to the container. Each reason is load-bearing: it
// is what a later reader needs in order to disagree with it on purpose.
const EXEMPT = {
  CBM_NO_LISTEN: 'test-only — it stops the suites binding a port; production must never set it.',
  SOURCE_COMMIT: 'build-time alias for GIT_SHA (src/version.js), baked by the Dockerfile ARG, never runtime config.',
  GIT_SHA: 'baked at build time by the Dockerfile ARG; a runtime value would let the image lie about which commit it is.',
  BUILT_AT: 'same as GIT_SHA — a Dockerfile ARG, stamped at build.',
  DB_PATH: 'derives from DATA_DIR inside the image (src/db/index.js). Making it settable from the host .env would let the database be pointed OUTSIDE the mounted volume, which loses data on the next container recreate.',
};

/** Every `process.env.X` the shipped app reads, with the file it appears in. */
function readsOf(dir, acc = new Map()) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { readsOf(p, acc); continue; }
    if (!/\.(js|mjs)$/.test(name)) continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
      if (!acc.has(m[1])) acc.set(m[1], path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  }
  return acc;
}

/** The keys under the portal service's `environment:` block. Deliberately a
 *  narrow reader rather than a YAML parser: this file has one shape, it is ours,
 *  and a dependency for six lines of scanning is a worse trade. The block ends
 *  at the next key at service-body indent (`    volumes:`), so a variable added
 *  under `backup:` is correctly NOT counted. */
function composeKeys(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^  portal:/.test(l));
  if (start < 0) throw new Error('no `portal:` service in compose.yaml');
  const envAt = lines.findIndex((l, i) => i > start && /^    environment:/.test(l));
  if (envAt < 0) throw new Error('the portal service has no `environment:` block');
  const keys = new Set();
  for (let i = envAt + 1; i < lines.length; i++) {
    if (/^ {0,4}\S/.test(lines[i])) break;          // back out to service-body indent
    const m = lines[i].match(/^ {6}([A-Z_][A-Z0-9_]*):/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** The keys the image sets for itself. `ENV A=1 \` continuations included. */
function dockerfileKeys(text) {
  const keys = new Set();
  for (const m of text.matchAll(/^\s*(?:ENV|ARG)\s+([\s\S]*?)(?=\r?\n(?!\s*[A-Z_][A-Z0-9_]*=)\S|\r?\n\s*$)/gm)) {
    for (const k of m[1].matchAll(/([A-Z_][A-Z0-9_]*)\s*=/g)) keys.add(k[1]);
    const bare = m[1].match(/^\s*([A-Z_][A-Z0-9_]*)\s*$/);
    if (bare) keys.add(bare[1]);
  }
  return keys;
}

/** The whole judgement, as a pure function of three strings — so the
 *  falsification at the bottom can drive it with synthetic inputs instead of
 *  damaging the repository. */
function audit({ reads, compose, docker, checkExemptions = false }) {
  const given = new Set([...composeKeys(compose), ...dockerfileKeys(docker)]);
  const findings = [];
  for (const [name, where] of reads) {
    if (given.has(name) || name in EXEMPT) continue;
    findings.push(`${name} — read in ${where}, named in neither compose.yaml nor the Dockerfile, and not exempt`);
  }
  // Only meaningful against the REAL source tree. The self-tests below drive
  // this function with a one-entry `reads` map, and every exemption would look
  // dead to them — which is how the first cut of this file reported all four of
  // its own controls broken.
  if (checkExemptions) {
    for (const name of Object.keys(EXEMPT)) {
      if (!reads.has(name)) findings.push(`${name} — exempt, but nothing under src/ reads it any more; delete the entry`);
    }
  }
  return findings;
}

// --------------------------------------------------------------- the real run
const reads = readsOf(path.join(ROOT, 'src'));
const compose = readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
const docker = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const findings = audit({ reads, compose, docker, checkExemptions: true });

// ------------------------------------------------- can this check go red?
// Four synthetic cases, run every time rather than in a separate harness,
// because the analyser is a pure function of three strings and driving it costs
// nothing. A check whose red has never been seen is worth what the last one was.
const FAKE_COMPOSE = '  portal:\n    environment:\n      KNOWN: ${KNOWN:-}\n    volumes:\n      - x:/x\n';
const FAKE_DOCKER = 'ENV BAKED=1\n';
const selfTests = [
  ['a variable in neither place is caught',
    audit({ reads: new Map([['MISSING', 'src/x.js']]), compose: FAKE_COMPOSE, docker: FAKE_DOCKER }).length === 1],
  ['a variable named in compose is not',
    audit({ reads: new Map([['KNOWN', 'src/x.js']]), compose: FAKE_COMPOSE, docker: FAKE_DOCKER }).length === 0],
  ['a variable baked into the image is not',
    audit({ reads: new Map([['BAKED', 'src/x.js']]), compose: FAKE_COMPOSE, docker: FAKE_DOCKER }).length === 0],
  ['a variable under a DIFFERENT service does not count as given',
    audit({
      reads: new Map([['ONLYBACKUP', 'src/x.js']]),
      compose: '  portal:\n    environment:\n      KNOWN: x\n    volumes:\n      - x:/x\n\n  backup:\n    environment:\n      ONLYBACKUP: y\n',
      docker: FAKE_DOCKER,
    }).length === 1],
];
const broken = selfTests.filter(([, ok]) => !ok).map(([n]) => n);
if (broken.length) {
  console.error('\n✗ this checker cannot be trusted — its own falsification failed:');
  for (const n of broken) console.error(`    ${n}`);
  process.exit(1);
}

// ------------------------------------------------------------------- report
if (findings.length) {
  console.error(`\n✗ ${findings.length} variable(s) the app reads are not delivered to the container:\n`);
  for (const f of findings) console.error(`    ${f}`);
  console.error('\n  Add it under `environment:` in the portal service of compose.yaml — a key');
  console.error('  in .env alone NEVER reaches the container, however correct it looks. If it');
  console.error('  genuinely should not be delivered, add it to EXEMPT in this file with the');
  console.error('  reason, so the decision is on the record.\n');
  process.exit(1);
}
console.log(`compose env: ${reads.size} variables read under src/, all delivered or exempt (${Object.keys(EXEMPT).length} exempt, ${selfTests.length} self-tests green).`);
