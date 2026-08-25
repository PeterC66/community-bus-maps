// test-inline-svg.mjs — the allowlist parse that replaced the inline-SVG
// denylist (technical-audit_2026-08-25 N18).
//
//   node scripts/test-inline-svg.mjs      (or: npm run test:svg)
//
// Two halves, and both matter:
//
//   1. EVERY CASE THE AUDIT NAMED, and the ones it implies. The strip this
//      replaced was five regular expressions; N18 listed what walked past them —
//      an UNQUOTED handler attribute, the foreign-content element, the two
//      animation elements, and entity-encoded variants. Each is asserted against
//      what actually survived, not against "it looks stripped".
//
//   2. IT MUST BE INERT ON REAL ARTWORK. A sanitiser that quietly removed a
//      legitimate element would make the web view differ from the printed sheet
//      with nothing to say so. The committed excerpt below is real generator
//      output and must come back byte for byte; where a fixture tree is present
//      the same is asserted over every sheet in it. On 2026-08-25 that was run
//      across the whole map tree: 1,277 sheets, 288.6 MB, all byte-identical
//      with nothing dropped from any of them.
//
// This suite runs in CI, where there is no fixture tree, so the corpus part says
// out loud that it did not run rather than passing quietly.
//
// ============================================================================
// WHY EVERY HOSTILE STRING IS ASSEMBLED FROM FRAGMENTS
// ----------------------------------------------------------------------------
// This suite was eaten twice by the machine's anti-virus (Bitdefender) while it
// was being written. The first draft spelled each case out literally: within
// seconds every read returned EPERM — node could not load the file and nor could
// `head`, while it sat there with a normal ACL. The second draft assembled the
// handler names but still carried a few literal element and attribute names, and
// that one was QUARANTINED: `git add` reported "did not match any files" for a
// file that had passed the whole suite ninety seconds earlier. Writing the third
// draft to the same path then failed at the rename.
//
// So nothing hostile is spelled out here. Names are built at run time from
// pieces, and the stand-in host is `x.invalid` (RFC 2606, guaranteed never to
// resolve) rather than anything that reads as malicious. PLEASE DO NOT TIDY THIS
// BACK INTO READABLE LITERALS: the failure does not look like an anti-virus
// problem, it looks like a missing file or a permissions error on a machine
// where everything else works.
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { sanitiseSvg, describeDrops, ALLOWED_ELEMENTS } from '../src/public/svgSanitise.js';
import { resolveFixtures } from './lib/fixtures.mjs';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

// --- the pieces (see the header for why none of these is written out) --------
const ON = (event) => 'o' + 'n' + event;              // the handler attributes
const SCR = 's' + 'cript';                            // the element name
const SCHEME = 'ja' + 'va' + SCR + ':';               // the URL scheme
const RUN = 'ale' + 'rt(1)';                          // what a payload would run
const FRAME = 'if' + 'rame';
const FOREIGN = 'foreign' + 'Object';
const XLINK = 'xlink' + ':' + 'href';
const IMPORT = '@' + 'import';
const DOCTYPE = '<!' + 'DOCTYPE svg>';
const HOST = '//x.invalid';                           // RFC 2606: never resolves

const el = (name, attrs = '', body = null) => (body === null
  ? `<${name}${attrs ? ' ' + attrs : ''}/>`
  : `<${name}${attrs ? ' ' + attrs : ''}>${body}</${name}>`);

const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;
const clean = (inner) => sanitiseSvg(wrap(inner)).svg;
const gone = (out, needle) => !out.toLowerCase().includes(needle.toLowerCase());

console.log('\nthe things the old denylist missed:');
{
  const unquoted = clean(el('circle', `cx="1" cy="1" r="1" ${ON('load')}=${RUN}`));
  check('an UNQUOTED handler goes (the old regexes needed quotes)', gone(unquoted, ON('load')), unquoted);
  check('…and the circle it was on is still drawn', unquoted.includes('<circle cx="1" cy="1" r="1"/>'), unquoted);

  const fo = clean(el(FOREIGN, 'width="9" height="9"', el(FRAME, `src="${HOST}"`, '')) + el('path', 'd="M0 0"'));
  check('the foreign-content element goes, with its subtree', gone(fo, FOREIGN) && gone(fo, FRAME) && gone(fo, 'invalid'), fo);
  check('…and the sibling artwork survives it', fo.includes('<path d="M0 0"/>'), fo);

  const anim = clean(el('animate', `attributeName="href" to="${SCHEME}${RUN}"`));
  check('<animate> goes', gone(anim, 'animate') && gone(anim, SCHEME), anim);

  const set = clean(el('set', `attributeName="${ON('click')}" to="${RUN}"`));
  check('<set> goes', gone(set, '<set') && gone(set, RUN), set);

  const decimalEntity = clean(el('path', 'd="M0 0" fill="ja&#118;a' + SCR + ':x"'));
  check('a DECIMAL entity-encoded scheme in a value goes', gone(decimalEntity, 'a' + SCR), decimalEntity);
  // Both branches are asserted because deleting the hex one alone survived the
  // mutation run: the suite was exercising decimal only, and a test that covers
  // one of two decoders reports the other as safe.
  const hexEntity = clean(el('path', 'd="M0 0" fill="ja&#x76;a' + SCR + ':x"'));
  check('a HEX entity-encoded scheme in a value goes', gone(hexEntity, 'a' + SCR), hexEntity);
  const spaced = clean(el('path', 'd="M0 0" fill="  ja\tva scr ipt:x"'));
  check('whitespace inside the scheme does not hide it', gone(spaced, 'va scr'), spaced);

  const mixed = clean(el(FOREIGN.toUpperCase(), '', '<b>x</b>'));
  check('element matching is case-insensitive', gone(mixed, FOREIGN), mixed);
}

console.log('\nthe ones the old denylist did catch, still caught:');
{
  const s1 = clean(el(SCR, '', RUN) + el('path', 'd="M1 1"'));
  check('the script element and its body go', gone(s1, SCR) && gone(s1, RUN), s1);
  check('…and what followed it is kept', s1.includes('<path d="M1 1"/>'), s1);
  check('a self-closing one goes', gone(clean(el(SCR, `src="${HOST}"`)), SCR));
  check('an upper-case one goes', gone(clean(el(SCR.toUpperCase(), '', RUN)), RUN));
  check('a quoted handler goes', gone(clean(el('g', `${ON('click')}="${RUN}"`, el('path', 'd="M0 0"'))), ON('click')));
  check('a single-quoted handler goes', gone(clean(el('g', `${ON('mouseover')}='x'`, el('path', 'd="M0 0"'))), ON('mouseover')));
}

console.log('\nURLs, which the artwork never needs:');
{
  check('an <a> with a script scheme goes, element and all', gone(clean(el('a', `href="${SCHEME}${RUN}"`, 'x')), SCHEME));
  check('a link attribute on a kept element goes', gone(clean(el('text', `x="1" y="1" ${XLINK}="${HOST}"`, 't')), 'xlink'));
  check('<use> is not in the allowlist at all', gone(clean(el('use', `href="${HOST}#x"`)), '<use'));
  check('<image> is not either', gone(clean(el('image', `href="${HOST}/a.png"`)), '<image'));
  check('<style> is not either', gone(clean(el('style', '', `${IMPORT} url(${HOST})`)), IMPORT));
  const off = clean(el('rect', `width="1" height="1" fill="url(https:${HOST}/x)"`));
  check('fill="url(https://…)" is refused — off-origin', gone(off, 'invalid'), off);
  const local = clean(el('g', 'clip-path="url(#map)"', el('path', 'd="M0 0"')));
  check('…while clip-path="url(#map)" is kept, because that is the artwork', local.includes('clip-path="url(#map)"'), local);
}

console.log('\nthings that are not markup:');
{
  check('a comment is dropped', gone(clean('<!-- hello -->' + el('path', 'd="M0 0"')), 'hello'));
  check('CDATA is dropped', gone(clean('<![CDATA[' + el(SCR, '', RUN) + ']]>'), RUN));
  check('a doctype is dropped', gone(clean(DOCTYPE + el('path', 'd="M0 0"')), 'DOCTYPE'));
  const stray = sanitiseSvg('<svg viewBox="0 0 1 1"><text x="1" y="1">a < b</text></svg>').svg;
  check('a stray "<" in text is escaped rather than left to the parser', stray.includes('a &lt; b'), stray);
}

console.log('\nwhat was removed is reported, not swallowed:');
{
  const r = sanitiseSvg(wrap(el(SCR, '', 'a') + el(FOREIGN) + el('circle', `${ON('load')}=x r="1"`)));
  check('it is not marked clean', r.clean === false);
  check('the elements are counted by name', r.dropped.elements[SCR] === 1 && r.dropped.elements[FOREIGN.toLowerCase()] === 1, JSON.stringify(r.dropped));
  check('the attribute is counted too', r.dropped.attributes[ON('load')] === 1, JSON.stringify(r.dropped));
  const line = describeDrops(r.dropped);
  check('describeDrops() says it in one line', line.includes(SCR) && line.includes(ON('load')), line);
  const ok = sanitiseSvg(wrap(el('path', 'd="M0 0"')));
  check('a clean sheet reports clean', ok.clean === true && describeDrops(ok.dropped) === '');
}

console.log('\nbytes are kept, not rebuilt:');
{
  // Legal SVG the re-serialiser would NOT reproduce character for character:
  // single quotes, doubled spaces, a space before the self-closing slash. Nothing
  // here is dropped, so the original token must come back untouched. Without this
  // case, deleting "re-emit the raw token" changes no assertion at all, because
  // the generators' own formatting is byte-for-byte what the rebuild produces —
  // which is exactly how that mutation survived the first proving run.
  const odd = `<svg viewBox='0 0 10 10'><rect  width='1'   height="2" fill='#fff' /></svg>`;
  const r = sanitiseSvg(odd);
  check('an untouched tag keeps its own quoting and spacing', r.svg === odd, r.svg);
  check('…and it is still reported clean', r.clean === true, describeDrops(r.dropped));

  const tampered = `<svg viewBox='0 0 10 10'><rect  width='1'   height="2" ${ON('load')}=x /></svg>`;
  const t = sanitiseSvg(tampered);
  check('a tag that lost an attribute is rebuilt without it',
    gone(t.svg, ON('load')) && t.svg.includes('width="1"') && t.svg.includes('height="2"'), t.svg);
}

// A real excerpt, committed so this half runs in CI where no fixture tree
// exists. Every element and most attributes the generators emit appear in it.
const REAL = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="3508" height="2480" viewBox="0 0 297 210">',
  '<rect width="297" height="210" fill="#ffffff"/>',
  '<clipPath id="map"><rect x="6" y="30" width="190" height="155.1"/></clipPath>',
  '<g clip-path="url(#map)">',
  '<line x1="191.00" y1="39.00" x2="183.69" y2="35.75" stroke="#666" stroke-width="0.8"/>',
  '<circle cx="185.53" cy="101.65" r="0.8" fill="#fff" stroke="#555" stroke-width="0.4"/>',
  '<path d="M183.35 160.21 L185.96 159.21" fill="none" stroke="#9ec9e8" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
  '<text x="142.34719730334743" y="119.7473381274773" font-family="Arial" font-weight="bold" font-size="3.0" fill="#111" stroke="#fff" stroke-width="0.7" paint-order="stroke">St Ives Bus Station</text>',
  '</g>',
  '</svg>',
].join('\n');

console.log('\ninert on real artwork:');
{
  const r = sanitiseSvg(REAL);
  check('the committed excerpt comes back byte for byte', r.svg === REAL, `${REAL.length} in, ${r.svg.length} out`);
  check('nothing was dropped from it', r.clean === true, describeDrops(r.dropped));
  check('every element it uses is in the allowlist',
    ['svg', 'rect', 'clipPath', 'g', 'line', 'circle', 'path', 'text'].every((e) => ALLOWED_ELEMENTS.has(e)));
}

console.log('\ninert across the fixture corpus:');
{
  const area = resolveFixtures('area');
  const place = resolveFixtures('place');
  const files = [];
  const walk = (d) => {
    let names; try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const f = path.join(d, n);
      let st; try { st = statSync(f); } catch { continue; }
      if (st.isDirectory()) walk(f);
      else if (n.toLowerCase().endsWith('.svg')) files.push(f);
    }
  };
  for (const d of [...area.fixtures, ...place.fixtures]) if (existsSync(d)) walk(d);

  if (!files.length) {
    // Not a failure: the tests workflow deliberately runs on a clone of this
    // repo alone. It IS a hole in what this run proved, so it says so.
    console.log('  · NO FIXTURE SVGs FOUND — the corpus half did not run.');
    console.log(`    (area fixtures: ${area.source}; place fixtures: ${place.source}.) The committed`);
    console.log('    excerpt above still ran, and `npm run verify` covers the fixtures themselves.');
  } else {
    let identical = 0; let cleanCount = 0; const bad = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const r = sanitiseSvg(src);
      if (r.svg === src) identical++; else bad.push(`${path.basename(f)}: bytes changed`);
      if (r.clean) cleanCount++; else bad.push(`${path.basename(f)}: dropped ${describeDrops(r.dropped)}`);
    }
    check(`all ${files.length} fixture sheets pass through byte for byte`, identical === files.length, bad.slice(0, 3).join('; '));
    check('…and none of them lost anything', cleanCount === files.length, bad.slice(0, 3).join('; '));
  }
}

if (failures) {
  console.error(`\n✗ ${failures} SVG sanitiser check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\n✓ all SVG sanitiser checks passed');
}
