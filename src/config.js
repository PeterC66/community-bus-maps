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
