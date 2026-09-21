// The local adviser's one page — buses-data OA-154 Phase D1.
//
// It shows the current draft of a map somebody has been asked to look at, and it
// is written for a member of the public doing us a favour rather than for a
// customer using a product. Three consequences worth stating, because each one
// looks like an omission:
//
//   * NO DOWNLOAD BUTTON, and no link that could become one. The sheets arrive
//     as inline SVG from /api/adviser/maps/:id/sheets/:base, which is not a file
//     route — there is no .svg URL to right-click and no JPG offered at all.
//     src/routes/adviser.js is the half that enforces it; this is the half that
//     does not tempt anybody.
//   * NO FORM. Phase D2 — answering a map's open questions in the portal — waits
//     on the local-decisions panel (OA-083). Until that exists, the page says how
//     to reply instead of offering a box that feeds nothing, because the one
//     favour a volunteer is doing must not be spent on a form nobody reads.
//   * NOTHING ABOUT THE ORGANISATION. An adviser was asked about a TOWN. The API
//     does not send a customer name, and there is nowhere here to put one.
//
// `?map=<id>` selects one when somebody has been asked about more than one, and
// it is also how an admin opens a particular map's adviser view to check what is
// being shown, without signing in as the adviser.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let viewer = null;
  let current = null;   // the map detail we are showing

  function fail(text) {
    const e = $('err');
    e.className = 'notice err show';
    e.textContent = text;
    e.hidden = false;
  }

  function note(el, kind, text) {
    el.className = 'notice ' + kind + ' show';
    el.textContent = text;
    el.hidden = false;
  }

  /** Which sheet is on screen; also the tab row's state. */
  function showSheet(base, label) {
    if (!viewer) {
      viewer = window.CBMViewer.create($('viewer'), {
        noRaster: true,
        onFail: (what) => fail('That sheet could not be loaded (' + what + '). Please tell us and we will look.'),
      });
    }
    $('err').hidden = true;
    Array.from($('sheetTabs').children).forEach((b) => b.classList.toggle('active', b.dataset.base === base));
    viewer.show({ inlineUrl: '/api/adviser/maps/' + current.id + '/sheets/' + encodeURIComponent(base) },
      current.name + ' — ' + label);
  }

  function paintMap(map) {
    current = map;
    $('pageTitle').textContent = map.name;
    $('pageCrumb').textContent = map.subject && map.subject !== map.name ? map.subject : '';

    if (!map.version || !map.sheets.length) {
      $('intro').textContent = 'There is nothing drawn for ' + map.name + ' yet. We will write to you when there is.';
      return;
    }

    // The words the artwork itself carries, so the page and the sheet cannot
    // disagree about which copy this is (src/render/draftStamp.js writes the same
    // label into the footer).
    //
    // TWO STATES, NOT ONE, and the second is the ORDINARY case rather than an edge
    // (fixed 2026-09-12). A map's working head is its published version for as long
    // as nobody edits it after publishing — which was true of the first map this
    // page was ever granted on — and the first cut of this page called that a
    // draft, in bold, to a member of the public. What matters here is that the
    // page never asserts a state the version is not in; the invitation to be blunt
    // is true either way.
    const invite = ' Have a look and tell us anything that is wrong, missing, or would confuse '
      + 'somebody trying to catch a bus. There is no need to be gentle — the whole reason you are '
      + 'looking at it is that you know the ground and the map does not.';

    if (map.version.published) {
      $('intro').innerHTML = 'This is <b>' + esc(map.version.label) + '</b> of the bus map for '
        + esc(map.name) + ' — the version that is on the public site now. '
        + '<b>There is no newer draft waiting for you.</b> When we rebuild this map, the new '
        + 'version will appear on this page as soon as it exists, before it goes out.' + invite;
      note($('draftNotice'), 'ok',
        'Nothing here is unpublished, so there is nothing to keep to yourself — this is the same '
        + 'map anybody can see.');
    } else {
      $('intro').innerHTML = 'This is <b>' + esc(map.version.label) + '</b> of the bus map for '
        + esc(map.name) + '.' + invite;
      note($('draftNotice'), 'warn',
        'This is a draft. It is not on the public site, and please do not pass it on or post it — '
        + 'an unchecked bus map doing the rounds is worse than no bus map at all.');
    }

    $('sheetTabs').innerHTML = map.sheets.map((s, i) => (
      '<button class="tab' + (i === 0 ? ' active' : '') + '" type="button" role="tab" data-base="'
      + esc(s.base) + '">' + esc(s.label) + '</button>'
    )).join('');
    Array.from($('sheetTabs').children).forEach((b) => b.addEventListener('click', () => {
      showSheet(b.dataset.base, b.textContent);
    }));
    $('sheetArea').hidden = false;
    $('tellUs').innerHTML = 'Reply to the email that brought you here, or use the '
      + '<a href="/contact.html">contact form</a>. One day you will be able to write it down here '
      + 'against each question; for now a person reads every word of it either way.';
    $('tellUsPanel').hidden = false;
    showSheet(map.sheets[0].base, map.sheets[0].label);
  }

  async function openMap(id) {
    const r = await fetch('/api/adviser/maps/' + id);
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || !body.ok) {
      fail((body && body.error) || 'That map could not be opened.');
      return;
    }
    paintMap(body.map);
  }

  (async () => {
    try {
      const me = await fetch('/api/me').then((r) => (r.status === 401 ? null : r.json()));
      if (!me) { location.href = '/app/login.html'; return; }
      $('whoami').textContent = me.user.email;
      $('logoutBtn').style.display = '';
      // READ THE ANSWER BEFORE NAVIGATING AWAY (2026-09-12). This used to fire
      // and forget, and the page went to the home page whatever came back — so
      // when the request was being refused 403 for want of the CSRF header, the
      // button LOOKED like it worked: you landed somewhere else, signed in.
      // Somebody on a shared computer would have believed they had signed out.
      // A logout that cannot report its own failure is worse than no button.
      $('logoutBtn').addEventListener('click', async () => {
        try {
          const r = await fetch('/api/auth/logout', { method: 'POST' });
          if (!r.ok) throw new Error(String(r.status));
          location.href = '/';
        } catch (e) {
          // NOT "close the browser" — the sign-in cookie is a persistent one with
          // a seven-day life, so closing the browser leaves the session open. The
          // advice has to be something that is actually true.
          fail('We could not sign you out just then. Please reload the page and try '
            + 'again — and do tell us if it keeps happening, because it matters.');
        }
      });

      const list = await fetch('/api/adviser/maps').then((r) => r.json());
      if (!list.ok) { fail(list.error || 'Could not load your maps.'); return; }

      const wanted = Number(new URLSearchParams(location.search).get('map')) || null;
      if (!list.maps.length && !wanted) {
        // NOT "nobody has asked you yet" (Peter, 2026-09-12, after revoking his
        // own test grant and signing in to see what it said). This page cannot
        // tell the two empty states apart — never granted, and granted then
        // stopped — and the "yet" asserts the first, which is false for anybody
        // whose grant has ended. Same fault as calling a published sheet a draft:
        // the page stating a history it has not checked.
        //
        // It deliberately does not say "your access was withdrawn" either. If a
        // grant ends, that is for a person to explain in a letter, not for a page
        // to announce to a volunteer who did us a favour. Peter's wording, which
        // is true in both states and implies nothing about which one this is.
        $('intro').textContent = list.mine
          ? 'There is no map for you to look at just now. When there is, it will appear here.'
          : 'No map currently has a local adviser.';
        return;
      }

      // ONE MAP IS THE ORDINARY CASE and gets no chooser at all: the person was
      // written to about one town, and a list of one is a decision they did not
      // need to be asked to make.
      const only = wanted || (list.maps.length === 1 ? list.maps[0].id : null);
      if (!only) {
        $('mapList').innerHTML = list.maps.map((m) => (
          '<li><a href="/app/adviser?map=' + m.id + '">' + esc(m.name) + '</a>'
          + (m.subject && m.subject !== m.name ? ' <span class="muted">' + esc(m.subject) + '</span>' : '')
          + '</li>'
        )).join('');
        $('mapListPanel').hidden = false;
        $('intro').textContent = 'You have been asked about more than one map. Pick one.';
        return;
      }
      await openMap(only);
    } catch (e) {
      fail('Could not reach the server. Please try again in a moment.');
    }
  })();
})();
