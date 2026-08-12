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
export const CHECKLIST_VERSION = 3;

// Every item is required — publishing is a deliberate, complete review.
export const CHECKLIST = [
  { id: 'services',  label: 'At a glance, the services shown look right on every sheet — no obviously wrong route numbers or destinations.' },
  { id: 'colours',   label: 'Route colours are distinct and remain colour-blind friendly on every sheet.' },
  { id: 'pois',      label: 'At a glance, the points of interest shown or hidden look right on every sheet and nothing obvious is missing.' },
  { id: 'legible',   label: 'I have viewed the full-size print (JPG) and all text is legible.' },
  { id: 'accurate',  label: 'This is a visual check, not an independent verification against timetables — nothing here looks wrong or out of date.' },
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

  // Keep only refreshes that actually moved something — a no-op refresh is real
  // provenance but tells a reviewer nothing, and must not defeat "unchanged".
  const data = (Array.isArray(dataChanges) ? dataChanges : []).filter((d) => d && !isEmptyDataChange(d.summary));
  const overridesUnchanged = routes.length === 0 && poisHidden.length === 0 && poisShown.length === 0;

  return {
    base: hasBaseline ? 'published' : 'baseline',
    unchanged: overridesUnchanged && data.length === 0,
    overridesUnchanged,
    routes,
    poisHidden,
    poisShown,
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
    || some('operatorsAdded') || some('operatorsRemoved') || (s.validity && s.validity.to) || s.versionLabel);
}
