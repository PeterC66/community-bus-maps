// What must be true of a URL this site ADVERTISES — shared by the offline test
// and the post-deploy check, so the two can never disagree about the rule.
//
// THE QUESTION NOTHING ASKED (buses-data OA-284). `scripts/check-live-routes.mjs`
// asks whether every route in the table still answers; `scripts/test-indexing.mjs`
// asks what `robots.txt` says and whether each hand-written page carries its own
// canonical. Neither asks the join: of the URLs `sitemap.xml` actually offers a
// crawler, does each one answer, and does each one say which URL it is?
//
// It was measured by hand against the live site on 2026-09-08 and 47 of 48 were
// perfect. The 48th was `/o/busmaps-uk-pilot`, which served the raw shell — the
// same title and the same description that every organisation page would ever
// have, and no canonical at all. The rule was half-enforced: `org.html` is in
// `SERVER_FILLED_SHELLS`, and `test-indexing.mjs` asserts those carry no
// canonical of their own BECAUSE the server injects one. Nothing asserted that
// the server did.
//
// So the rule here is deliberately about the sitemap's own population rather
// than about a list written down somewhere: a URL is in scope because the site
// offers it, which is the property that made `/o/:slug` interesting and the
// property a thirteenth static page would inherit for free.

/** Undo the escaping `xmlEscape()` applies when it writes a <loc>. */
const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#3?9;/g, "'")
  .replace(/&amp;/g, '&'); // last: an escaped ampersand must not re-enter the others

/** Every <loc> a sitemap advertises, in document order. */
export function locsIn(xml) {
  return [...String(xml).matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => unescapeXml(m[1].trim()));
}

/** Every self-declared canonical in a document. More than one is a fault of its own. */
export function canonicalsIn(html) {
  return [...String(html).matchAll(/<link\s+rel="canonical"\s+href="([^"]*)"\s*\/?>/gi)].map((m) => m[1]);
}

/** The document's <title> text, or '' — compared between pages, never to a fixed string. */
export function titleIn(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(String(html));
  return m ? m[1].trim() : '';
}

/** The document's meta description, or ''. */
export function descriptionIn(html) {
  const m = /<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/i.exec(String(html));
  return m ? m[1] : '';
}

/** How many <title> tags the document carries. Two is worse than none. */
export const titleCount = (html) => (String(html).match(/<title>/gi) || []).length;

/**
 * The verdict on ONE advertised URL. Returns a fault sentence, or null if it is
 * sound. The caller supplies the fetch, so the same judgement runs over
 * `app.inject` on this laptop and over `fetch` against the deployed site.
 *
 * A non-HTML answer (the sitemap could one day advertise a PDF) is held to the
 * status rule only — asserting a canonical on something that cannot carry one
 * would be a rule about the checker rather than about the site.
 */
export function judgeAdvertisedUrl({ loc, status, contentType = '', html = '' }) {
  if (status !== 200) return `the sitemap advertises it and it answers ${status}`;
  if (!/html/i.test(contentType)) return null;
  const found = canonicalsIn(html);
  if (found.length === 0) return 'no <link rel="canonical"> — nothing tells a crawler which URL is authoritative';
  if (found.length > 1) return `${found.length} canonical tags — a crawler is entitled to ignore all of them`;
  if (found[0] !== loc) return `its canonical says ${found[0]}, the sitemap says ${loc}`;
  if (titleCount(html) !== 1) return `${titleCount(html)} <title> tags — the head was completed without removing the shell's own`;
  if (!titleIn(html)) return 'an empty <title>';
  if (!descriptionIn(html)) return 'no <meta name="description">';
  return null;
}

/**
 * The fault a single organisation cannot show: two advertised pages that arrive
 * as the same document. Takes [{ loc, title, description }] and reports every
 * pair sharing a title or a description.
 *
 * This is the half that is SILENT today and real on the second organisation, so
 * it is the half a live check against a one-organisation site cannot make — see
 * the offline test, which seeds two.
 */
export function duplicateIdentities(pages) {
  const faults = [];
  for (const field of ['title', 'description']) {
    const seen = new Map();
    for (const p of pages) {
      const v = p[field];
      if (!v) continue;
      if (seen.has(v)) faults.push(`${p.loc} and ${seen.get(v)} share a ${field}: "${v}"`);
      else seen.set(v, p.loc);
    }
  }
  return faults;
}
