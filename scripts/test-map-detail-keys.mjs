#!/usr/bin/env node
// test-map-detail-keys.mjs — the API speaks camelCase, and the shim that lets an
// old browser keep working is dated rather than forgotten.
//
// WHY (codebase review 2026-09-01, portal-src F9). One thing had five names —
// `storage_key` 36 times, `storageKey` 52, `versionKey` 18, `version_key` 16,
// plus `cur_key` and `pub_key` — and the sharp end of it was that
// `mapDetail().versions[]` emitted `storage_key`, `review_state` and `created_at`
// straight out of the database, next to siblings called `currentVersion`,
// `hideOperatorsEnabled` and `headState`. One payload, two conventions, and a
// caller had to know which side of the boundary each field had come from.
//
// The rule is now in docs/CONVENTIONS.md: **snake_case is the DATABASE's spelling
// and camelCase is the API's**, and `versionKey` is what the API calls
// `map_version.storage_key`.
//
// THE SHIM, AND WHY IT IS ASSERTED RATHER THAN COMMENTED. `views/app/editor.html`
// loads `/app/editor.js` with no cache-busting query, so a browser that has the
// file cached is an OLD client talking to a NEW server. Renaming the keys in one
// release would break the editor for exactly the customers who had used it most
// recently. So both spellings are emitted for one release.
//
// A shim nobody is required to remove is a permanent second convention. This test
// asserts BOTH sets, which means the removal is a failing test rather than a
// comment somebody has to notice — and the failure message says what to do. The
// same lesson, one day older: on 2026-09-03 the 404 discriminator's "compatibility
// shim" was found to have been preserved in WORDING and broken in POSITION,
// because only one half of it was asserted.
//
// Run from the repository root (`C:\Claude\community-bus-maps`), no arguments:
//     npm run test:map-detail-keys

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures++;
};

console.log('test-map-detail-keys — one convention at the boundary, and a dated shim\n');

/* SOURCE-LEVEL, and that is a decision rather than laziness. Calling mapDetail()
 * needs a map with a rendered version, an overrides file and a routes-meta
 * snapshot on disk; building all of that would test the fixture more than the
 * shape. What is being asserted is which key names this function EMITS, and that
 * is a property of the source. */
const detail = readFileSync(join(ROOT, 'src/maps/detail.js'), 'utf8');
const block = (() => {
  const i = detail.indexOf('versions: listVersions(id).map(');
  if (i < 0) return null;
  const j = detail.indexOf('})),', i);
  return j < 0 ? null : detail.slice(i, j);
})();
check(!!block, 'the versions[] projection is still recognisable in mapDetail()',
  'the `versions: listVersions(id).map(` shape has changed — this test is reading nothing and would pass for ever');
if (!block) process.exit(1);

console.log('the API spelling:');
for (const k of ['versionKey', 'reviewState', 'createdAt']) {
  check(new RegExp(`\\b${k}:`).test(block), `versions[] emits ${k}`, 'not found in the projection');
}

console.log('\nthe compatibility shim (see the header — it goes in the release after 2026-09-03):');
for (const k of ['storage_key', 'review_state', 'created_at']) {
  check(new RegExp(`\\b${k}:`).test(block), `versions[] still emits ${k} for a cached client`,
    `${k} is gone. If that is deliberate — no browser can still be holding the pre-2026-09-03 /app/editor.js — `
    + 'then delete this whole "compatibility shim" section and the comment in detail.js that promises it. '
    + 'If it is not deliberate, an editor loaded from cache has just stopped listing earlier versions.');
}

console.log('\nthe client reads the API spelling, not the database\'s:');
const client = readFileSync(join(ROOT, 'public/app/editor.js'), 'utf8');
/* The versions array is the only place these three names could legitimately have
 * come from in this file; other payloads (a proposed_update, a publish_request)
 * have their own spellings and are not this finding's subject. */
for (const [bad, good] of [['storage_key', 'versionKey'], ['review_state', 'reviewState']]) {
  const hits = [...client.matchAll(new RegExp(`\\.${bad}\\b`, 'g'))].length;
  check(hits === 0, `editor.js does not read .${bad}`, `${hits} site(s) still do — use .${good}`);
}

console.log('\nthe rule is written down, not just obeyed:');
const conventions = readFileSync(join(ROOT, 'docs/CONVENTIONS.md'), 'utf8');
check(/versionKey/.test(conventions) && /storage_key/.test(conventions),
  'docs/CONVENTIONS.md settles versionKey (API) against storage_key (DB)',
  'neither name appears there — a convention nothing states is the state this finding was about');

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('camelCase at the boundary, snake_case in the database, and the shim is on the record.');
