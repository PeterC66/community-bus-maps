// Magic-link email. GO-LIVE.md §2.3 — before this module existed,
// EMAIL_PROVIDER had no send path at all: setting it would have silently
// stopped links reaching anyone, since server.js only ever printed them to
// the console. EMAIL_PROVIDER unset (the default) keeps that dev behaviour —
// this module is a no-op and the caller's own console.log carries on working.
//
// Add a provider by dropping a `send{to,from,subject,text,html}` function into
// PROVIDERS below and pointing EMAIL_PROVIDER at its key.

import { sendViaResend } from './resend.js';
import { recordSendFailure, recordSendSuccess } from './health.js';
import { escapeHtml as h } from '../html.js';
import { emailFrom, emailProvider } from '../config.js';

const PROVIDERS = { resend: sendViaResend };

function fromAddress() {
  return emailFrom();
}

/** The sign-in page, derived from the magic link itself rather than from config.
 *  The link is already absolute and already points at this deployment, so this
 *  cannot disagree with it — which a second PUBLIC_BASE_URL lookup could. */
function signInPageFrom(link) {
  try { return `${new URL(link).origin}/app/login.html`; } catch { return null; }
}

/** The address a reader who is confused by any of this should write to. It is
 *  the one on /contact.html and /index.html, and it is deliberately NOT
 *  `emailFrom()`: that is configuration, it defaults to `noreply@busmaps.uk`,
 *  and an email whose only escape hatch is a reply to a no-reply address is the
 *  same dead end as no escape hatch at all. */
const CONTACT = 'info@busmaps.uk';

/** WHAT TO DO WHEN THE LINK HAS GONE STALE, in one sentence, shared by the two
 *  letters that are PUSHED at somebody rather than asked for.
 *
 *  A magic link lives fifteen minutes, which is right for a link somebody just
 *  asked for and wrong for one pushed at them; and the re-request form answers
 *  identically whether or not an address is registered (deliberately, so nobody
 *  can probe for accounts), so a typo there is met with silence. Naming the
 *  address in the email that was sent TO that address removes both problems,
 *  and it is why the TTL itself is left alone: a longer-lived credential sitting
 *  in an inbox is a worse trade than one extra click.
 *
 *  IT IS SHARED RATHER THAN COPIED because it was written once for the adviser
 *  and the customer invite went without it for a week — which is the shape of
 *  this whole action (OA-365): the corrected half sitting beside the
 *  uncorrected twin in the same file. A second copy is a second thing to fix. */
function staleLinkSentence({ link, to }) {
  const signIn = signInPageFrom(link);
  return signIn && to
    ? `That link lasts about fifteen minutes and can only be used once. If it has already gone stale, open ${signIn} and enter ${to} — the address this email came to — and a fresh one will be sent.`
    : 'That link lasts about fifteen minutes and can only be used once. If it has already gone stale, ask whoever invited you for another.';
}

/**
 * THE THREE KINDS, AND WHY ONLY ONE OF THEM IS SHORT.
 *
 * `signin` answers somebody who has just typed their address into the sign-in
 * page. They are expecting it, they asked for it seconds ago, and that is what
 * lets it be two lines long. It is the only kind that may be.
 *
 * `adviser` was the first correction (found 2026-09-12, by Peter sending one to
 * himself). A local adviser is a member of the public who wrote in about a bus
 * map a fortnight earlier; nothing has happened at their end, they have applied
 * for nothing, and what arrived was an unsolicited bare link with an urgency
 * note and no sender name — the shape of a phishing email, sent to precisely
 * the sort of careful person who reports faults on bus maps. The likeliest
 * outcome was that they deleted it.
 *
 * `invite` IS THE SECOND CORRECTION AND IT IS THE SAME FAULT (OA-365, found by
 * Peter on 2026-09-14, an hour after the first customer's account holder was
 * emailed: *"Sam should have received an email from us and we have had no
 * contact with him before. He may be wondering what it is all about."*). The
 * comment here used to say that an invite "goes to somebody who is expecting an
 * email", and that was an assumption, not a fact the code had checked. The
 * first person this project ever invited had never corresponded with
 * BusMaps.uk, was copied on somebody else's email that morning, and read it at
 * a COUNCIL address — where an unexplained sign-in link from an unfamiliar
 * service is exactly the thing a careful person deletes. The organisation is
 * approved by an admin, so the invite is pushed at its editor in the same sense
 * the adviser's is; nobody types their address to summon it.
 *
 * So both pushed letters carry the same five things, and only the first differs:
 *
 *   1. WHO AND WHY, in the subject and the opening sentence — the map for an
 *      adviser, the ORGANISATION for a customer's editor. It is the only thing
 *      that makes the email recognisably about something the reader knows.
 *   2. WHAT TO DO WHEN THE LINK HAS GONE STALE — `staleLinkSentence()` above.
 *   3. HOW LONG THEY STAY SIGNED IN, because somebody who thinks they get one
 *      visit uses it differently from somebody who knows they can come back.
 *   4. WHAT THEY WILL SEE, so that signing in is not a step into the dark.
 *   5. PERMISSION TO IGNORE IT, and an address to ask at. If they were not
 *      expecting this, saying so plainly is more use than an urgency note.
 *
 * NO SENTENCE IN EITHER LETTER ASSERTS A STATE, and that rule is load-bearing
 * rather than stylistic — see the long comment on the adviser's first paragraph.
 * It is why the invite does not say a map is waiting: at approval a customer
 * usually has none yet, and the two call sites in src/routes/admin.js issue this
 * same letter at two different moments in an organisation's life.
 */
function magicLinkContent({ link, kind, mapName, to, orgName, role }) {
  if (kind === 'adviser') return adviserContent({ link, mapName, to });
  if (kind === 'invite') return inviteContent({ link, to, orgName, role });
  const lede = 'Sign in to BusMaps.uk.';
  const footnote = 'This link expires shortly and can only be used once. If you didn’t request it, you can ignore this email.';
  return {
    subject: 'Your BusMaps.uk sign-in link',
    text: `${lede}\n\n${link}\n\n${footnote}\n`,
    html: `<p>${h(lede)}</p><p><a href="${h(link)}">${h(link)}</a></p><p style="color:#666;font-size:13px">${h(footnote)}</p>`,
  };
}

/** The letter a customer's editor gets. `orgName` is what makes it about
 *  something the reader recognises, and when it is missing every sentence below
 *  still stands — it says nothing rather than naming an organisation it does
 *  not know, the same contract the adviser letter has with `mapName`.
 *
 *  `role` exists so the fix for one reader does not become a false sentence to
 *  another: two of these paragraphs are true only of an EDITOR, and the admin
 *  add-user screen can issue this same letter to an approver or an admin, who
 *  publishes. It defaults to `editor` because that is what both real call sites
 *  overwhelmingly create and what the approve route can only create. */
function inviteContent({ link, to, orgName, role }) {
  const org = orgName || null;
  const forOrg = org ? ` for ${org}` : '';
  const editor = (role || 'editor') === 'editor';
  const paras = [
    // NOT "your organisation has been registered" and not "a map is ready".
    // Both assert a state, and this one letter is sent at two different moments:
    // at approval, when the organisation is new and owns no map at all, and from
    // the admin add-user screen months later, when it owns several. An account
    // existing is the only fact true at both.
    org
      ? `${org} has an account with BusMaps.uk, and you have been added to it${editor ? ' as an editor' : ''}. This is how to sign in.`
      : `You have ${editor ? 'an editor’s account' : 'an account'} on BusMaps.uk. This is how to sign in to it.`,
    'Sign in here:',
    link,
    staleLinkSentence({ link, to }),
    'Once you are in, you stay signed in on that browser for a week, and every visit extends it — so you should not have to do this each time. Closing the browser or restarting the computer does not sign you out.',
    // WHAT THEY WILL SEE, named exactly as the page names itself ("My maps",
    // views/app/index.html), so the first screen confirms the email rather than
    // reading as a different product.
    org
      ? `You will land on a page called “My maps”, which lists the maps belonging to ${org} and nothing else.`
      : 'You will land on a page called “My maps”, which lists your organisation’s maps and nothing else.',
    // THE REASSURANCE HAS TO BE THE TRUE ONE. The adviser letter says "nothing
    // you can change by accident", which is true of a read-only seat and false
    // of an editor's. What IS true of an editor is the separation of duties the
    // review gate exists for: src/routes/review.js, "the customer who edits
    // never publishes". That is the more useful sentence anyway — it answers
    // the fear of breaking something in public.
    editor
      ? 'You can look at a map and ask for changes. Nothing you do goes public on its own: a new version is checked and published by us, not by you.'
      : null,
    `If you were not expecting this and do not know what it is about, you can ignore it — nothing happens until the link is used. If you would rather ask a person first, write to ${CONTACT}.`,
  ].filter(Boolean);
  return {
    // It names the organisation and not the product, because the organisation is
    // the word the reader recognises; "You've been invited to BusMaps.uk" named
    // a service the first recipient had never heard of. Under 78 characters for
    // any plausible organisation name, so it survives a mail client's truncation.
    subject: org ? `Your BusMaps.uk sign-in${forOrg}` : 'Your BusMaps.uk sign-in',
    text: `${paras.join('\n\n')}\n`,
    html: paras
      .map((p, i) => (i === 2
        ? `<p><a href="${h(p)}">${h(p)}</a></p>`
        : `<p${i >= 3 ? ' style="color:#444;font-size:14px"' : ''}>${h(p)}</p>`))
      .join(''),
  };
}

function adviserContent({ link, mapName, to }) {
  const map = mapName ? `${mapName} bus map` : 'bus map';
  const stale = staleLinkSentence({ link, to });
  const paras = [
    // "AND TO SEE NEW VERSIONS BEFORE THEY GO OUT", not "before it goes out"
    // (Peter, 2026-09-12, reading the real thing). The first wording asserts that
    // there is something waiting that has not been published — true for a map
    // with a draft on the bench, and false for Ramsey, which went public before
    // anybody showed it to him, and false for every map whose working head is its
    // published version, which is all of them until somebody edits one.
    //
    // The obvious repair is to branch on the version's state, and it is the wrong
    // one: this is the third thing in this feature to assert a state it had not
    // checked, and a sentence with no state in it cannot go stale. It also says
    // the truer thing — what is being offered is a standing arrangement, not one
    // document. The PAGE says what is on the bench today, because the page asks.
    `You have been asked to look at the ${map}, and to see new versions of it before they go out. This is how.`,
    `Sign in here:`,
    link,
    stale,
    'Once you are in, you stay signed in on that browser for a week, and every visit extends it — so you should not have to do this each time. Closing the browser or restarting the computer does not sign you out.',
    `You will see one map and nothing else. There is nothing to set up, nothing to download, and nothing you can change by accident.`,
    'If you were not expecting this and do not know what it is about, you can ignore it. Nothing happens until the link is used.',
  ];
  return {
    // Same correction as the first paragraph, and the subject is the half that
    // matters most because it is what decides whether the email is opened at all:
    // "before it is published" asserts something unpublished is waiting, which is
    // false for every map whose working head is its published version. This is
    // true whatever is on the bench, and 69 characters, so it survives Gmail.
    subject: `You can now see new versions of the ${map} before they go out`,
    text: `${paras.join('\n\n')}\n`,
    html: paras
      .map((p, i) => (i === 2
        ? `<p><a href="${h(p)}">${h(p)}</a></p>`
        : `<p${i >= 3 ? ' style="color:#444;font-size:14px"' : ''}>${h(p)}</p>`))
      .join(''),
  };
}

/** Send a magic-link email. Returns {sent:false} when EMAIL_PROVIDER is unset
 * (the caller should fall back to its own dev-console logging); throws on a
 * configured provider actually failing, so the caller decides how loud to be.
 *
 * `mapName` is read only by the `adviser` kind and `orgName` only by `invite`;
 * each is what makes that letter recognisable to its own reader, and each is
 * optional because a script or a future caller may not hold it. `to` is passed
 * into the content as well as to the transport, because both pushed letters
 * name the address to re-request a link with. */
export async function sendMagicLink({ to, link, kind = 'signin', mapName = null, orgName = null }) {
  const { subject, text, html } = magicLinkContent({ link, kind, mapName, to, orgName });
  return sendEmail({ to, subject, text, html });
}

/** Exported for scripts/test-magic-link-email.mjs — the words a stranger reads
 *  are worth asserting, and until 2026-09-12 nothing in this repository read
 *  them at all. */
export { magicLinkContent };

/**
 * Send one already-composed email. Same contract as sendMagicLink: a no-op
 * returning {sent:false} when no provider is configured, and it throws when a
 * configured provider fails. Used by the transactional notifications in
 * ./notify.js, which is the only other thing this service ever emails about.
 */
export async function sendEmail({ to, subject, text, html }) {
  const provider = emailProvider();
  // Not a failure: no provider is the documented dev default, and the caller
  // falls back to printing the link. Counting it as a send failure would make
  // every development run look like a broken mail server.
  if (!provider) return { sent: false, reason: 'EMAIL_PROVIDER not set' };
  const send = PROVIDERS[provider];
  if (!send) {
    const e = new Error(`Unknown EMAIL_PROVIDER "${provider}" — supported: ${Object.keys(PROVIDERS).join(', ')}`);
    recordSendFailure(e);
    throw e;
  }
  // Every outcome of a CONFIGURED provider is counted, here rather than at each
  // call site, because there are three call sites and the one that mattered
  // (the magic link) is the one that silently swallowed its failures for
  // months — technical-audit_2026-08-19 O4. See ./health.js.
  try {
    const r = await send({ to, from: fromAddress(), subject, text, html });
    recordSendSuccess();
    return r;
  } catch (e) {
    recordSendFailure(e);
    throw e;
  }
}
