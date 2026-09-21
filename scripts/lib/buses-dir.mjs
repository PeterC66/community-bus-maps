// Where the buses-data checkout is, resolved once.
//
// OA-232 Tier 1.6, from the 2026-09-03 review's portal-ops T6.
// `scripts/test-build-warnings.mjs` had `const TREE = 'C:/u3a St Ives/Using AI/
// Buses/Areas'` written into it, bare, with no environment read at all -- so the
// half of that test which runs against the REAL corpus was silently off on every
// machine but this laptop, and would have stayed off if the folder ever moved.
// `scripts/lib/upcoming-report.mjs` had already answered the same question, one
// import away, with the env read in front of it.
//
// ENV FIRST, THEN ONE NAMED DEFAULT -- the engine's `cli.js resolveBuses`
// convention, and the reason the default is spelled out rather than derived:
// this repository also runs on a VPS and in CI, where the folder does not exist,
// and a caller that guesses is a caller that cannot tell "not here" from "wrong
// place". Callers check `existsSync` and skip loudly.
//
// `scripts/lib/fixtures.mjs` deliberately does NOT use this. It has its own
// ordered candidate list -- env, then two side-by-side checkout layouts -- and
// `prove-red-fixture-drift.mjs` strips the environment to prove those guesses
// work. Giving it a laptop-shaped last resort would make that harness pass here
// for the wrong reason.
export const BUSES_DIR = process.env.BUSES_DIR || 'C:/u3a St Ives/Using AI/Buses';
