// A map's description as safe HTML, with a URL in the sentence made a link
// (buses-data OA-550). Pure: no DOM, no Node imports, publicly served; loaded by
// public/js/public-map.js with a dynamic import and tested by
// scripts/test-map-description.mjs.
//
// The text is ESCAPED FIRST and the anchors are built from the escaped text, so a
// description can never put markup on the page (cleanDescription() has already
// dropped angle brackets; this does not rely on it). A link to this site opens in
// place; any other host gets rel="nofollow noopener" because the clerk, not we,
// chose it.

const SITE = 'busmaps.uk';
const URL_RE = /\b(?:https?:\/\/[^\s<>"']+|(?:www\.)?busmaps\.uk(?:\/[^\s<>"']*)?)/gi;
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function linkifyDescription(text) {
  const src = String(text == null ? '' : text);
  let out = '', last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(src))) {
    let url = m[0];
    // Sentence punctuation after a URL belongs to the sentence, not the link.
    const tail = /[.,;:!?)\]]+$/.exec(url);
    if (tail) url = url.slice(0, -tail[0].length);
    if (!url) continue;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^www\./i, '')}`;
    let host = '';
    try { host = new URL(href).hostname.toLowerCase(); } catch { continue; }
    const own = host === SITE || host.endsWith(`.${SITE}`);
    out += esc(src.slice(last, m.index));
    out += `<a href="${esc(href)}"${own ? '' : ' rel="nofollow noopener"'}>${esc(url)}</a>`;
    last = m.index + url.length;
    URL_RE.lastIndex = last;
  }
  return out + esc(src.slice(last));
}
