// One HTML escaper for server-built markup.
//
// Until 2026-09-02 the three transactional emails in ./email/notify.js and the
// magic-link email in ./email/index.js interpolated text straight into an HTML
// template literal: the map name (customer-typed on /api/maps/request, up to
// 120 characters), an approver's rejection reason (up to 2,000), the update's
// source note and the action URL. None of it reached the site, so it was not an
// XSS on busmaps.uk -- but a map named `<b>Fenmarsh</b>` arrived in the
// customer's inbox as bold, and a reason containing `<` lost the rest of its
// sentence. The codebase review of 2026-09-01 (buses-data OA-224, Tier 1.2)
// counted twelve escapers across src/ and public/, none of them used here.
//
// This is the one to use for anything that is text inside an element or an
// attribute value. It escapes the five characters HTML cares about, so the same
// function is safe in both positions; a URL goes through it too, because a `"`
// in a URL would end the attribute.

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
