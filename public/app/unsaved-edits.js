// Unsaved edits on an editable grid row (buses-data OA-363).
//
// WHY IT EXISTS. The admin console's Customers and Users grids put several
// controls on each row and one Save button at its end, and nothing said a row
// had been changed and not saved. Untick `Sample maps` on a customer, click
// another tab, and the screen looked exactly as it does after a save; come
// back, and the re-render had put the database's value back without a word.
// diagram.js has done this properly since the pin editor was built — a dirty
// flag, an "unsaved" state, Save disabled until there is something to save,
// and a beforeunload guard — and this is that shape made per-row, so the two
// screens follow one standard rather than two.
//
// THE CONTRACT. A row that wants tracking carries `data-edit-key` (unique within
// its grid) and gives each of its controls a `data-q`; its Save button is
// `button[data-save]`. After a grid is drawn, `arm(box)` records every control's
// value as the row's starting point. A row whose controls differ from that is
// DIRTY: it gets the `dirty` class and its Save button is enabled and primary.
//
// A RE-RENDER KEEPS AN EDIT RATHER THAN DISCARDING IT. The grids redraw from
// server rows on a column sort, and on a reload after another row is saved.
// `carry(box)` taken before the redraw, passed to `arm(box, carried)` after it,
// puts back only the controls the operator actually changed — a control they
// did not touch shows the server's current value, which may be newer.
//
// A classic script, not a module, so admin.js can call it as a global; `var` so
// the test harness can read it out of a vm context.

var UnsavedEdits = (function () {
  const ctlVal = (el) => (el.type === 'checkbox' ? el.checked : el.value);
  const setCtl = (el, v) => { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; };
  const controls = (row) => Array.from(row.querySelectorAll('[data-q]'));
  const changed = (el) => String(ctlVal(el)) !== el.dataset.init;
  const rows = (scope) => Array.from(scope.querySelectorAll('.gt-row[data-edit-key]'));
  const isDirty = (row) => controls(row).some(changed);

  function refresh(row) {
    const dirty = isDirty(row);
    row.classList.toggle('dirty', dirty);
    const save = row.querySelector('button[data-save]');
    if (save) {
      save.disabled = !dirty;
      save.classList.toggle('btn-primary', dirty);
      save.classList.toggle('btn-ghost', !dirty);
      save.title = dirty ? 'This row has changes that are not saved yet.' : 'Nothing on this row has changed.';
    }
    return dirty;
  }

  function markSaved(row) {
    controls(row).forEach((el) => { el.dataset.init = String(ctlVal(el)); });
    refresh(row);
  }

  function arm(box, carried) {
    rows(box).forEach((row) => {
      controls(row).forEach((el) => { el.dataset.init = String(ctlVal(el)); });
      const kept = carried && carried[row.dataset.editKey];
      if (kept) controls(row).forEach((el) => { if (Object.prototype.hasOwnProperty.call(kept, el.dataset.q) && !el.disabled) setCtl(el, kept[el.dataset.q]); });
      const onEdit = () => refresh(row);
      row.addEventListener('input', onEdit);
      row.addEventListener('change', onEdit);
      refresh(row);
    });
  }

  function carry(box) {
    const out = {};
    rows(box).forEach((row) => {
      const edits = {};
      controls(row).filter(changed).forEach((el) => { edits[el.dataset.q] = ctlVal(el); });
      if (Object.keys(edits).length) out[row.dataset.editKey] = edits;
    });
    return out;
  }

  function revert(scope) {
    rows(scope).forEach((row) => {
      controls(row).filter(changed).forEach((el) => setCtl(el, el.type === 'checkbox' ? el.dataset.init === 'true' : el.dataset.init));
      refresh(row);
    });
  }

  const count = (scope) => rows(scope).filter(isDirty).length;

  return { arm, carry, count, markSaved, refresh, revert };
})();
