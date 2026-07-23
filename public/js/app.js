// Progressive-enhancement form handling: any <form data-endpoint="/api/…">
// submits as JSON via fetch, shows an inline result, and highlights bad fields.
document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.endpoint) return;
  e.preventDefault();

  const msg = form.querySelector('.form-msg');
  const btn = form.querySelector('button[type="submit"]');
  form.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
  if (msg) msg.className = 'form-msg';

  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = v; });

  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Sending…'; }
  try {
    const res = await fetch(form.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      form.reset();
      if (msg) { msg.textContent = form.dataset.success || 'Thank you — we’ve received your details and will be in touch.'; msg.className = 'form-msg ok show'; }
    } else {
      (body.fields || []).forEach((name) => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el && el.closest('.field')) el.closest('.field').classList.add('invalid');
      });
      if (msg) { msg.textContent = body.error || 'Sorry, something went wrong. Please try again.'; msg.className = 'form-msg err show'; }
    }
  } catch {
    if (msg) { msg.textContent = 'Network error — please try again.'; msg.className = 'form-msg err show'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Send'; }
  }
});
