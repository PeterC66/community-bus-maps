#!/usr/bin/env node
// THE PUBLIC-DETAILS PAGE AND THE LANDMARK CHOOSER SAY WHEN SOMETHING IS NOT SAVED
// (buses-data OA-363, items 1 and 2).
//
//   node scripts/test-branding-unsaved-edits.mjs     (or: npm run test:branding-unsaved-edits)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`); it takes no
// arguments.
//
// WHY IT EXISTS. The admin console's grids learned to say when a row had unsaved
// changes (test-admin-unsaved-edits.mjs). The customer's own "Public details"
// page did not: both of its panels had a Save button that was always enabled and
// no unload guard, so a new public name could be typed and walked away from in
// silence. The landmark chooser already said "Not saved yet" but, unlike
// editor.js and diagram.js, still let a reload or a closed tab discard the
// answers.
//
// TWO HALVES. The BEHAVIOUR half runs the real branding.js in a vm context behind
// a small fake DOM and a stubbed fetch — no browser, nothing to install — and
// drives it through load, edit, revert, a failed save and a good save. The WIRING
// half reads landmarks.js as text for its unload guard, because that page's
// behaviour needs a map and a basemap to reach. Each half is then run against
// deliberately broken copies, and every copy must fail.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BRANDING = path.join(ROOT, 'public', 'app', 'branding.js');
const LANDMARKS = path.join(ROOT, 'public', 'app', 'landmarks.js');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

// ---- a fake DOM that answers only what branding.js asks ----------------------
class El {
  constructor(id) {
    this.id = id; this.value = ''; this.checked = false; this.disabled = false; this.textContent = '';
    this.innerHTML = ''; this.className = ''; this.href = ''; this.title = ''; this.style = {}; this.dataset = {};
    this.listeners = {};
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  async fire(type, ev = {}) { for (const fn of this.listeners[type] || []) await fn({ type, preventDefault() {}, ...ev }); }
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const json = (status, body) => ({ status, ok: status < 400, json: async () => body });

// Loads branding.js as the browser would. `patch` answers the two PATCH calls.
async function page(src, patch = { details: 'ok', settings: 'ok' }) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); };
  const winListeners = {};
  const fetch = async (url, opts = {}) => {
    if (url === '/api/me') return json(200, { user: { email: 'clerk@example.org', customer: { name: 'Test Town Council' } } });
    if (url === '/api/customer/branding' && !opts.method) {
      return json(200, {
        ok: true, branding: { publicName: 'Test Town', accent: 'blue' },
        accents: [{ key: 'blue', label: 'Blue', hex: '#1b4db3' }, { key: 'green', label: 'Green', hex: '#1b7a3a' }],
        customer: { name: 'Test Town Council', watermarkEnabled: true, publicUrl: '' }, preview: { accent: 'blue' }, publicMaps: [],
      });
    }
    if (url === '/api/customer/branding') {
      if (patch.details !== 'ok') return json(400, { ok: false, error: 'no' });
      const sent = JSON.parse(opts.body).branding;
      return json(200, { ok: true, branding: sent, preview: { accent: sent.accent || 'blue' }, rejected: [] });
    }
    if (url === '/api/customer/settings') {
      if (patch.settings !== 'ok') return json(400, { ok: false, error: 'no' });
      return json(200, { ok: true, watermarkEnabled: JSON.parse(opts.body).watermarkEnabled });
    }
    throw new Error(`the stub was asked a URL it does not know: ${url}`);
  };
  const ctx = vm.createContext({
    document: { getElementById: el, querySelector: () => el('.editor') },
    window: { addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); } },
    location: { href: '' }, fetch, JSON, setImmediate,
  });
  const beforeLoad = { saveDisabled: null };
  new vm.Script(src, { filename: 'branding.js' }).runInContext(ctx);
  beforeLoad.saveDisabled = el('saveBtn').disabled;
  await settle();
  // Would the browser ask before leaving? True when the handler called preventDefault.
  const asks = () => { let asked = false; for (const fn of winListeners.beforeunload || []) fn({ preventDefault() { asked = true; }, set returnValue(v) {} }); return asked; };
  return { el, asks, beforeLoad };
}

async function behaviour(src) {
  const out = {};
  const p = await page(src);
  const { el } = p;
  out['before the server answers, Save is disabled'] = p.beforeLoad.saveDisabled === true;
  out['once loaded, both Saves are disabled'] = el('saveBtn').disabled === true && el('settingsSaveBtn').disabled === true;
  out['once loaded, leaving does not ask'] = p.asks() === false;

  el('publicName').value = 'Test Town Council'; await el('publicName').fire('input');
  out['typing a new public name enables its Save'] = el('saveBtn').disabled === false;
  out['typing a new public name does not enable the other panel\'s Save'] = el('settingsSaveBtn').disabled === true;
  out['an unsaved public name makes leaving ask'] = p.asks() === true;

  el('publicName').value = 'Test Town'; await el('publicName').fire('input');
  out['putting the name back disables Save and leaving no longer asks'] = el('saveBtn').disabled === true && p.asks() === false;

  el('watermarkFree').checked = !el('watermarkFree').checked; await el('watermarkFree').fire('change');
  out['ticking the download setting enables its Save'] = el('settingsSaveBtn').disabled === false;
  out['an unsaved download setting makes leaving ask'] = p.asks() === true;

  await el('settingsSaveBtn').fire('click'); await settle();
  out['saving the download setting disables its Save and leaving no longer asks'] = el('settingsSaveBtn').disabled === true && p.asks() === false;

  el('blurb').value = 'Serving the town'; await el('blurb').fire('input');
  await el('brandForm').fire('submit'); await settle();
  out['a good save disables Save and leaving no longer asks'] = el('saveBtn').disabled === true && p.asks() === false;

  const q = await page(src, { details: 'refused', settings: 'refused' });
  q.el('website').value = 'example.org'; await q.el('website').fire('input');
  await q.el('brandForm').fire('submit'); await settle();
  out['a refused save leaves Save enabled and leaving still asks'] = q.el('saveBtn').disabled === false && q.asks() === true;
  q.el('watermarkFree').checked = !q.el('watermarkFree').checked; await q.el('watermarkFree').fire('change');
  await q.el('settingsSaveBtn').fire('click'); await settle();
  out['a refused setting save leaves its Save enabled'] = q.el('settingsSaveBtn').disabled === false;
  return out;
}

const landmarkGuard = (text) => /addEventListener\('beforeunload'[^\n]*BASE !== null && dirty\(\)[^\n]*preventDefault\(\)/.test(text);

const src = readFileSync(BRANDING, 'utf8');
const lm = readFileSync(LANDMARKS, 'utf8');

console.log('\nPublic details: each panel says when it has changes that are not saved');
const real = await behaviour(src);
for (const [name, ok] of Object.entries(real)) check(name, ok);

console.log('\nthe landmark chooser asks before a reload or a close throws its answers away');
check('landmarks.js guards the unload on dirty(), and only once the map has loaded', landmarkGuard(lm));

console.log('\nand the checks have been seen to refuse a broken page');
const MUTANTS = [
  ['a form whose saved state is never recorded, so no edit ever counts', ["  savedDetails = detailsNow();\n  paintSaveState();\n}", '  paintSaveState();\n}']],
  ['no unload guard — the fault this was filed for', ["window.addEventListener('beforeunload', (e) => { if (detailsDirty() || settingsDirty()) { e.preventDefault(); e.returnValue = ''; } });", '']],
  ['a download setting that never counts as changed', ["const settingsDirty = () => savedWatermarkFree !== null && $('watermarkFree').checked !== savedWatermarkFree;", 'const settingsDirty = () => false;']],
  ['a Save left enabled on a clean panel', ['    btn.disabled = !dirty;', '    btn.disabled = false;']],
  ['a setting save that does not record the new value', ["      savedWatermarkFree = $('watermarkFree').checked;\n      settingsNote('ok', 'Saved.');", "      settingsNote('ok', 'Saved.');"]],
  ['a refused save that leaves Save disabled', ["  finally { delete btn.dataset.busy; btn.textContent = 'Save public details'; paintSaveState(); }", "  finally { delete btn.dataset.busy; btn.textContent = 'Save public details'; }"]],
];
for (const [name, [from, to]] of MUTANTS) {
  if (!src.includes(from)) { check(`mutant "${name}" still applies to branding.js`, false, 'the text it replaces is gone — update the mutant'); continue; }
  let red;
  try { red = Object.values(await behaviour(src.replace(from, to))).some((ok) => !ok); } catch { red = true; }
  check(`goes red on ${name}`, red);
}
const lmFrom = "window.addEventListener('beforeunload', (e) => { if (BASE !== null && dirty()) { e.preventDefault(); e.returnValue = ''; } });";
if (!lm.includes(lmFrom)) check('the landmark mutant still applies to landmarks.js', false, 'the text it replaces is gone — update the mutant');
else check('goes red on a landmark chooser with no unload guard', !landmarkGuard(lm.replace(lmFrom, '')));

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('Public details and the landmark chooser say when something is not saved, and cannot be left silently.');
