// PILOT: the PILOT export below. Delete it when the pilot ends — see
// docs/PILOT.md. The INDEXING export at the foot of this file is NOT pilot
// machinery and must OUTLIVE that deletion; it lives here only because this is
// where the robots.txt decision used to be made.
//
// The single switch that marks this system as a pilot everywhere a person can
// see it: the web chrome (via /js/site-banner.js), the page titles and a stamp
// on every rendered sheet (src/render/pilotStamp.js).
//
// BusMaps.uk was built as if it were a running service, but it has no
// customers: every organisation in the database is demo data and every map on
// the site is one we made ourselves. Until that changes, nobody — a prospective
// customer, a council clerk, a colleague signing in — should be able to mistake
// it for an established service.
//
// ON by default, deliberately: forgetting to set an env var must fail towards
// the honest state, not the confident one.

export const PILOT = {
  on: process.env.PILOT_MODE !== '0',
  word: 'Pilot',
  short: 'Pilot — not yet a live service',
  long:
    'BusMaps.uk is a pilot. The system works end to end, but it has no '
    + 'customers yet: every map shown here was made by us to show what it produces. '
    + 'Nothing here is a commitment to a service level.',
  href: '/faq.html#pilot',
  // Drawn onto every rendered sheet while the pilot is on (one banner line
  // across the top — see src/render/pilotStamp.js).
  stampHeading: 'PILOT — SAMPLE MAP',
  stampNotes: [
    'Made to test the system. Not published by any organisation. Do not rely on it for travel.',
  ],
};

// Search-engine indexing — a SEPARATE decision from the pilot (split 2026-08-21).
//
// These two used to be one switch, and that conflated two different claims. The
// pilot banner and the sheet stamps say "this is a pilot, do not mistake it for a
// service" — honest, and worth keeping for as long as it is true. `Disallow: /`
// says something else entirely: "nobody may find this at all". Tying them together
// meant the only way to become discoverable was to stop admitting it was a pilot,
// which is the wrong trade in both directions.
//
// Everything a crawler needs is already built and has been for some time —
// sitemap.xml, per-map server-rendered title/description/canonical/OG/JSON-LD, and
// the /m/<slug>/services text pages. This flag is the only thing standing in front
// of it.
//
// OFF by default, for exactly the reason PILOT is ON by default: forgetting an env
// var must fail towards the private state, not the exposed one. Note the corollary
// — setting PILOT_MODE=0 alone no longer enables indexing; that now takes a
// deliberate second switch, which is the point of splitting them.
export const INDEXING = {
  allowed: process.env.ALLOW_INDEXING === '1',
};

// Which instance is this — the public site, or a local/dev copy of it? A
// separate question from PILOT (that's "is this a real service"; this is
// "is this even the real deployment"), and from INDEXING. Matters because a
// pilot-mode banner looks the same locally and in production, so someone
// screen-sharing or reviewing a build could mistake one for the other.
//
// compose.yaml sets NODE_ENV=production for the deployed container; nothing
// else does. Same fail-direction as PILOT above: an unset or unrecognised
// NODE_ENV must read as local, not as production, so a missing env var makes
// the banner louder rather than making it vanish.
export const ENVIRONMENT = {
  isProduction: process.env.NODE_ENV === 'production',
};

/* ─────────────────────────────────────────────────────────────────────────────
 * THE ENVIRONMENT, IN ONE PLACE (OA-224 Tier 5, portal-src F7).
 *
 * `process.env` was read in eight files: 20 reads outside this one, including
 * every secret the system has. This file held three flags. The cost of that is
 * not tidiness — it is that nothing could answer "what does this deployment
 * read, and what happens if it is unset?", and the fail-direction of each
 * variable, which this codebase argues about carefully for PILOT and INDEXING,
 * was invisible for the rest.
 *
 * ACCESSORS, NOT CONSTANTS, and the reason is measured rather than stylistic:
 * `test-operator-token.mjs` UNSETS `OPERATOR_TOKEN` at runtime and asserts the
 * token stops working. A module-level snapshot would make that assertion pass
 * for the wrong reason for ever. Each caller decides when to read; the ones that
 * legitimately snapshot at load (`BASE_URL`, `DEV_LINKS`, `STALE_AFTER_MONTHS`)
 * still do, by calling the accessor once at module scope, which keeps their
 * existing behaviour exactly.
 *
 * TWO FILES KEEP THEIR OWN READS, declared here rather than forgotten:
 *   src/db/paths.js   DATA_DIR, DB_PATH   — it exists so a script can learn a
 *                     path without importing anything that opens a database, and
 *                     importing this file to get one would undo that.
 *   src/version.js    BUILT_AT, SOURCE_COMMIT — build stamps injected into the
 *                     image, read by code that must not depend on config.
 * `scripts/test-env-inventory.mjs` asserts that list is the whole of it: a
 * `process.env` read anywhere else under `src/` is a finding.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The public origin, with EVERY trailing slash removed.
 *
 * IT USED TO BE READ THREE WAYS. `http/helpers.js` stripped all trailing slashes,
 * `email/notify.js` stripped one, and `worklist/index.js` stripped none — so a
 * `PUBLIC_BASE_URL` ending in `/` gave the app `https://busmaps.uk/maps`, an email
 * the same, and the operator's worklist `https://busmaps.uk//maps`. Three
 * spellings of one value is the shape `sessionTokenHash`/`tokenHash` had (Tier
 * 3.3), and it is a bug the day they disagree. One reading now, the strictest. */
export const publicBaseUrl = () => String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

/** Which email provider is configured, '' when none. '' means the dev fallback
 *  that prints the sign-in link to the console — see DEV_LINKS. */
export const emailProvider = () => process.env.EMAIL_PROVIDER || '';
/** The From: on everything we send. */
export const emailFrom = () => process.env.EMAIL_FROM || 'BusMaps.uk <noreply@busmaps.uk>';
/** Resend's API key, '' when unset. Deliberately NOT rotatable by rotate-secret.mjs. */
export const resendApiKey = () => process.env.RESEND_API_KEY || '';

/* The three ops tokens. All three fail CLOSED when unset: tokenMatches() refuses
 * an empty expectation, so an unconfigured portal admits nobody rather than
 * everybody — the arm prove-red-operator-token.mjs exists to hold. */
export const metricsToken = () => process.env.METRICS_TOKEN || '';
export const operatorToken = () => process.env.OPERATOR_TOKEN || '';
export const statusToken = () => process.env.STATUS_TOKEN || '';

/** Dev-only: let an approver publish a version they submitted themselves. OFF
 *  unless explicitly '1' — separation of duties fails towards the strict state. */
export const allowSelfApproval = () => process.env.ALLOW_SELF_APPROVAL === '1';

/** How old a map's data may be before the public page says so. Six months. */
export const staleAfterMonths = () => Math.max(1, Number(process.env.STALE_AFTER_MONTHS) || 6);

/** Where the server listens. 127.0.0.1 by default: Caddy is the only thing that
 *  should be able to reach it directly. */
export const listenOn = () => ({ port: Number(process.env.PORT || 5180), host: process.env.HOST || '127.0.0.1' });
/** Build the app without binding a socket — set only by the test harnesses. */
export const noListen = () => process.env.CBM_NO_LISTEN === '1';
