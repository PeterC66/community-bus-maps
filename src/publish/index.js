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
export const CHECKLIST_VERSION = 2;

// Every item is required — publishing is a deliberate, complete review.
export const CHECKLIST = [
  { id: 'services',  label: 'At a glance, the services shown look right — no obviously wrong route numbers or destinations.' },
  { id: 'colours',   label: 'Route colours are distinct and remain colour-blind friendly.' },
  { id: 'pois',      label: 'At a glance, the points of interest shown or hidden look right and nothing obvious is missing.' },
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
 * @param {object} toOverrides    the version being published
 * @param {object} fromOverrides  the currently-published version's overrides ({} if none)
 * @param {object} opts
 * @param {Record<string,string>} opts.palette  route -> default hex (for showing defaults)
 * @param {boolean} opts.hasBaseline            true when `from` is a real published version, false = baseline
 * @returns {{ base:string, unchanged:boolean, routes:Array, poisHidden:string[], poisShown:string[] }}
 */
export function changeSummary(toOverrides, fromOverrides, { palette = {}, hasBaseline = false } = {}) {
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

  return {
    base: hasBaseline ? 'published' : 'baseline',
    unchanged: routes.length === 0 && poisHidden.length === 0 && poisShown.length === 0,
    routes,
    poisHidden,
    poisShown,
  };
}
