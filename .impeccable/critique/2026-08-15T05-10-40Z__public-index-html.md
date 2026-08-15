---
target: public/index.html
total_score: 25
max_score: 32
na_heuristics: 7,10
p0_count: 2
p1_count: 1
timestamp: 2026-08-15T05-10-40Z
slug: public-index-html
---
# BusMaps.uk Homepage Critique — Run 2

Method: dual-agent (A: design-review sub-agent · B: detector/browser sub-agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Pilot banner/sample badges truthful and present; page has little dynamic state beyond that |
| 2 | Match Between System and Real World | 4 | Plain English throughout, honest "It is a pilot" framing, no jargon |
| 3 | User Control and Freedom | 3 | No dead ends; search has no explicit clear affordance but it's a GET form |
| 4 | Consistency and Standards | 4 | Design tokens (pill vs 14px radius, semantic colour, one shadow, one font) hold up live |
| 5 | Error Prevention | 2→4* | *Scored 2 at assessment time for the broken hero search input (see P0 below) — found and fixed within this same session; would re-score 4 today |
| 6 | Recognition Rather Than Recall | 4 | Sticky nav, contextual CTAs repeated per section |
| 7 | Flexibility and Efficiency of Use | n/a | Persuade-mode marketing page, no power-user path applies |
| 8 | Aesthetic and Minimalist Design | 3 | Disciplined overall; emoji icon system is the one element that breaks the "colour only means something" rule |
| 9 | Help Recognize/Recover from Errors | 2→3* | *Same root cause as #5 — no validation feedback wired to a search box that was, at assessment time, unusable |
| 10 | Help and Documentation | n/a | Persuade-mode homepage; FAQ/contact stand in and are reachable |

**Total as assessed: 25/32** (8 applicable heuristics × 4; two n/a). **Re-scored after the in-session fix: ~29/32.** The gap was almost entirely one concrete functional bug, not systemic design weakness — see Priority Issues.

## Design Specificity Verdict

**LLM assessment (Assessment A):** Authored for BusMaps.uk specifically, not a reskinned template. The RED→GREEN High Wycombe proof, the four-output taxonomy tied to the real render pipeline, and above all the "Or take it on yourself" CIC-succession admission are not things a generic SaaS landing page would contain unprompted — the last one is a liability disclosure, not a sales pitch, and no template author invents that. Copy voice (procedural, undersells: "we are looking for our first organisations") matches DESIGN.md's Council Noticeboard register consistently across all nine sections.

**Deterministic scan (Assessment B):** `detect.mjs` exit 0, one advisory-only finding unchanged from the last run (`em-dash-overuse`, 27 in body text) — still judged a stylistic false positive given the page's deliberate high-context copy voice. The detector explicitly runs in DEGRADED mode (HTML parser modules unavailable) and **cannot evaluate computed contrast** — which matters here, because the browser pass below found two real contrast failures the CLI structurally cannot see and Assessment A's own live spot-check also missed.

**Where the two assessments disagree — this is the interesting finding.** Assessment A's live pass concluded "I could find no other WCAG-contrast violations by spot-checking the tint-not-fill badges/pills." Assessment B's browser pass computed actual alpha-composited contrast on every tinted badge and found two real failures the design review's visual spot-check walked past:
- `.badge.place` ("Place"): `rgb(224,138,0)` text on `rgb(250,236,214)` tint → **2.32:1**, fails 4.5:1.
- `.badge.extra` ("hand-finished · extra"): `rgb(224,138,0)` text on `rgb(251,239,219)` tint → **2.36:1**, fails 4.5:1.

Same root cause as the P0 `.pilot-badge` fix from the last critique: the amber accent works as a *solid background* under dark ink (6:1+), but reused as *foreground text on its own light tint*, it's roughly the same orange-on-cream problem the first critique caught elsewhere and this one caught on the two remaining tint-badge components. This is exactly the kind of gap a design review's eyeballing misses and a browser-computed pass catches — worth folding a contrast pass into the mechanical detector once its HTML-parser dependency is fixed, rather than relying on manual spot-checks each time.

## Overall Impression

The two prior rounds of fixes hold up under a second, independent look — nothing regressed on the six previously-closed P0/P1s, and the page's authored voice and structural discipline are genuinely strong. But this run surfaced a real, live, unrelated defect: **the hero/maps search input was rendering 28px wide in production**, unusable for typing a place name, caused by a pre-existing flex-layout bug that yesterday's grid-overflow fix had inadvertently un-masked. That's been found, fixed, verified, and deployed during this session (see below) — it is not a leftover action item. What remains open is smaller: two contrast fails on badge components using the amber accent as foreground text, a soft cognitive-load call on the "Who it's for" 5-card grid, the emoji icon system's inconsistency with the design system's own colour-discipline rule, and one closing-section copy gap.

## What's Working

1. **The High Wycombe "measured first, drawn second" section** shows a failure (RED) and the remediation process that fixed it, rather than only asserting quality — rare, on-brand honesty for a "Council Noticeboard" page.
2. **Both prior P0 fixes are genuinely correct, not just present.** `.pilot-badge` computed to 6.09:1 live (not just declared in CSS source), and the signed-in CTA repoint was verified against a real authenticated session with no vanishing-CTA state reproducing.
3. **Zero broken links, zero console errors, zero failed network requests** across 44 anchors and both signed-out/signed-in states — the page is mechanically solid outside the two defects above.

## Priority Issues

**[P0] Hero/maps search input rendered 28px wide — unusable — ✅ FOUND AND FIXED THIS SESSION**
- **What:** `.search-form` is `display: flex`; its `<label>` was a direct flex-item sibling of the input and button instead of stacking above them, so it competed for row width. Live measurement before the fix: label 342px, button 94px, gap 16px → input squeezed to 28px at a 480px form width. Reproduced on both `/` and `/maps`, at every viewport.
- **Why it matters:** This is the hero's second CTA, the no-commitment path for a visitor not ready to apply ("Or check: is there already a map…"). It was dead on arrival for every visitor on every device. It's also the same class of live-DOM-only bug the first critique caught — a static-source read would not have found this; only measuring the actual rendered layout did.
- **Fix applied:** `.search-form { flex-wrap: wrap }` + `.search-form .search-label { flex: 1 0 100% }` so the label always takes its own row. Verified: 378px input at 480px form width, 178px at 320px viewport, 0px document overflow, `npm test` and detector clean. **Deployed to production** (commit `0ab3654`, confirmed via `/health?deep=1` and a direct fetch of the live CSS).
- **Root cause note:** This bug pre-dated both critiques but was masked — the (buggy) grid-overflow issue the first critique fixed let the whole hero column overflow wide enough that the input still had room despite the label eating space. Fixing that overflow correctly clamped the grid and exposed this second, independent bug underneath it.

**[P0] Two badge components fail WCAG AA contrast: `.badge.place` (2.32:1) and `.badge.extra` (2.36:1)**
- **What:** Both use the amber accent (`#e08a00` light / `#f4b451` dark) as foreground text on its own light `color-mix` tint background — well under the 4.5:1 floor PRODUCT.md commits the whole portal to (both are small/bold text, still short of even the 3:1 large-text threshold).
- **Why it matters:** Same accessibility commitment that made the `.pilot-badge` fix P0 last round applies here — these are live, real components (the "Place" map-type tag and the diagram-output "extra" cost badge), not edge cases. `.badge.place` appears on real published-map cards (High Wycombe Aldi, March).
- **Fix:** The existing `--accent-ink` token (added for `.pilot-badge`) solves the *solid-fill* case but doesn't apply here since these are tints, not fills. Either darken the tint's foreground independently of `--accent` (a token like `--accent-ink` isn't right for a tinted background — consider a darker text variant e.g. `color-mix(in srgb, var(--accent) 55%, var(--text))` tuned to clear 4.5:1), or move these two badges to the tint-not-fill pattern already used successfully elsewhere (e.g. `.badge.place` could sit closer to `--primary`/blue-family semantics if "place" doesn't strictly need to be amber) — whichever preserves DESIGN.md's Meaning-Not-Mood Rule.
- **Suggested command:** `/impeccable audit` (accessibility-specific pass) or `/impeccable polish`

**[P1] "Who it's for" is a 5-card decision point with no ranking cue**
- **What:** Five equally-weighted cards in `.grid.cols-3`, no default/recommended path, immediately followed by a 6th implicit option via the "Not on this list?" note below the grid.
- **Why it matters:** Cognitive Load checklist item #2 (≤4 visible options per decision point) fails at 5. A first-time visitor has to self-sort before the page feels "for them" — a soft tax right after the hero's momentum, not a broken interaction.
- **Fix:** Either fold the lowest-volume segment into the existing catch-all note (true 4-card grid), or add a visual primacy cue to the single most common segment — town/parish councils, per PRODUCT.md's stated primary audience — so the grid doesn't read as five equal doors.
- **Suggested command:** `/impeccable distill`

**[P2] Uncontrolled emoji icon system undermines the "colour only means something" thesis**
- **What:** 12 distinct emoji (🏛️🏥🔬🎪🚌🗺️📐🚇↗️✅📶🎨) act as icons across three sections, rendered at OS/browser emoji-font colour, uncontrolled by the design system's colour tokens.
- **Why it matters:** DESIGN.md's Meaning-Not-Mood Rule states colour appears only to report status or invite action, with exactly five non-neutral roles. Emoji sit entirely outside that discipline — decorative colour on a system with an explicit rule against decorative colour, and the single most template-generic-looking element on an otherwise specifically-authored page.
- **Fix:** Replace with monoline SVG icons in `--muted`/`--primary`, or deliberately document emoji-as-voice as an intentional exception in DESIGN.md. Either is fine; the current uncontrolled state is not.
- **Suggested command:** `/impeccable clarify` (system-consistency question) or `/impeccable polish` if the answer is "keep emoji, make them consistent"

**[P3] Succession-risk closing section doesn't address the applying reader before the page ends**
- **What:** The final section ("Or take it on yourself") is addressed to a hypothetical future CIC operator, not back to the council clerk who may have decided to apply two sections earlier.
- **Why it matters:** This is the page's peak-end moment (per the emotional-journey read) and it currently ends on an unresolved worry for the *primary* persona rather than a resolved one — a missed chance to close the loop on the product's own commitment to truthful, reassuring copy.
- **Fix:** One bridging sentence in "Why we are saying so publicly," e.g. "None of this changes what's true today: the licence stays open, and every publish is still reviewed by a person before it goes out."
- **Suggested command:** `/impeccable polish`

## Persona Red Flags

**Jordan (first-timer):** The broken search box (now fixed) was Jordan's worst-case moment — presented as the safe, low-commitment option and it was the one interaction that didn't work. Jordan also faces the unranked 5-card sort in "Who it's for" with no obvious default.

**Riley (stress-tester):** `minlength="2"` on the search input has no visible validation UI — untestable live while the field itself was broken, which was the bigger find. Riley would also hit the footer's flat, ungrouped 10-link row (`index.html:192`, unchanged from the first critique) and the diagram-cost badge with no indicative magnitude.

**Sam (accessibility-dependent):** The `<label for="heroQ">` was correctly associated in markup even while broken, so a screen-reader user's label announcement was fine — but the same 28px input was also a touch-target failure for low-vision/motor-impaired users. Separately, the two new contrast fails above are a direct Sam-persona hit: `.badge.place` and `.badge.extra` are both real, live, low-contrast text.

## Minor Observations

- Footer's 10 links remain one flat, ungrouped `·`-separated row (`index.html:192`) — unchanged since the first critique.
- `.map-list` thumbnails populated at runtime by `published-strip.js` weren't re-verified live for `width`/`height` attributes this round (static-HTML images on the page itself do have them).
- The diagram "extra" cost badge still carries no indicative magnitude — reasonable to leave open until `PILOT_MODE` lifts per PRODUCT.md's no-pricing-yet constraint.
- `autocomplete="off"` on the hero search input is an odd choice for a place-name field where returning visitors would likely want browser autofill — minor.
- Version string exposure in the footer was flagged uncertain by Assessment A (not found in the static footer markup at `index.html:186-195`) — carried over from the first critique's minor-observations list but not confirmed present or absent this round; worth a direct check next time rather than assuming.

## Questions to Consider

1. If the hero search box was broken in production and only a live-browser critique pass caught it (twice now, for two different root causes), what's actually exercising this page before a critique catches it — is there a case for a lightweight visual-regression check in the gate suite?
2. The succession-risk section does double duty as a CIC-operator recruitment ad and a trust signal for applying councils — is that intentional, or would it read better split, so neither reader sits through the other's pitch?
3. DESIGN.md's Meaning-Not-Mood Rule is enforced rigorously everywhere except the emoji icon system — intentional carve-out, or has "icon" just never been audited against the same rule "colour" was?
