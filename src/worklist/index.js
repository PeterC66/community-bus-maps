// The one ranked list of what the portal is waiting on.
//
// Every queue in this system already had a home — applications, map requests,
// awaiting-build, proposed updates, refresh flags, the review queue — and each
// had its own tab. What nobody had was the answer to "what should I do next?",
// which meant visiting all of them and then opening a runbook to remember the
// command. This module is that answer, and it is deliberately the ONLY place
// the ranking lives: the admin console's To-do tab renders it, and the
// bus-work skill on the operator's laptop imports this same module (locally)
// or GETs /api/admin/worklist (remotely). Two views, one implementation.
//
// It is a pure read + rank over db/index.js. It writes nothing, decides
// nothing, and never bypasses an approval gate — an item that represents a
// gate says "you decide", it does not offer to decide.
//
// Items the SERVER cannot see are not here: whether the local engine template
// has moved on, whether S6 has run, whether a byte-identical gate passes. Those
// are the laptop's own map tree, and the skill adds them to this list at ranks
// 0, 7 and 8. If the portal ever learns them it will be because the laptop
// pushes them up, not because this module guesses.

import {
  listPendingPublishRequests, listApplications, listMapsByStatus, listAwaitingBuild,
  listPendingProposedUpdates, listMessages, listProposedForMap,
} from '../db/index.js';

// Ranks are "who is blocked", not "which queue". Lower acts first.
// 0 is reserved for the skill's failing-gate items — nothing the portal knows
// about outranks "the engine no longer reproduces a map we already shipped".
export const BANDS = [
  { max: 0, name: 'Broken' },
  { max: 3, name: 'Someone is blocked' },
  { max: 8, name: 'Your move' },
  { max: 99, name: 'Waiting on others' },
];
export const bandFor = (rank) => (BANDS.find((b) => rank <= b.max) || BANDS[BANDS.length - 1]).name;

// SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC; anything already ISO passes through.
export function daysSince(v) {
  if (!v) return null;
  const t = new Date(/^\d{4}-\d{2}-\d{2} /.test(String(v)) ? `${String(v).replace(' ', 'T')}Z` : v).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

// A refresh flag is a note that a town's services are changing; nothing marks
// it read (message.status is never updated anywhere). So "still open" is
// derived from the thing that would actually resolve it: a proposed update
// staged for that map SINCE the flag was raised. That way the item disappears
// when the work is done, not when someone remembers to tick it off.
function openRefreshFlags(messages) {
  const byMap = new Map();
  return messages.filter((m) => m.kind === 'refresh-flag' && m.map_id != null).filter((m) => {
    if (!byMap.has(m.map_id)) byMap.set(m.map_id, listProposedForMap(m.map_id));
    return !byMap.get(m.map_id).some((pu) => pu.created_at > m.created_at);
  });
}

// The flag body is written by scripts/check-upcoming-refreshes.mjs and opens
// with one summary line; the rest is the bullet list of changes. Take the first
// line for the title and keep a few bullets as detail.
function summariseFlag(body) {
  const lines = String(body || '').split('\n').map((l) => l.replace(/\r$/, ''));
  return {
    head: (lines[0] || '').trim(),
    bullets: lines.filter((l) => l.trim().startsWith('- ')).slice(0, 6).join('\n'),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl  absolute origin for the `where` links (so the
 *   skill's terminal output and the console agree on what to open)
 * @returns {{ meta: object, items: object[] }}
 */
export function buildWorklist({ baseUrl = process.env.PUBLIC_BASE_URL || '' } = {}) {
  const url = (p) => `${String(baseUrl).replace(/\/$/, '')}${p}`;
  const items = [];
  const add = (it) => items.push(it);

  // 1 — a customer submitted a map for review and is blocked until it is looked
  // at. The third approval gate; the decision is never automated.
  for (const r of listPendingPublishRequests()) {
    add({
      key: `review-${r.id}`, rank: 1, type: 'review',
      title: `Review "${r.map_name}" ${r.version_key || ''} for publication`.trim(),
      why: `${r.customer_name || 'unowned'} submitted it${r.requested_by_email ? ` (${r.requested_by_email})` : ''} and cannot go public until you approve or reject it.`,
      who: r.customer_name || 'unowned', ageDays: daysSince(r.created_at),
      where: url('/app/review'), runbook: 'R3',
      do: [{ kind: 'portal-ui', what: 'Open the review queue, work the five-item checklist, approve or send back.', url: url('/app/review') }],
    });
  }

  // 2 — organisations waiting on a vetting decision. One visit to one tab, so a
  // queue of them is one item: the list answers "what next", and "open
  // Applications" is a single next thing.
  const apps = listApplications({ status: 'pending' });
  if (apps.length) {
    const names = apps.map((a) => a.org_name || a.email).filter(Boolean);
    add({
      key: 'applications', rank: 2, type: 'application',
      title: apps.length === 1 ? `Decide the application from ${names[0]}` : `Decide ${apps.length} organisation applications`,
      why: `${apps.length === 1 ? 'Waiting' : `Waiting: ${names.join(', ')}`}. Approving creates the customer, its first editor and a passwordless invite. Vet against the quota + vetting policy first.`,
      who: apps.length === 1 ? names[0] : `${apps.length} organisations`,
      ageDays: Math.max(...apps.map((a) => daysSince(a.created_at) ?? 0)),
      where: url('/app/admin'), runbook: 'R2', count: apps.length,
      do: [{ kind: 'portal-ui', what: 'Admin → Applications → Approve or Reject.', url: url('/app/admin') }],
    });
  }

  // 3 — a customer asked for a map. Approval is the quota gate, so it blocks
  // the build behind it.
  for (const m of listMapsByStatus(['requested'])) {
    add({
      key: `request-${m.id}`, rank: 3, type: 'request-decision',
      title: `Approve or reject the map request "${m.name}" (${m.kind})`,
      why: `${m.customer_name || 'unowned'} requested it${m.requested_by_email ? ` (${m.requested_by_email})` : ''}. Nothing can be built until it is approved — approval is the quota gate.`,
      who: m.customer_name || 'unowned', ageDays: daysSince(m.created_at), detail: m.request_note || null,
      where: url('/app/admin'), runbook: 'R1',
      do: [{ kind: 'portal-ui', what: 'Admin → Map requests → Approve (or Reject, which frees the quota slot).', url: url('/app/admin') }],
    });
  }

  // 4 — approved, and now it needs the central pipeline: the making half. The
  // command fulfils the request IN PLACE, so the row becomes the built map.
  for (const m of listAwaitingBuild()) {
    const place = m.kind === 'place';
    add({
      key: `build-${m.id}`, rank: 4, type: 'build',
      title: `Build the ${m.kind} map "${m.name}"${m.subject && m.subject !== m.name ? ` (${m.subject})` : ''}`,
      why: `Approved for ${m.customer_name || 'unowned'}${m.requested_by_email ? ` (${m.requested_by_email})` : ''} and awaiting a build. Fulfilling the request in place keeps it one row with quota counted once.`,
      who: m.customer_name || 'unowned', ageDays: daysSince(m.created_at), detail: m.request_note || null,
      where: url('/app/admin'), runbook: 'R1',
      kind: m.kind, subject: m.subject || m.name, slug: m.slug,
      skill: place ? 'make-place-bus-leaflet' : 'make-bus-leaflet',
      do: [
        { kind: 'skill', what: `Run the ${place ? 'make-place-bus-leaflet' : 'make-bus-leaflet'} skill for "${m.subject || m.name}" through S1–S6.` },
        { kind: 'shell', cwd: 'portal', cmd: `node scripts/import-map.mjs --request ${m.id} --src "<S5-render dir>"` },
        // PowerShell form deliberately: the runbook's bash `VAR=x cmd` prefix is
        // not valid PowerShell, and `npm run verify` SKIPS SILENTLY without a
        // fixture dir — so run as documented on Windows it proves nothing.
        {
          kind: 'shell', cwd: 'portal',
          cmd: `$env:${place ? 'PLACE_FIXTURE_DIR' : 'FIXTURE_DIR'} = "<S5-render dir>"; npm run verify:${place ? 'place' : 'area'}`,
          note: 'PowerShell; must print PASS with byte counts',
        },
      ],
    });
  }

  // 5 — BODS says a live map's services are changing and nothing has been
  // staged since the flag was raised.
  const messages = listMessages();
  for (const f of openRefreshFlags(messages)) {
    const { head, bullets } = summariseFlag(f.body);
    add({
      key: `refresh-${f.map_slug || f.map_id}`, rank: 5, type: 'refresh',
      title: `Refresh "${f.map_name || `map #${f.map_id}`}" — upcoming service changes`,
      why: head || 'The monthly GTFS scan found changes this map does not draw yet.',
      who: '—', ageDays: daysSince(f.created_at), detail: bullets || null,
      where: url('/app/admin'), runbook: 'R4', slug: f.map_slug || null,
      do: [
        { kind: 'skill', what: 'Re-run the map\'s own skill for that town/place to produce a fresh S5-render dir.' },
        { kind: 'shell', cwd: 'portal', cmd: `node scripts/propose-update.mjs --map ${f.map_slug || f.map_id} --src "<fresh S5-render dir>" --note "GTFS refresh"` },
      ],
    });
  }

  // 6 / 9 — staged and waiting on the customer. Not your work until it sits:
  // an unaccepted update means their published map is quietly going stale.
  for (const p of listPendingProposedUpdates()) {
    const age = daysSince(p.created_at);
    const stale = age != null && age >= 14;
    add({
      key: `proposed-${p.id}`, rank: stale ? 6 : 9, type: 'awaiting-customer',
      title: `${stale ? 'Nudge' : 'Waiting on'} ${p.customer_name || 'the customer'} — proposed update to "${p.map_name}"`,
      why: stale
        ? `Staged ${age} days ago and still neither accepted nor declined; their published map is going stale.`
        : 'Staged and waiting for the customer to accept or decline. Nothing for you to do unless it sits.',
      who: p.customer_name || 'unowned', ageDays: age,
      where: url('/app/admin'), runbook: 'R4',
      do: [{ kind: 'portal-ui', what: 'Admin → Refreshes. Nudge by email if it has sat.', url: url('/app/admin') }],
    });
  }

  items.sort((a, b) => a.rank - b.rank || (b.ageDays || 0) - (a.ageDays || 0) || a.key.localeCompare(b.key));
  for (const it of items) it.band = bandFor(it.rank);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      total: items.length,
      // "Actionable" = the operator is the blocker. Rank 9 is somebody else's.
      actionable: items.filter((i) => i.rank <= 8).length,
      byType: items.reduce((a, i) => ({ ...a, [i.type]: (a[i.type] || 0) + 1 }), {}),
    },
    items,
  };
}
