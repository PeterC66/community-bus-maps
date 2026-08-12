// H9 — a purely presentational toggle for admins. It hides the operator's own
// Admin/Review nav links and the Refreshes tab's Accept/Decline buttons, so the
// handoffs between customer, approver and admin read the way they would to
// someone who doesn't hold every role at once (portal-update-flow-findings
// section H9). No auth change, no impersonation, no scoping change — an admin
// keeps every permission underneath; call apply() again after anything that
// might reveal a [data-eev-hide] element (e.g. after role-based nav is shown).
(function () {
  const KEY = 'eev';
  function on() { return localStorage.getItem(KEY) === '1'; }
  function setOn(v) {
    if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY);
    apply();
  }
  function apply() {
    const active = on();
    document.querySelectorAll('[data-eev-hide]').forEach((el) => { el.style.display = active ? 'none' : ''; });
    renderBanner(active);
  }
  function renderBanner(active) {
    let el = document.getElementById('eevBanner');
    if (!active) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'eevBanner';
    el.className = 'eev-banner';
    el.innerHTML = '<div class="eev-banner-inner"><span class="eev-badge">Editor’s-eye view</span>'
      + '<span class="eev-text">Admin and Review are hidden, so the handoffs read the way a customer or approver would see them. You still hold every permission underneath.</span>'
      + '<button type="button" class="eev-off">Turn off</button></div>';
    document.body.prepend(el);
    el.querySelector('.eev-off').addEventListener('click', () => setOn(false));
  }
  window.EEV = { on, set: setOn, apply };
})();
