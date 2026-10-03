#!/usr/bin/env node
// THE MAP-DESCRIPTION PANEL SAYS WHEN IT IS NOT SAVED (buses-data OA-550).
//
//   node scripts/test-description-unsaved.mjs     (or: npm run test:description-unsaved)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`); no arguments.
//
// WHY IT EXISTS. The description panel on a map's editor page had a Save button
// that was always enabled, no unload guard, and reported through the page-top
// notice, far above the panel. editor.js is too large to load whole without a map
// and a basemap, so this runs only the panel's own block, cut from the source
// between its two section comments, in a vm behind a small fake DOM and a stubbed
// fetch. Each behaviour is then removed from a copy and the copy must fail.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(path.join(ROOT, 'public', 'app', 'editor.js'), 'utf8');
const START = "// ---- the map's own description";
const END = '// ---- "changes coming" banner';
const block = (s) => { const a = s.indexOf(START), b = s.indexOf(END); return a < 0 || b < a ? '' : s.slice(a, b); };

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

class El {
  constructor() { this.value = ''; this.disabled = false; this.textContent = ''; this.title = ''; this.listeners = {}; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  async fire(t) { for (const fn of this.listeners[t] || []) await fn({ type: t, preventDefault() {} }); }
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// Runs one copy of the block; `reply` is what the PATCH answers.
async function run(code, reply = { status: 200, body: (d) => ({ ok: true, description: d }) }) {
  const els = {}; const el = (id) => (els[id] ||= new El());
  const win = {}; const notices = []; const sent = [];
  const ctx = vm.createContext({
    $: el, MAP_ID: 7, detail: { description: 'Saved sentence.' },
    notice: (k, m) => notices.push([k, m]),
    window: { addEventListener: (t, fn) => { (win[t] ||= []).push(fn); } },
    fetch: async (url, opts) => {
      const d = JSON.parse(opts.body).description; sent.push(d);
      if (reply.throws) throw new Error('offline');
      return { ok: reply.status < 400, json: async () => reply.body(d) };
    },
  });
  vm.runInContext(`${code}\nthis.api = { buildDescription, descriptionDirty };`, ctx);
  const leave = () => { let prevented = false; for (const fn of win.beforeunload || []) fn({ preventDefault() { prevented = true; } }); return prevented; };
  return { els, ctx, notices, sent, leave, type: async (v) => { el('descriptionText').value = v; await el('descriptionText').fire('input'); } };
}

async function behaviour(code) {
  const out = {};
  const p = await run(code);
  p.ctx.api.buildDescription();
  const save = p.els.descriptionSaveBtn, clear = p.els.descriptionClearBtn, count = p.els.descriptionCount;
  out['a freshly loaded panel has Save disabled and says what is saved'] = save.disabled === true && /Saved/.test(count.textContent);
  out['a clean panel does not guard against leaving'] = p.leave() === false;
  await p.type('A different sentence.');
  out['typing enables Save and says Not saved yet beside it'] = save.disabled === false && /Not saved yet/.test(count.textContent);
  out['a dirty panel guards against leaving'] = p.leave() === true;
  await p.type('Saved sentence.');
  out['typing it back to the saved value puts Save back to disabled'] = save.disabled === true;
  await p.type('A different sentence.');
  await save.fire('click'); await settle();
  out['a good save sends the text and reads Saved in the panel'] = p.sent[0] === 'A different sentence.' && /Saved/.test(count.textContent) && !/Not saved/.test(count.textContent);
  out['and the panel is clean again, so it lets the page go'] = save.disabled === true && p.leave() === false;
  await clear.fire('click'); await settle();
  out['Clear sends an empty description and the panel reads Cleared'] = p.sent[1] === '' && /Cleared/.test(count.textContent) && clear.disabled === true;

  const f = await run(code, { status: 400, body: () => ({ ok: false, error: 'no' }) });
  f.ctx.api.buildDescription();
  await f.type('Will not save.');
  await f.els.descriptionSaveBtn.fire('click'); await settle();
  out['a failed save says so in the panel and stays dirty and guarded'] = /try again/.test(f.els.descriptionCount.textContent) && f.els.descriptionSaveBtn.disabled === false && f.leave() === true;
  const n = await run(code, { throws: true });
  n.ctx.api.buildDescription();
  await n.type('Offline.');
  await n.els.descriptionSaveBtn.fire('click'); await settle();
  out['a network error is the same'] = /try again/.test(n.els.descriptionCount.textContent) && n.leave() === true;
  return out;
}

console.log('the description panel');
const real = block(SRC);
check('the panel block is found in editor.js', real.length > 200);
if (real) for (const [name, ok] of Object.entries(await behaviour(real))) check(name, ok);

console.log('\nand the checks have been seen to refuse a broken panel');
const breaks = [
  ['Save never disabled', 'disabled = descriptionSaving || !dirty;', 'disabled = descriptionSaving;'],
  ['no state word in the panel', "$('descriptionCount').textContent = state;", ''],
  ['no unload guard', 'if (descriptionDirty()) { e.preventDefault()', 'if (false) { e.preventDefault()'],
  ['no failed state', "descriptionFailed = true; notice('err', (b && b.error)", "notice('err', (b && b.error)"],
  ['input never repaints', "$('descriptionText').addEventListener('input', () => { descriptionFailed = false; paintDescription(); });", ''],
];
for (const [name, from, to] of breaks) {
  if (!real.includes(from)) { check(`the break "${name}" still applies to the source`, false); continue; }
  let red;
  try { red = Object.values(await behaviour(real.replace(from, to))).some((ok) => !ok); } catch { red = true; }
  check(`goes red with ${name}`, red);
}

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('all checks passed');
