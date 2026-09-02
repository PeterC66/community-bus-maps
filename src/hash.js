// The one SHA-256, and the one name for hashing a bearer token.
//
// OA-224 Tier 3.3, and the sibling of `src/html.js` from Tier 1.2. `sha256` was
// spelled out at ten sites; two of them were the same security primitive under
// two names — `sessionTokenHash` in `src/auth/index.js` and `tokenHash` in
// `src/db/index.js`, plus a third copy written inline inside the migration that
// hashes stored tokens. They agreed, which is the only reason sessions worked at
// all: a token is hashed on the way in by one of them and looked up by the
// other, so the day the two spellings differ, every session in the database
// stops resolving and nothing in the code says why.
//
// WHAT IS DELIBERATELY NOT MIGRATED. `test-audit-2026-08-25.mjs` and
// `test-audit-p1.mjs` each compute the hash themselves. That is not a missed
// copy — it is the control. A test that hashes a token with the same function
// the code under test uses cannot tell you the stored value is a SHA-256 of the
// token; it can only tell you the function is deterministic. An independent
// computation in a test is the thing that would notice.
import { createHash } from 'node:crypto';

/** Hex SHA-256 of a string or buffer. */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * The stored form of a bearer token — a session cookie, a publish token, a
 * one-time sign-in link. Raw tokens are never written to the database
 * (technical-audit_2026-08-25 N3); this is what goes in the column, and it takes
 * the RAW token so no caller can forget to hash.
 */
export function tokenHash(token) {
  return sha256(String(token));
}
