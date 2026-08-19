// Extracted from app/login.html on 2026-08-19 so the Caddyfile's CSP can say
// `script-src 'self'` with no 'unsafe-inline' (technical-audit_2026-08-19 S1).
// An inline-script allowance is site-wide, so it would also have applied to
// /m/<slug>, which injects generated SVG straight into the DOM (S9) - the CSP
// is the control that makes that injection safe, and 'unsafe-inline' would
// have handed the exemption straight back. Loaded with `defer`: it runs after
// parsing, so every element it reaches for exists, and any non-deferred script
// before it (editor-eye-view.js) has already run.

const params = new URLSearchParams(location.search);
if (params.get('error') === 'expired') {
  const m = document.getElementById('loginMsg');
  m.textContent = 'That sign-in link was invalid or has expired. Please request a new one.';
  m.className = 'form-msg err show';
}
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  const email = document.getElementById('email').value.trim();
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/auth/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      msg.textContent = body.message || 'Check your email for a sign-in link.';
      msg.className = 'form-msg ok show';
    } else {
      msg.textContent = (body && body.error) || 'Something went wrong. Please try again.';
      msg.className = 'form-msg err show';
    }
  } catch {
    msg.textContent = 'Network error — please try again.';
    msg.className = 'form-msg err show';
  } finally {
    btn.disabled = false; btn.textContent = 'Send me a sign-in link';
  }
});
