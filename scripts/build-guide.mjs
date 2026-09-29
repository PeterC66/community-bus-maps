// Build public/guide.html — the customer guide on the public site — from
// docs/C1-customer-user-guide.md, which stays the one copy anybody edits.
//
// Run from the repository root (C:\Claude\community-bus-maps), no placeholders:
//     node scripts/build-guide.mjs            (says whether the page is stale, writes nothing; exit 1 if it is)
//     node scripts/build-guide.mjs --apply    (writes public/guide.html)
//     npm run guide:apply                     (the same, with --apply)
//
// WHY IT EXISTS (buses-data OA-337). C1 explained the service well and nothing
// carried it to a customer: no page, route or link on the site named it, so the
// only way to read it was to be sent it. docs/ does not ship in the image, and a
// hand-copied HTML page would be a second copy that drifts from the first on
// the next edit. So the page is GENERATED, and the default mode is a check that
// runs as a preflight of `npm test` — an edit to C1 without a rebuild goes red.
//
// WHAT IT UNDERSTANDS is the subset of Markdown C1 is written in, and it refuses
// anything else rather than printing it wrong: headings, paragraphs, one level
// of bulleted and numbered lists (a list item may carry indented follow-on
// paragraphs), block quotes, **bold**, *italic*, `code` and links. A link must
// be absolute, an anchor on this page, or into ../public/ — a link to another
// file under docs/ would 404 for every reader, so it is refused.
//
// THE STAMP IS LEFT OUT ON PURPOSE. The pre-commit docstamp rewrites C1's
// `<!-- docstamp … -->` comment and its `**vN.N** · updated …` line on every
// commit that touches it, AFTER this script ran. Rendering them would make the
// page stale the moment it was committed. The human-kept "Last reviewed" line
// is kept.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_HTML, FOOTER_HTML } from './lib/site-chrome.mjs';
import { confirm } from './lib/cli.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = path.join(ROOT, 'docs', 'C1-customer-user-guide.md');
export const TARGET = path.join(ROOT, 'public', 'guide.html');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's heading anchor, so an in-page link that works on GitHub works here. */
export function slug(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ /g, '-');
}

function href(target) {
  if (/^https?:\/\//.test(target) || target.startsWith('#')) return target;
  const m = /^\.\.\/public\/([^#]+)(#.*)?$/.exec(target);
  if (m) return `/${m[1]}${m[2] || ''}`;
  throw new Error(`a link to "${target}" would not resolve on the public site — use an absolute URL, an anchor, or a path under ../public/`);
}

/** Inline Markdown to HTML. Code spans are set aside first so nothing inside them is read as emphasis. */
export function inline(text, anchors) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  // Bold may hold an italic phrase, as C1's "**A row you answer disappears from *Not looked at yet* …**" does.
  s = s.replace(/\*\*((?:[^*]|\*[^*]+\*)+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, target) => {
    const url = href(target.replace(/&amp;/g, '&'));
    if (url.startsWith('#')) anchors.push(url.slice(1));
    return `<a href="${esc(url)}">${label}</a>`;
  });
  if (/[*`]/.test(s.replace(/\u0000\d+\u0000/g, ''))) throw new Error(`unbalanced emphasis or code in: ${text}`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** C1's Markdown to the page body. Returns { title, body }. */
export function render(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const ids = new Set();
  const anchors = [];
  let title = null;
  let list = null; // { tag, items: [[para, …]] }
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const quote = para[0].startsWith('> ');
    const text = para.map((l) => (quote ? l.replace(/^> ?/, '') : l)).join(' ');
    para = [];
    out.push(quote ? `      <blockquote><p>${inline(text, anchors)}</p></blockquote>` : `      <p>${inline(text, anchors)}</p>`);
  };
  const flushList = () => {
    if (!list) return;
    out.push(`      <${list.tag}>`);
    for (const item of list.items) {
      const [first, ...more] = item.map((p) => inline(p, anchors));
      out.push(more.length ? `        <li>${first}${more.map((p) => `<p>${p}</p>`).join('')}</li>` : `        <li>${first}</li>`);
    }
    out.push(`      </${list.tag}>`);
    list = null;
  };

  for (const line of lines) {
    if (/^<!--.*-->$/.test(line.trim())) continue;
    if (/^\*\*v\d+(\.\d+)*\*\* · updated /.test(line)) continue;
    let m;
    if ((m = /^# (.+)$/.exec(line))) {
      if (title) throw new Error('two top-level headings');
      title = m[1].replace(/\s*\(C1\)\s*$/, '');
      continue;
    }
    if ((m = /^(#{2,3}) (.+)$/.exec(line))) {
      flushPara(); flushList();
      const id = slug(m[2]);
      if (ids.has(id)) throw new Error(`two headings share the anchor #${id}`);
      ids.add(id);
      const tag = m[1].length === 2 ? 'h3' : 'h4';
      out.push(`      <${tag} id="${id}">${inline(m[2], anchors)}</${tag}>`);
      continue;
    }
    if (line.trim() === '') {
      // A blank line does not end a list: an indented paragraph may follow it.
      flushPara();
      if (list) list.blank = true;
      continue;
    }
    if ((m = /^(- |\d+\. )(.+)$/.exec(line))) {
      flushPara();
      const tag = m[1] === '- ' ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push([m[2]]);
      list.blank = false;
      continue;
    }
    if (list && /^ {2,3}\S/.test(line)) {
      // An indented line belongs to the last item: a follow-on paragraph when a
      // blank line came before it, otherwise the same paragraph wrapped.
      const item = list.items[list.items.length - 1];
      if (list.blank) item.push(line.trim()); else item[item.length - 1] += ` ${line.trim()}`;
      list.blank = false;
      continue;
    }
    if (/^\s/.test(line)) throw new Error(`an indented line outside a list: ${line.trim().slice(0, 60)}`);
    flushList();
    para.push(line);
  }
  flushPara(); flushList();

  if (!title) throw new Error('no top-level heading');
  for (const a of anchors) if (!ids.has(a)) throw new Error(`the link #${a} names no heading on the page`);
  return { title, body: out.join('\n') };
}

export function page(md) {
  const { title, body } = render(md);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Customer guide — BusMaps.uk</title>
  <meta name="description" content="How BusMaps.uk looks after an organisation's bus maps: what you tell us, what we send, how publishing and monthly updates work, and the editor for those who want it.">
  <link rel="canonical" href="https://busmaps.uk/guide.html">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚌</text></svg>">
  <link rel="stylesheet" href="/css/styles.css">
  <!-- PILOT: pilot banner + title marker. Delete with docs/PILOT.md. -->
  <script src="/js/csrf.js"></script>
  <script src="/js/site-banner.js" defer></script>
  <script src="/js/nav-current.js" defer></script>
  <script src="/js/auth-status.js" defer></script>
</head>
<body>
  <!-- GENERATED from docs/C1-customer-user-guide.md by scripts/build-guide.mjs. Edit C1 and run npm run guide:apply; an edit here is overwritten. -->
  <!-- nav:start -->
${NAV_HTML}
  <!-- nav:end -->

  <main id="main" tabindex="-1">
    <section><div class="container" style="max-width:760px">
      <h2 class="mt-0">${inline(title, [])}</h2>
${body}
    </div></section>
  </main>

  <!-- footer:start -->
${FOOTER_HTML}
  <!-- footer:end -->

  <script src="/js/app.js"></script>
</body>
</html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { apply } = confirm('local');
  let want;
  try {
    want = page(readFileSync(SOURCE, 'utf8'));
  } catch (e) {
    console.error(`build-guide: docs/C1-customer-user-guide.md cannot be rendered — ${e.message}`);
    process.exit(1);
  }
  let have = null;
  try { have = readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n'); } catch { /* not built yet */ }
  if (have === want) {
    console.log('build-guide: public/guide.html matches docs/C1-customer-user-guide.md.');
  } else if (apply) {
    writeFileSync(TARGET, want);
    console.log('build-guide: wrote public/guide.html from docs/C1-customer-user-guide.md.');
  } else {
    console.error(`build-guide: public/guide.html is ${have === null ? 'missing' : 'stale'} — docs/C1-customer-user-guide.md changed without a rebuild.`);
    console.error('  Rebuild it, from the repository root: npm run guide:apply');
    process.exit(1);
  }
}
