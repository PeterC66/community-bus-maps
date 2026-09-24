#!/usr/bin/env node
// THE ADMIN CONSOLE SAYS WHEN A ROW HAS CHANGES THAT ARE NOT SAVED (buses-data OA-363).
//
//   node scripts/test-admin-unsaved-edits.mjs     (or: npm run test:admin-unsaved-edits)
//
// Run it from the repository root (`C:\Claude\community-bus-maps`); it takes no
// arguments.
//
// WHY IT EXISTS. Peter unticked `Sample maps` on the first real customer, found
// nothing forcing a save, and asked why he could leave without one. The Customers
// and Users grids had no dirty state at all; a tab switch or a re-render put the
// database's value back without a word. `public/app/unsaved-edits.js` is the fix,
// and this file is what says it still works.
//
// TWO HALVES. The BEHAVIOUR half loads the real module into a vm context and drives
// it through a small fake DOM — no browser, no jsdom, nothing to install — because
// the module only ever asks an element for `querySelectorAll`, `dataset`,
// `classList` and a control's value. The WIRING half reads admin.js and the admin
// shell as text, because a module nothing calls fixes nothing: the tab guard, the
// beforeunload guard, the redraw hook and the two row keys are each asked for.
//
// AND IT CARRIES ITS OWN CONTROLS. The behaviour assertions are run a second time
// against deliberately broken copies of the module, and each copy must fail at
// least one of them — the most important being a `carry` that returns nothing,
// which is exactly the silent discard this action was filed for.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODULE = path.join(ROOT, 'public', 'app', 'unsaved-edits.js');
const ADMIN = path.join(ROOT, 'public', 'app', 'admin.js');
const SHELL = path.join(ROOT, 'views', 'app', 'admin.html');

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

// ---- a fake DOM that answers only what the module asks ----------------------
class El {
  constructor(tag, opts = {}) {
    this.tag = tag; this.type = opts.type || ''; this.value = opts.value ?? ''; this.checked = !!opts.checked;
    this.disabled = !!opts.disabled; this.dataset = { ...(opts.dataset || {}) }; this.children = []; this.title = '';
    const cls = new Set(opts.classes || []);
    this.classList = { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); }, contains: (c) => cls.has(c) };
    this.listeners = {};
  }
  append(...kids) { kids.forEach((k) => { k.parent = this; }); this.children.push(...kids); return this; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) {
    const test = {
      '[data-q]': (e) => 'q' in e.dataset,
      '.gt-row[data-edit-key]': (e) => e.classList.contains('gt-row') && 'editKey' in e.dataset,
      'button[data-save]': (e) => e.tag === 'button' && 'save' in e.dataset,
    }[sel];
    if (!test) throw new Error(`the fake DOM was asked a selector it does not know: ${sel}`);
    return this.all().filter(test);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // Bubbles, as input and change do in a browser: the module listens on the ROW.
  fire(type) { for (let el = this; el; el = el.parent) (el.listeners[type] || []).forEach((fn) => fn({ type })); }
}

// One Customers-shaped row: a number, a select, a text box, two checkboxes, Save.
function customerRow(id, v) {
  const row = new El('div', { classes: ['gt-row'], dataset: { editKey: `cust-${id}` } });
  const c = {
    areas: new El('input', { type: 'number', value: String(v.areas), dataset: { q: 'areas' } }),
    status: new El('select', { value: v.status, dataset: { q: 'status' } }),
    plan: new El('input', { type: 'text', value: v.plan, dataset: { q: 'plan' } }),
    watermark: new El('input', { type: 'checkbox', checked: v.watermark, dataset: { q: 'watermark' } }),
    isSample: new El('input', { type: 'checkbox', checked: v.isSample, dataset: { q: 'isSample' } }),
  };
  const save = new El('button', { classes: ['btn', 'btn-ghost'], dataset: { save: String(id) } });
  row.append(...Object.values(c), save);
  return { row, c, save };
}
const serverRows = () => [
  { id: 1, areas: 3, status: 'active', plan: 'pilot', watermark: true, isSample: true },
  { id: 2, areas: 1, status: 'active', plan: '', watermark: false, isSample: false },
];
function draw(rows) {
  const box = new El('div');
  const built = rows.map((r) => customerRow(r.id, r));
  box.append(...built.map((b) => b.row));
  return { box, rows: built };
}

function load(src) {
  const ctx = vm.createContext({});
  new vm.Script(src, { filename: 'unsaved-edits.js' }).runInContext(ctx);
  return ctx.UnsavedEdits;
}

// Every behaviour the module promises, as named booleans, so the same list can be
// asked of the real module and of each broken copy.
function behaviour(U) {
  const out = {};
  const g = draw(serverRows());
  U.arm(g.box);
  const [one, two] = g.rows;
  out['a freshly drawn row is clean and its Save is disabled'] = !one.row.classList.contains('dirty') && one.save.disabled === true;

  one.c.isSample.checked = false; one.c.isSample.fire('change');
  out['unticking a checkbox marks the row dirty and enables Save'] = one.row.classList.contains('dirty') && one.save.disabled === false;
  out['the dirty Save is the primary button'] = one.save.classList.contains('btn-primary') && !one.save.classList.contains('btn-ghost');
  out['the row beside it stays clean'] = !two.row.classList.contains('dirty') && two.save.disabled === true;
  out['the grid counts one unsaved row'] = U.count(g.box) === 1;

  one.c.isSample.checked = true; one.c.isSample.fire('change');
  out['putting the value back makes the row clean again'] = !one.row.classList.contains('dirty') && U.count(g.box) === 0;

  two.c.plan.value = 'paid'; two.c.plan.fire('input');
  out['typing in a text box marks the row dirty'] = two.row.classList.contains('dirty');

  // A redraw from the server — a column sort, or a reload after another save — in
  // which the server has meanwhile changed a control the operator did NOT touch.
  const carried = U.carry(g.box);
  const fresh = serverRows(); fresh[1].areas = 5;
  const h = draw(fresh);
  U.arm(h.box, carried);
  out['a redraw keeps the edit the operator had not saved'] = h.rows[1].c.plan.value === 'paid' && h.rows[1].row.classList.contains('dirty');
  out['a redraw shows the server value of a control the operator did not touch'] = h.rows[1].c.areas.value === '5';
  out['a redraw does not invent an edit on a clean row'] = !h.rows[0].row.classList.contains('dirty');

  U.markSaved(h.rows[1].row);
  out['a save makes the row clean at its new values'] = !h.rows[1].row.classList.contains('dirty') && h.rows[1].c.plan.value === 'paid' && U.count(h.box) === 0;

  h.rows[0].c.watermark.checked = false; h.rows[0].c.watermark.fire('change');
  h.rows[0].c.status.value = 'suspended'; h.rows[0].c.status.fire('change');
  U.revert(h.box);
  out['discarding puts a checkbox back to its starting value'] = h.rows[0].c.watermark.checked === true;
  out['discarding puts a select back to its starting value'] = h.rows[0].c.status.value === 'active';
  out['after discarding nothing is unsaved'] = U.count(h.box) === 0 && !h.rows[0].row.classList.contains('dirty');
  return out;
}

const src = readFileSync(MODULE, 'utf8');

console.log('\nthe module: a row says when it has changes that are not saved');
const real = behaviour(load(src));
for (const [name, ok] of Object.entries(real)) check(name, ok);

console.log('\nthe admin console calls it where it has to');
const admin = readFileSync(ADMIN, 'utf8');
const shell = readFileSync(SHELL, 'utf8');
const iMod = shell.indexOf('/app/unsaved-edits.js'), iAdmin = shell.indexOf('/app/admin.js');
check('the admin shell loads unsaved-edits.js, and before admin.js', iMod !== -1 && iAdmin !== -1 && iMod < iAdmin);
const render = admin.slice(admin.indexOf('function renderSortable('), admin.indexOf('async function jget('));
check('every grid redraw carries the unsaved edits across', /UnsavedEdits\.carry\(box\)[\s\S]*box\.innerHTML[\s\S]*UnsavedEdits\.arm\(box, carried\)/.test(render));
const tab = admin.slice(admin.indexOf('function showTab('), admin.indexOf('function showTab(') + 800);
check('leaving a tab asks when rows are unsaved, and discards them if told to', /UnsavedEdits\.count\(/.test(tab) && /confirm\(/.test(tab) && /UnsavedEdits\.revert\(/.test(tab));
check('a real unload is guarded too', /addEventListener\('beforeunload'[^\n]*UnsavedEdits\.count\(document\)/.test(admin));
check('a Customers row is tracked', /data-cust="\$\{c\.id\}" data-edit-key="cust-\$\{c\.id\}"/.test(admin));
check('a Users row is tracked', /data-user="\$\{u\.id\}" data-edit-key="user-\$\{u\.id\}"/.test(admin));
check('both saves mark their row saved', (admin.match(/UnsavedEdits\.markSaved\(tr\)/g) || []).length === 2);

console.log('\nand the behaviour checks have been seen to refuse a broken module');
const MUTANTS = [
  ['a redraw that discards the unsaved edit — the fault this was filed for', ['const kept = carried && carried[row.dataset.editKey];', 'const kept = null;']],
  ['a row that never goes dirty', ['const isDirty = (row) => controls(row).some(changed);', 'const isDirty = (row) => false;']],
  ['a Save button left enabled on a clean row', ['save.disabled = !dirty;', 'save.disabled = false;']],
  ['a discard that leaves the edit in place', ['controls(row).filter(changed).forEach((el) => setCtl(', 'controls(row).filter(() => false).forEach((el) => setCtl(']],
  ['a save that leaves the row dirty', ['controls(row).forEach((el) => { el.dataset.init = String(ctlVal(el)); });\n    refresh(row);\n  }', 'refresh(row);\n  }']],
  ['a checkbox compared as a boolean against its string starting value', ['const changed = (el) => String(ctlVal(el)) !== el.dataset.init;', 'const changed = (el) => ctlVal(el) !== el.dataset.init;']],
];
for (const [name, [from, to]] of MUTANTS) {
  if (!src.includes(from)) { check(`mutant "${name}" still applies to the module`, false, 'the text it replaces is gone — update the mutant'); continue; }
  let red;
  try { red = Object.values(behaviour(load(src.replace(from, to)))).some((ok) => !ok); } catch { red = true; }
  check(`goes red on ${name}`, red);
}

console.log('');
if (failures) { console.error(`${failures} check(s) failed.`); process.exit(1); }
console.log('A row with changes that are not saved says so, keeps them through a redraw, and cannot be left silently.');
