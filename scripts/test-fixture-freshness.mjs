#!/usr/bin/env node
// warnIfStaleSibling ONLY HAS SIBLINGS TO COMPARE INSIDE A <town>/S5-render/<run>
// FOLDER.
//
//   node scripts/test-fixture-freshness.mjs     (or: npm run test:fixture-freshness)
//
// WHY IT EXISTS (OA-432, buses-data). `deliver-map.mjs` step 2 mounts the
// staged render at `/fixture` inside a throwaway container and runs
// verify-reproduce.mjs with FIXTURE_DIR=/fixture. warnIfStaleSibling() took
// path.dirname(fixtureDir) — which is `/` for that mount — as "the folder of
// sibling renders", and every entry under `/`, `/sys` included, reads as
// newer than the fixture. So the warning printed on every area delivery,
// which is exactly the "gate that cries wolf gets ignored" failure this
// file's own header warns about.
//
// THE FIX REUSES newest-render.mjs's versionedRender() RATHER THAN ADDING A
// SECOND CHECK (CLAUDE.md: look for the helper before you build it). That
// predicate already answers "is this a <town>/S5-render/<run> folder", which
// is the one shape with real siblings to compare, and returns null for both
// the container's `/fixture` and a committed `_portal-fixture` pack — no
// separate "is this the filesystem root" test is needed.
//
// Section 1 is the control: a genuine S5-render sibling that is newer must
// still warn, so the guard above cannot be read as having gone silent
// altogether. Section 2 is the fault itself — a fixture whose parent holds no
// `S5-render` folder — asserting NO output, over two shapes: the container
// mount and a bare temp directory standing in for it.

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TREE = process.argv[2] ? path.resolve(process.argv[2]) : ROOT;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); failures++; }
};

const { warnIfStaleSibling } = await import(
  new URL(`file://${path.join(TREE, 'scripts', 'lib', 'fixture-freshness.mjs').replace(/\\/g, '/')}`).href
);

/** Run fn with console.log captured; return the lines it printed. */
function capture(fn) {
  const lines = [];
  const real = console.log;
  console.log = (s) => lines.push(s);
  try { fn(); } finally { console.log = real; }
  return lines;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'cbm-fixture-freshness-'));

// touch a directory's mtime, and its own mtime alone — newestMtime() also
// walks children, but these fixtures carry none, so the folder's own stamp is
// what is being compared
function withMtime(dir, when) {
  mkdirSync(dir, { recursive: true });
  const t = when / 1000;
  utimesSync(dir, t, t);
  return dir;
}

// ---------------------------------------------------------------------------
console.log('\n1. the control: a genuinely stale S5-render sibling still warns');
// ---------------------------------------------------------------------------
{
  const now = Date.now();
  const town = path.join(scratch, 'Control Town', 'S5-render');
  const older = withMtime(path.join(town, 'v1.0_2026-09-01_0100'), now - 2 * 3600_000);
  const newer = withMtime(path.join(town, 'v1.1_2026-09-13_0100'), now - 3600_000);
  const lines = capture(() => warnIfStaleSibling(older));
  check('warns that a sibling is newer', lines.some((l) => l.includes('is not the newest render in')), lines.join(' | '));
  check('…and names the newer run', lines.some((l) => l.includes('v1.1_2026-09-13_0100')), lines.join(' | '));
  const silent = capture(() => warnIfStaleSibling(newer));
  check('…and the current run itself is silent', silent.length === 0, silent.join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\n2. OA-432: no S5-render parent means nothing to compare, so no warning');
// ---------------------------------------------------------------------------
{
  // The real shape: FIXTURE_DIR=/fixture inside deliver-map.mjs's container.
  // /fixture's parent is / itself, and every real directory under it, /sys
  // included, is "newer" than a read-only mount — reproduced here as a fixture
  // folder sitting directly under a scratch root with unrelated newer siblings.
  const root = path.join(scratch, 'container-root');
  const fixture = withMtime(path.join(root, 'fixture'), Date.now() - 3600_000);
  withMtime(path.join(root, 'sys'), Date.now());
  const lines = capture(() => warnIfStaleSibling(fixture));
  check('a fixture with no S5-render parent prints nothing, however new its siblings are', lines.length === 0, lines.join(' | '));
}
{
  // The committed-fixture shape: Areas/_portal-fixture/<Town>, which has no
  // version in its path and is nobody's sibling either.
  const committed = withMtime(path.join(scratch, '_portal-fixture', 'St Ives'), Date.now() - 3600_000);
  writeFileSync(path.join(path.dirname(committed), 'unrelated-newer'), '');
  const lines = capture(() => warnIfStaleSibling(committed));
  check('a committed _portal-fixture pack is silent too', lines.length === 0, lines.join(' | '));
}

console.log('');
if (failures) { console.error(`✗ ${failures} failure(s)`); process.exit(1); }
console.log('✓ fixture-freshness: all checks passed');
