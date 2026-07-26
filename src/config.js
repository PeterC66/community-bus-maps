// PILOT: whole file. Delete when the pilot ends — see docs/PILOT.md.
//
// The single switch that marks this system as a pilot everywhere a person can
// see it: the web chrome (via /js/site-banner.js), the page titles, robots.txt
// and a stamp on every rendered sheet (src/render/pilotStamp.js).
//
// Community Bus Maps was built as if it were a running service, but it has no
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
    'Community Bus Maps is a pilot. The system works end to end, but it has no '
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
