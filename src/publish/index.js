// Publish-gate domain logic (P4) — pure, deterministic, no I/O.
//
// Two pieces of evidence back a review:
//   1. changeSummary() — exactly what this version changes versus the currently
//      published version (or the baseline, if nothing is published yet). Because
//      the safe subset only permits route recolours + POI show/hide, the diff is
//      bounded and complete: the approver can be sure nothing else moved.
//   2. the review CHECKLIST — a fixed set of reasonableness confirmations the
//      approver must ALL tick; validateChecklist() enforces completeness on the
//      server so a map can't be published without recorded human confirmation.
//
// The checklist is deliberately scoped to what a person can confirm by eye in a
// few minutes: does this look right. It is not a claim that routes, stops or
// timetables were independently re-verified against source data — see
// docs/LICENSING.md §5 and docs/H1-operations-handbook.md for what review does and
// doesn't cover.

// Bump when the checklist wording/ids change so stored evidence stays interpretable.
// v3 (findings H1): the first three items now say ON EVERY SHEET. A version is
// the whole map — accept, send, review and publish all operate on every enabled
// output together — and the checklist was the one place that could have said so
// and didn't, while the screen beside it lists the sheets separately.
// v4 (P8a) added `alternative`: once a published map has a public page, its text
// alternative is part of what is being published, so it is signed off too.
// v5: six tickboxes had become a rubber-stamp exercise — approvers stopped reading
// past the first few. Consolidated to three, one per thing actually being checked
// (appearance, print legibility, text alternative); the "this is a visual check,
// not independent verification" caveat that was item 5 is now static text next to
// the checklist rather than something to tick, since it isn't a check the approver
// performs, it's a boundary on what the other checks mean.
export const CHECKLIST_VERSION = 5;

// Every item is required — publishing is a deliberate, complete review.
export const CHECKLIST = [
  { id: 'appearance', label: 'At a glance, the services shown, route colours, and points of interest look right on every sheet.' },
  { id: 'legible',    label: 'I have viewed the full-size prints (JPG) and all text is legible.' },
  { id: 'alternative', label: 'I have opened the map’s services and stops list (its text alternative) — it matches the map, and the map page works from the keyboard.' },
];

const CHECKLIST_IDS = CHECKLIST.map((c) => c.id);

/**
 * Validate a submitted checklist: every required item must be present and true.
 * @param {any} answers  { services:true, colours:true, ... } from the approver
 * @returns {{ ok:boolean, missing:string[], checklist:Record<string,boolean> }}
 */
export function validateChecklist(answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const checklist = {};
  const missing = [];
  for (const id of CHECKLIST_IDS) {
    const ticked = a[id] === true;
    checklist[id] = ticked;
    if (!ticked) missing.push(id);
  }
  return { ok: missing.length === 0, missing, checklist };
}

// A MANAGED customer's yes arrives by email, never through the portal (buses-data
// OA-468). Peter writes to a managed customer and they answer him, so the one
// confirmation that matters for their map is a message in the correspondence
// record, which the portal cannot see. The approver records it here: the date the
// customer confirmed, and the CORR-nnn/message that holds it — a reference, not
// the email itself, because a correspondent's name is kept out of every store
// but one. Required on a managed customer's map (src/routes/review.js); on any
// other map it is optional, and validated the same way when given.
const CONFIRM_REF = /^CORR-\d{3,}\/\d{3,}$/;

/**
 * Validate a customer confirmation. Pure; `today` is injectable for tests.
 * @param {any} input  { on: 'YYYY-MM-DD', ref: 'CORR-nnn/nnn' }
 * @returns {{ ok:true, value:{by:'email',on:string,ref:string} } | { ok:false, fields:string[] }}
 */
export function validateCustomerConfirmation(input, { today = new Date() } = {}) {
  const c = input && typeof input === 'object' ? input : {};
  const on = typeof c.on === 'string' ? c.on.trim() : '';
  const ref = typeof c.ref === 'string' ? c.ref.trim().toUpperCase() : '';
  const fields = [];
  const d = /^\d{4}-\d{2}-\d{2}$/.test(on) ? new Date(`${on}T00:00:00Z`) : null;
  // A real calendar date (2026-02-30 round-trips to March, so it is refused), and
  // not later than tomorrow — one day of slack for a UK evening against UTC.
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== on) fields.push('on');
  else if (d.getTime() > today.getTime() + 86_400_000) fields.push('on');
  if (!CONFIRM_REF.test(ref)) fields.push('ref');
  return fields.length ? { ok: false, fields } : { ok: true, value: { by: 'email', on, ref } };
}

/** True when a confirmation was offered at all, so an optional one can still be refused as malformed. */
export function customerConfirmationGiven(input) {
  return !!input && typeof input === 'object'
    && [input.on, input.ref].some((v) => typeof v === 'string' && v.trim() !== '');
}

/**
 * Pick which version a rollback should serve, and refuse the cases that must not
 * happen. Pure so the rules are testable away from HTTP: the ONLY versions on
 * offer are ones this map already published (an approved publish_request) whose
 * rendered files are still on disk — a revert can never serve bytes that did not
 * pass the gate.
 *
 * @param {Array} history  rows from publishedHistoryFor(): { versionId, version, isCurrent, files[], revertable }
 * @param {number|null} wantedId  the version the approver picked; null = "the one published before this"
 * @returns {{ target: object } | { code: number, error: string }}
 */
export function chooseRevertTarget(history, wantedId = null) {
  const rows = Array.isArray(history) ? history : [];
  const target = wantedId != null
    ? rows.find((h) => h.versionId === Number(wantedId))
    : rows.find((h) => h.revertable);           // history is newest-first ⇒ the previous one
  if (!target) {
    return wantedId != null
      ? { code: 400, error: 'That version is not one this map previously published — only reviewed versions can be reverted to.' }
      : { code: 400, error: 'There is no earlier published version to revert to. Publish a corrected version through the gate instead.' };
  }
  if (target.isCurrent) return { code: 409, error: `${target.version} is already the published version.` };
  if (!target.files || !target.files.length) {
    return { code: 409, error: `The rendered files for ${target.version} are no longer on disk, so it cannot be served. Publish a corrected version through the gate.` };
  }
  return { target };
}

// --- overrides readers (mirror the safe subset shape) ---
function colorsOf(ov) {
  return ov && ov.routeColors && typeof ov.routeColors === 'object' ? ov.routeColors : {};
}
function hiddenOf(ov) {
  const pois = ov && ov.internal && ov.internal.pois && typeof ov.internal.pois === 'object' ? ov.internal.pois : {};
  return new Set(Object.keys(pois).filter((k) => pois[k] && pois[k].hide === true));
}
/**
 * The landmark chooser's answers (OA-212): key -> { tier, as }.
 *
 * A SECOND READER RATHER THAN A WIDENING OF hiddenOf(). The two say different
 * things — `hide` stops a POI being drawn, a tier decides whether it is selected
 * at all and can also rename it — and a reviewer needs to be told which. Folding
 * them together would have made a rename invisible, which is the exact fault
 * this function was widened to fix.
 */
function tiersOf(ov) {
  const t = ov && ov.internal && ov.internal.poiTiers && typeof ov.internal.poiTiers === 'object' ? ov.internal.poiTiers : {};
  const out = new Map();
  for (const k of Object.keys(t)) {
    const v = t[k];
    if (!v || typeof v !== 'object') continue;
    out.set(k, { tier: v.tier || 'may', as: v.as || null });
  }
  return out;
}
/**
 * The category switch (OA-439): opt-in category -> true | false, the customer's
 * layer only. Absent means "the town's own default", which this function cannot
 * see and does not need to: a change is a change of the customer's answer.
 */
function switchesOf(ov) {
  const s = ov && ov.internal && ov.internal.poiInclude;
  const out = new Map();
  if (!s || typeof s !== 'object' || Array.isArray(s)) return out;
  for (const k of Object.keys(s)) if (typeof s[k] === 'boolean') out.set(k, s[k]);
  return out;
}
const SWITCH_WORDS = { true: 'drawn', false: 'not drawn', undefined: 'as the town was built' };

/** The reviewer's words for the three engine tiers. Never shows an engine key. */
const TIER_WORDS = { must: 'always show', may: 'show if there is room', miss: 'do not show' };
const eff = (colors, palette, r) => (colors[r] || palette[r] || '').toLowerCase();

/**
 * Deterministic diff of what a version changes versus a reference version.
 *
 * TWO kinds of change reach a reviewer, and for a long time only the first was
 * counted here:
 *   1. the customer's safe-subset overrides (colours, landmarks, operators), and
 *   2. the underlying map DATA, when a version was made by accepting a refresh.
 * Comparing overrides alone made a fully-rebuilt map report as identical to the
 * published one — the editor advised "make an edit and save first" and the review
 * screen told the approver there was "nothing to change" (findings A1). `unchanged`
 * now means both are empty, which is the only reading that keeps the gate honest.
 *
 * @param {object} toOverrides    the version being published
 * @param {object} fromOverrides  the currently-published version's overrides ({} if none)
 * @param {object} opts
 * @param {Record<string,string>} opts.palette  route -> default hex (for showing defaults)
 * @param {boolean} opts.hasBaseline            true when `from` is a real published version, false = baseline
 * @param {Array} opts.dataChanges              accepted data refreshes carried since `from` (dataChangesSince())
 * @returns {{ base:string, unchanged:boolean, routes:Array, poisHidden:string[], poisShown:string[],
 *            landmarks:Array, renames:Array, categories:Array,
 *            dataChanges:Array, dataChanged:boolean, overridesUnchanged:boolean }}
 */
export function changeSummary(toOverrides, fromOverrides, { palette = {}, hasBaseline = false, dataChanges = [] } = {}) {
  const toC = colorsOf(toOverrides), fromC = colorsOf(fromOverrides);
  const toH = hiddenOf(toOverrides), fromH = hiddenOf(fromOverrides);

  // Route colours that differ in effect between the two versions.
  const routeIds = new Set([...Object.keys(toC), ...Object.keys(fromC)]);
  const routes = [];
  for (const r of routeIds) {
    const to = eff(toC, palette, r), from = eff(fromC, palette, r);
    if (to && from && to !== from) {
      routes.push({ id: r, from, to, default: (palette[r] || '').toLowerCase() || null });
    }
  }
  routes.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  const poisHidden = [...toH].filter((k) => !fromH.has(k)).sort();  // newly hidden vs published
  const poisShown = [...fromH].filter((k) => !toH.has(k)).sort();   // newly shown vs published

  /* LANDMARK ANSWERS (OA-212), and this block is why the paragraph above matters.
   *
   * The chooser gave a customer two new powers — decide whether a place is
   * selected at all, and rename it — and for a few hours neither reached this
   * function. A version that dropped a landmark, promoted another and renamed a
   * third reported `unchanged: true`, so the review screen told an approver
   * there was nothing to look at. That is worse than an incomplete summary: the
   * documented promise is that what this shows is not a summary of the changes
   * but ALL of them, and a gate that quietly stops covering a class of edit is
   * the shape this project keeps meeting.
   *
   * A tier is reported when it CHANGES, in the reviewer's words rather than the
   * engine's, and a rename is reported separately because it alters what the
   * sheet says rather than what it contains. */
  const toT = tiersOf(toOverrides), fromT = tiersOf(fromOverrides);
  const tierKeys = new Set([...toT.keys(), ...fromT.keys()]);
  const landmarks = [];
  const renames = [];
  for (const k of tierKeys) {
    const a = fromT.get(k) || { tier: 'may', as: null };
    const b = toT.get(k) || { tier: 'may', as: null };
    if (a.tier !== b.tier) {
      landmarks.push({ key: k, from: TIER_WORDS[a.tier] || a.tier, to: TIER_WORDS[b.tier] || b.tier });
    }
    if ((a.as || null) !== (b.as || null)) {
      renames.push({ key: k, from: a.as, to: b.as });
    }
  }
  landmarks.sort((x, y) => x.key.localeCompare(y.key));
  renames.sort((x, y) => x.key.localeCompare(y.key));

  /* THE CATEGORY SWITCH (OA-439), for the reason the block above gives: the
   * chooser can now switch pubs on, and a version whose only change was that
   * would otherwise report `unchanged: true` to the approver. */
  const toS = switchesOf(toOverrides), fromS = switchesOf(fromOverrides);
  const categories = [];
  for (const c of new Set([...toS.keys(), ...fromS.keys()])) {
    const a = fromS.get(c), b = toS.get(c);
    if (a !== b) categories.push({ cat: c, from: SWITCH_WORDS[a], to: SWITCH_WORDS[b] });
  }
  categories.sort((x, y) => x.cat.localeCompare(y.cat));

  // Keep only refreshes that actually moved something — a no-op refresh is real
  // provenance but tells a reviewer nothing, and must not defeat "unchanged".
  const data = (Array.isArray(dataChanges) ? dataChanges : []).filter((d) => d && !isEmptyDataChange(d.summary));
  const overridesUnchanged = routes.length === 0 && poisHidden.length === 0 && poisShown.length === 0
    && landmarks.length === 0 && renames.length === 0 && categories.length === 0;

  return {
    base: hasBaseline ? 'published' : 'baseline',
    unchanged: overridesUnchanged && data.length === 0,
    overridesUnchanged,
    routes,
    poisHidden,
    poisShown,
    landmarks,
    renames,
    categories,
    dataChanges: data,
    dataChanged: data.length > 0,
  };
}

/**
 * True when a staged refresh's summary reports no difference at all.
 * diffRouteData() always sets `unchanged`, so trust it when present; the field
 * checks are the fallback for a summary written by an older or partial producer.
 */
export function isEmptyDataChange(s) {
  if (!s || typeof s !== 'object') return true;
  if (typeof s.unchanged === 'boolean') return s.unchanged;
  const some = (k) => Array.isArray(s[k]) && s[k].length > 0;
  return !(some('routesAdded') || some('routesRemoved') || some('stopsChanged') || some('descChanged')
    || some('operatorsAdded') || some('operatorsRemoved') || (s.validity && s.validity.to) || s.versionLabel
    // OA-253, and it is unreachable from dataChangeSummary(), which folds the
    // landmark diff into `unchanged` above. It is here for the case this list
    // exists for — a summary from a partial producer that carries the fields and
    // no verdict — so that the two ways of answering the question cannot disagree.
    // A summary stored BEFORE the landmark diff existed keeps its own `unchanged`
    // and is read exactly as it always was; nothing is retro-computed.
    || some('landmarksAdded') || some('landmarksRemoved'));
}
