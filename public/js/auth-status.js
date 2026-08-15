// Shows sign-in state in the site header on public pages, so there's a way
// back to sign in or sign out from anywhere other than /app.
(async () => {
  try {
    const nav = document.querySelector('.site-header .nav');
    if (!nav) return;
    // The fixed slot after "Apply to join" (P9 A3) - falls back to appending
    // straight onto nav so a stale cached page (old markup, no slot) still works.
    const slot = nav.querySelector('#navAuth');
    const target = slot || nav;

    const r = await fetch('/api/me', { credentials: 'same-origin' });
    const user = r.ok ? (await r.json()).user : null;

    if (user) {
      // Already signed in — the "Apply to join" CTA is for prospective organisations.
      // The nav copy is replaced by the whoami/My maps/Sign out group below, but any
      // other "Apply to join" / "Register your interest" CTA on the page (hero, body)
      // is repointed to /app rather than simply removed, so a signed-in visitor never
      // lands on a primary CTA that leads back into an application they've already made.
      nav.querySelector('a[href="/apply.html"]')?.remove();
      document.querySelectorAll('a.btn-primary[href="/apply.html"]').forEach((el) => {
        el.href = '/app';
        el.textContent = 'Go to my maps';
      });

      const who = document.createElement('span');
      who.className = 'navlink';
      who.id = 'authWhoami';
      who.textContent = `Signed in as ${user.name || user.email}`;

      const appLink = document.createElement('a');
      appLink.className = 'btn btn-primary btn-sm';
      appLink.id = 'authAppLink';
      appLink.href = '/app';
      appLink.textContent = 'My maps';

      const signOut = document.createElement('button');
      signOut.className = 'btn btn-ghost btn-sm';
      signOut.id = 'authSignout';
      signOut.type = 'button';
      signOut.textContent = 'Sign out';
      signOut.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        location.href = '/';
      });

      if (slot) slot.replaceChildren(who, appLink, signOut);
      else target.append(who, appLink, signOut);
    } else if (r.status === 401) {
      const signIn = document.createElement('a');
      signIn.className = 'navlink';
      signIn.id = 'authSignin';
      signIn.href = '/app/login.html';
      signIn.textContent = 'Sign in';

      if (slot) slot.replaceChildren(signIn);
      else target.appendChild(signIn);
    }
    // Any other /api/me failure (network error etc.) — leave the header as-is.
  } catch {
    // /api/me unavailable — leave the header as-is.
  }
})();
