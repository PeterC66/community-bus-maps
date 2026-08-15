---
target: public/index.html (shopfront homepage)
total_score: 23
max_score: 28
na_heuristics: 5,7,9
p0_count: 2
p1_count: 3
timestamp: 2026-08-14T04-46-45Z
slug: public-index-html
---
# BusMaps.uk Homepage Critique

<!-- docstamp v1.0 | 2026-08-14 | sha=0da567be -->
**v1.0** · updated 14 August 2026

## Design Health Score
23/28 applicable (82%, Good). Heuristics 5, 7, 9 scored n/a (no destructive/error/power-user surface on this page).

## Design Specificity Verdict
Authored content (RED/GREEN proof, four named outputs, CIC succession admission) wrapped in an unauthored B2B-landing-page shell. Live browser pass caught 5 issues the CLI regex-fallback scan missed entirely.

## Priority Issues
- P0: .pilot-badge (styles.css:416-426) white-on-amber text measures 2.7:1 vs 4.5:1 required — WCAG AA fail on a site-wide element, binding per PRODUCT.md.
- P0: .btn-primary absent from DOM for signed-in visitors landing on /; nav pattern breaks for a real reachable state.
- P1: Four confirmed layout-overflow bugs (1 em +31px, 3 a elements +17/22/27px) caught only by live DOM pass.
- P1: Page ends on succession-risk disclosure with no CTA after it; reassurance text not adjacent to any button.
- P1: "Who it's for" grid has 6 cards (limit 4); budget worry raised then only linked, never resolved.

## Persona Red Flags
Jordan: budget worry unresolved, diagram "extra" cost has no magnitude. Riley: hits the vanishing-CTA state directly; hero search minlength is client-side only. Casey: 204px sticky nav at 390px, ~quarter of viewport.

## Minor Observations
Emoji icon system uncontrolled; map images lack "paper" framing in dark mode; pub-card thumbnails missing width/height (CLS risk); diagram cost badge has no magnitude; footer is an ungrouped 10-link wall; overused-font/em-dash-overuse flags likely false positives (deliberate one-voice system, contextual copy); version string exposed in footer.
