<!-- docstamp v1.0 | 2026-08-14 | sha=e9b29dbf -->
**v1.0** · updated 14 August 2026

---
name: BusMaps.uk
description: Self-serve portal that lets approved UK councils and organisations generate printable bus maps
colors:
  bg: "#ffffff"
  surface: "#f6f8fb"
  surface-2: "#eef2f8"
  text: "#17202e"
  muted: "#59626f"
  border: "#e2e7ef"
  civic-blue: "#1b4db3"
  civic-blue-ink: "#ffffff"
  civic-blue-soft: "#e8eefb"
  notice-amber: "#e08a00"
  ok-green: "#157347"
  err-red: "#b42318"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2rem, 4.5vw, 3.1rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.4rem, 3vw, 1.9rem)"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "22px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.civic-blue}"
    textColor: "{colors.civic-blue-ink}"
    rounded: "{rounded.pill}"
    padding: "11px 20px"
  button-primary-hover:
    backgroundColor: "{colors.civic-blue}"
    textColor: "{colors.civic-blue-ink}"
    rounded: "{rounded.pill}"
    padding: "11px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "11px 20px"
  card:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "22px"
  badge:
    backgroundColor: "{colors.civic-blue-soft}"
    textColor: "{colors.civic-blue}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  field-input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "11px 13px"
---

# Design System: BusMaps.uk

## Overview

**Creative North Star: "The Council Noticeboard"**

BusMaps.uk looks like a well-run parish noticeboard, not a startup product. The system is plain, legible, and official-feeling on purpose: the audience is town/parish council clerks first, then schools, shops and community organisations, and several of those audiences carry their own public-sector accessibility duty. Nothing here is decorative. Colour is spent only where it means something — Civic Blue for the one actionable thing on a page, Notice Amber for "read this before you continue," green and red strictly for outcome (approved/published vs. rejected/error). Everything else stays a shade of ink, border, or paper.

The system is genuinely flat: one soft ambient shadow lifts cards, panels and dialogs off the page; nothing else casts one. Corners are gently rounded (14px on containers) and controls — buttons, badges, tabs, status pills — go all the way to a pill (999px), which is the system's one recurring geometric signature. Typography leans on the operating system's own font stack rather than a branded typeface: this is a tool for getting a job done, not a place to notice the type.

The system already runs two registers convincingly on the same tokens: the public shopfront/gallery (persuade a council to apply, then let anyone read a published map) and the internal editor/review/admin app (get a real task done — recolour a route, review a submission, approve an organisation). Both read as the same noticeboard; the app just adds density (two-pane layouts, data tables, a status strip) where the shopfront stays generous with whitespace.

**Key Characteristics:**
- Plain, procedural, official — never decorative or "product marketing" in tone
- Colour is semantic only: blue = act, amber = attention/pilot/in-progress, green = good, red = bad
- Fully light/dark aware via `prefers-color-scheme`, same token names in both
- Pills everywhere controls and status live; 14px rounded rectangles everywhere containers live
- One soft shadow, used consistently, never escalated into a shadow scale
- System font stack; no webfont load, no display typeface

## Colors

The palette is small and disciplined: one primary (Civic Blue), one secondary/warning accent (Notice Amber), two outcome colors (green/red), and a five-step neutral ramp that does almost all the work. Every non-neutral color is used sparingly enough that its appearance is itself a signal.

### Primary
- **Civic Blue** (`#1b4db3` / dark: `#5a8dff`): the one actionable color. Primary buttons, links, active tab state, focus rings (`box-shadow: 0 0 0 3px` at 22% mix), the "area" map-type tag, the step-number badges on the shopfront's how-it-works section, current-node styling in the status strip.

### Secondary
- **Notice Amber** (`#e08a00` / dark: `#f4b451`): the "pay attention" color. The pilot banner and pilot badge, the request-only/"extra cost" badge on the hand-pinned diagram output, the "place" map-type tag, in-progress/requested status pills, warning notices, the editor's-eye-view admin banner. Never used for a primary action — amber marks state, it doesn't trigger one.

### Neutral
- **Paper** (`#ffffff` / dark: `#0f141b`, `--bg`): page and card background.
- **Notice Surface** (`#f6f8fb` / dark: `#161d27`, `--surface`): section backgrounds, table headers, panel headers — one step off paper.
- **Notice Surface Deep** (`#eef2f8` / dark: `#1c2430`, `--surface-2`): image/media placeholders, inset chips, a second step off paper.
- **Ink** (`#17202e` / dark: `#e7ecf3`, `--text`): body text, headings.
- **Ink Muted** (`#59626f` / dark: `#9aa6b6`, `--muted`): secondary text, captions, hints, disabled-reading labels.
- **Border** (`#e2e7ef` / dark: `#273240`): the only line-weight in the system; 1px, everywhere.

### Outcome colors (not full roles — used only for status)
- **Approved Green** (`#157347` / dark: `#4ac07e`, `--ok`): published/approved status pills, success form messages, the checklist-item "checked" border.
- **Rejected Red** (`#b42318` / dark: `#ff7a6b`, `--err`): rejected status, error form messages, invalid-field borders, the demo/"Sample" badge (deliberately red — it's a warning that the data isn't real).

### Named Rules
**The Meaning-Not-Mood Rule.** A color only appears when it is reporting a status or inviting one specific action. If a design decision would add color "for interest" or "for hierarchy" where a neutral would do the job, use the neutral. This system has exactly five non-neutral roles (act, warn, good, bad, and the print-fixed white of a rendered sheet) and no sixth is warranted without a new status to report.

**The Tint-Not-Fill Rule.** Semantic colors on light chrome (badges, pills, notices, boxed callouts) use `color-mix(in srgb, <color> 8–18%, transparent)` as background with the full color as text/border, never a solid fill behind body-length text. Solid fill is reserved for primary buttons and small icon-scale marks (step numbers, dots).

## Typography

**Display Font:** System UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`)
**Body Font:** Same stack — one family for everything, no separate display/body pairing
**Label/Mono Font:** None distinct; labels use the same stack at small size, bold, uppercase, tracked out

**Character:** One typeface family throughout, differentiated only by size, weight, and letter-spacing. This is deliberate: a noticeboard doesn't need a second voice, it needs the same voice at different volumes.

### Hierarchy
- **Display** (400, `clamp(2rem, 4.5vw, 3.1rem)`, line-height 1.1, letter-spacing −0.02em): shopfront hero `h1` only. The single largest text in the system; appears once per page, on marketing pages only.
- **Headline** (400, `clamp(1.4rem, 3vw, 1.9rem)`, line-height ~1.25, letter-spacing −0.01em): section `h2` on the shopfront (e.g. "How it works," "Examples").
- **Title** (400, `1.5rem`): app page headers (`.app-sub h1`) — dashboard, editor, admin, review. One size below the shopfront headline; the app never needs marketing-scale type.
- **Body** (400, `1rem`, line-height 1.6): running text everywhere. Lead paragraphs on the shopfront step up to `clamp(1.05rem, 2vw, 1.28rem)`. Card/list body text steps down to `.9–.96rem`.
- **Label** (700, `.72–.85rem`, letter-spacing `.04–.06em`, uppercase where it's a status/category marker): badges, tags, status pills, table headers, form field labels use 600–700 weight at `.9–.95rem` (not uppercase — labels for inputs stay sentence case; only status/category chips go uppercase-tracked).

### Named Rules
**The One-Voice Rule.** Never introduce a second font family. Emphasis and hierarchy come from size, weight (400 body / 600–700 label-and-emphasis / 700–800 for step numbers and pilot badges), letter-spacing, and color — never from a serif/sans pairing or a display face.

## Layout

Two container widths carry the whole system: `max-width: 1080px` (`--maxw`) for the public shopfront and public map pages, and `1360px` for the internal app (`.app-main`), which needs the extra width for its two-pane editor and data tables. Both center with `margin: 0 auto` and take `20px` side padding (app: `18px 20px 40px`).

Grids are plain CSS Grid with a fixed column count that collapses at named breakpoints, not an auto-fit system: `.grid.cols-2/3/4` step down to 2 columns at 900px and 1 column at 620px; the app's editor is a fixed `380px + 1fr` two-pane layout that collapses to a single column at 940px; the review console is `320px + 1fr` collapsing at 900px. `.map-list` is the one auto-fill grid (`repeat(auto-fill, minmax(280px, 1fr))`) because card count there is unbounded.

Vertical rhythm: sections on the shopfront use `padding: 46px 0`; cards/panels use `22px` (shopfront) or `12–16px` (app, which is denser). A recurring 8/10/12/16/22/40px step scale covers gaps and padding throughout — there's no formal spacing token file, but those six values account for nearly every margin/gap/padding in both stylesheets. Sticky positioning is used purposefully, not decoratively: the site header, the app's control panel, and the review queue all pin at `top: 0` / `top: 12px` so the acting surface stays visible while content scrolls.

## Elevation & Depth

*(Open question — confirmed as observed, not yet settled as a locked invariant.)* The system is flat at rest and uses exactly one shadow token (`--shadow`) for every raised surface: cards, panels, dialogs, the sheet viewer, status strip, review queue items. Nothing escalates to a second, heavier shadow for "more elevated" surfaces — a modal dialog and a small card use the identical shadow value. Depth beyond that one lift is conveyed by the neutral ramp (surface → surface-2 → bg) and borders, not by shadow intensity. Buttons never cast a shadow, at rest or hover; the only "lift" feedback on interactive elements is a 1px `translateY` press effect on `:active`. Worth revisiting in a future `/impeccable audit` or `polish` pass: whether a second, more prominent shadow step would help distinguish a modal (`dialog.dialog`, `dialog.compare-dialog`) from an ordinary card, since both currently share the same ambient shadow despite one blocking the whole page.

### Shadow Vocabulary
- **Ambient lift** (`box-shadow: 0 1px 2px rgba(20,30,50,.06), 0 8px 24px rgba(20,30,50,.06)`; dark: `0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.35)`): the system's only shadow. Used on cards, panels, dialogs, the map viewer stage, tabs' active state, status strip, review-queue items — every raised surface, regardless of how modal or how minor.

## Shapes

Two radii, applied by function, not by component size: `14px` (`--radius`) on every container-scale surface (cards, panels, dialogs, the map viewer stage, notices, route cards), and a full `999px` pill on every control-or-status-scale element (buttons, badges, tags, tabs, status pills, search-form inputs' pill container where used). Form fields (text input, select, textarea) get a third, smaller radius of `10px` — between the two, marking them as interactive-but-not-a-container. Small inline elements (swatches, route badges, quota inputs) use `6–8px`. Borders are uniformly `1px solid var(--border)`; there is no border-weight scale. Circles appear only for avatar-like marks (org badges, step-number badges, the status-strip's node dots) — never for containers.

### Named Rules
**The Pill-Is-Interactive Rule.** If it's fully rounded (999px), it either does something on click or reports a status. If it's a container that holds other content, it uses 14px, never a pill. This is how the system signals "this is a control" vs. "this is a surface" without any other visual cue.

## Components

Every component reads as procedural and unadorned: clear affordance, no flourish, consistent geometry, colour reserved for meaning. Nothing is skeuomorphic or textured; everything is flat color + a single border + the one ambient shadow where it's raised.

### Buttons
- **Shape:** full pill (`border-radius: 999px`), `11px 20px` padding (`8px 15px` for the small variant `.btn-sm`, `5px 10px` for `.btn-xs`).
- **Primary:** Civic Blue fill, white text (`--primary-ink`). Hover darkens the fill by mixing 12% black (`color-mix(in srgb, var(--primary) 88%, black)`); no shadow change on hover, only a `translateY(1px)` on active/press.
- **Ghost:** transparent background, ink text, `1px` border in `--border`. Hover fills with `--surface`, the one-step-off-paper neutral.
- **Disabled:** `opacity: .45`, `cursor: not-allowed`, hover states explicitly neutralized so a disabled button never looks live — this was a deliberate fix (see the code comment in `styles.css`) after a disabled button silently reading as clickable caused real confusion.

### Chips / Badges / Tags / Pills
- **Style:** tinted background (`color-mix` at 8–18% of the semantic color), full-color text and border, pill radius. `.badge` (uppercase, tracked, bold — category marker), `.tag` (same treatment, used for area/place/expert markers), `.pill` (neutral by default, green/amber/red triage variants that also spell out their meaning in text — never color-only), `.status-pill` (five semantic variants: neutral/requested/in-prep/published/rejected, each its own tint).
- **State:** the sample/demo badge is deliberately red regardless of context — it means "not real data," which outranks any other status coloring.

### Cards / Containers
- **Corner Style:** 14px radius throughout.
- **Background:** `--bg` (paper) on light chrome sitting on `--surface`; `--surface` for cards that themselves sit on paper (context-dependent, always one step of contrast from what's behind them).
- **Shadow Strategy:** the one ambient shadow (see Elevation & Depth); no per-card variation.
- **Border:** always `1px solid var(--border)`.
- **Internal Padding:** `22px` on shopfront cards, `12–16px` on denser app panels.

### Inputs / Fields
- **Style:** `1px solid var(--border)`, `10px` radius, `11px 13px` padding, background `--bg`, inherits font.
- **Focus:** border shifts to Civic Blue plus a `3px` glow ring (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent)`) — no outline removal without a replacement focus indicator.
- **Error / Disabled:** `.field.invalid` shifts the border to `--err`; disabled poi-list items desaturate to `--muted` text with strikethrough where the whole item (not just the input) is unavailable.

### Navigation
- Sticky header, `62px` tall, translucent paper (`color-mix` at 88% + backdrop blur), `1px` bottom border. Nav links are muted by default, ink on hover, no underline. On mobile (≤720px) the nav wraps to a second row rather than collapsing into a hamburger — the link count is small enough that this stays legible.

### Status Strip (signature component)
A horizontal rail of connected nodes (done / here / blocked / skipped) reporting exactly where a map version sits in its review lifecycle and whose turn it is to act next. Each node is a dot-on-a-line with a label, a timestamp, and an actor tag; the "here" node gets a glow ring in Civic Blue, a "blocked" node gets Notice Amber instead of red — blocked-but-recoverable is treated as a warning, not a failure. This is the system's clearest expression of "plain and procedural": no icons, no illustration, just state made legible as position on a line.

## Do's and Don'ts

### Do:
- **Do** keep color strictly semantic — every non-neutral color use should be answerable with "what status or action does this represent?"
- **Do** use the pill radius (999px) for anything interactive or status-bearing, and 14px for anything that's a container.
- **Do** use `color-mix(in srgb, <token> X%, transparent)` for tinted backgrounds rather than introducing a new hex value.
- **Do** keep the single ambient shadow as the only elevation cue; don't invent a second, heavier shadow without deciding it belongs (see the open Elevation question above).
- **Do** back every color-coded state with a text label too (the green/amber/red triage pills spell out their meaning) — color is reinforcement, never the sole signal.
- **Do** preserve `:focus-visible` rings on every interactive element; this audience includes public bodies with a statutory accessibility duty.

### Don't:
- **Don't** introduce a second typeface or a display font. One system font stack, differentiated by size/weight/spacing only.
- **Don't** use amber or red for anything that isn't reporting an actual warning or failure state — they're load-bearing, not decorative.
- **Don't** give a disabled control any hover, press, or color feedback that could read as "still live."
- **Don't** add shadow escalation, gradients (beyond the single existing hero radial-gradient wash), textures, or skeuomorphic treatment — the noticeboard stays flat.
- **Don't** let the internal app's density (two-pane layouts, dense tables) leak generous shopfront whitespace values, or vice versa — each register keeps its own rhythm on the same tokens.
