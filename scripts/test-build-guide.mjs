// test-build-guide.mjs — public/guide.html is C1, and build-guide.mjs's check
// goes red when it is not (buses-data OA-337).
//
//   node scripts/test-build-guide.mjs   (or: npm run test:guide)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). It takes no
// arguments and there are no placeholders. It writes nothing: every case renders
// in memory and compares against the committed page.
//
// THE CASES THAT MATTER ARE THE TWO EDITS. An edit to C1's prose must change the
// page, or the preflight could never go red; an edit to C1's docstamp must NOT,
// or every commit that touches C1 would leave the page stale behind it, because
// the pre-commit hook rewrites the stamp after the page was built.
import { readFileSync } from 'node:fs';
import { SOURCE, TARGET, page, render, slug } from './build-guide.mjs';

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};
const refuses = (md) => { try { render(md); return false; } catch { return true; } };

const md = readFileSync(SOURCE, 'utf8');
const committed = readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n');

console.log('the committed page is C1');
check('page(C1) equals public/guide.html', page(md) === committed);

console.log('\nan edit to the prose goes red, an edit to the stamp does not');
check('a changed word changes the page', page(md.replace('Welcome.', 'Hello.')) !== committed);
check('a restamped C1 renders the same page',
  page(md.replace(/<!-- docstamp [^>]*-->/, '<!-- docstamp v9.99 | 2099-01-01 | sha=00000000 -->')
    .replace(/^\*\*v[\d.]+\*\* · updated .*$/m, '**v9.99** · updated 1 January 2099')) === committed);

console.log('\nwhat it refuses rather than printing wrong');
check('a link to another file under docs/', refuses('# T\n\nSee [R3](R3-review-and-publish.md).\n'));
check('an anchor that names no heading', refuses('# T\n\n## One\n\nSee [two](#two).\n'));
check('unbalanced emphasis', refuses('# T\n\nThis is *half open.\n'));
check('no title', refuses('## Only a section\n\nText.\n'));

console.log('\nwhat it renders');
check('headings get GitHub anchors', slug('Publishing (getting it checked and made official)') === 'publishing-getting-it-checked-and-made-official');
check('a ../public/ link becomes a site path', render('# T\n\nSee [the FAQ](../public/faq.html).\n').body.includes('href="/faq.html"'));
check('an indented paragraph after a blank line stays in its list item',
  /<li>one<p>more<\/p><\/li>/.test(render('# T\n\n- one\n\n  more\n- two\n').body));
check('italic inside bold', render('# T\n\n**a *b* c**\n').body.includes('<strong>a <em>b</em> c</strong>'));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
