// Shows "Signed in as …" + a Sign out button in the site header on public pages,
// so there's a way back to logout from anywhere other than /app.
(async () => {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (!r.ok) return;
    const { user } = await r.json();
    if (!user) return;

    const nav = document.querySelector('.site-header .nav');
    if (!nav) return;

    const who = document.createElement('span');
    who.className = 'navlink';
    who.id = 'authWhoami';
    who.textContent = `Signed in as ${user.name || user.email}`;

    const signOut = document.createElement('button');
    signOut.className = 'btn btn-ghost btn-sm';
    signOut.id = 'authSignout';
    signOut.type = 'button';
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/';
    });

    const appLink = document.createElement('a');
    appLink.className = 'navlink';
    appLink.id = 'authAppLink';
    appLink.href = '/app';
    appLink.textContent = 'My maps';

    nav.append(appLink, who, signOut);
  } catch {
    // Not signed in, or /api/me unavailable — leave the header as-is.
  }
})();
