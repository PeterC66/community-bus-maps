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

/**
 * THE THREE KINDS, AND WHY THE THIRD EXISTS.
 *
 * `signin` answers somebody who has just typed their address into the sign-in
 * page. `invite` goes to a customer's first editor the moment their organisation
 * is approved. **Both go to somebody who is expecting an email**, which is what
 * lets them be two lines long.
 *
 * `adviser` is the opposite case and reusing `invite` for it was wrong (found
 * 2026-09-12, by Peter sending one to himself). A local adviser is a member of
 * the public who wrote in about a bus map a fortnight earlier; nothing has
 * happened at their end, they have applied for nothing, and what arrived was an
 * unsolicited bare link with an urgency note and no sender name — which is the
 * shape of a phishing email, sent to precisely the sort of careful person who
 * reports faults on bus maps. The likeliest outcome was that they deleted it.
 *
 * So this one has to stand on its own, and it carries the four things the other
 * two can leave out:
 *
 *   1. WHICH MAP, by name, in the subject. It is the only thing that makes the
 *      email recognisably about the conversation they have been having.
 *   2. WHAT TO DO WHEN THE LINK HAS GONE STALE — with the address spelled out.
 *      A magic link lives fifteen minutes, which is right for a link somebody
 *      just asked for and wrong for one pushed at them; and the re-request form
 *      answers identically whether or not an address is registered (deliberately,
 *      so nobody can probe for accounts), so a typo there is met with silence.
 *      Naming the address in the email that was sent TO that address removes both
 *      problems, and it is why the TTL itself is left alone: a longer-lived
 *      credential sitting in an inbox is a worse trade than one extra click.
 *   3. HOW LONG THEY STAY SIGNED IN, because somebody who thinks they get one
 *      visit uses it differently from somebody who knows they can come back.
 *   4. PERMISSION TO IGNORE IT. If they were not expecting this, saying so
 *      plainly is more use than an urgency note.
 */
function magicLinkContent({ link, kind, mapName, to }) {
  if (kind === 'adviser') return adviserContent({ link, mapName, to });
  const invite = kind === 'invite';
  const subject = invite ? 'You’ve been invited to BusMaps.uk' : 'Your BusMaps.uk sign-in link';
  const lede = invite ? 'You’ve been invited to sign in to BusMaps.uk.' : 'Sign in to BusMaps.uk.';
  const footnote = 'This link expires shortly and can only be used once. If you didn’t request it, you can ignore this email.';
  return {
    subject,
    text: `${lede}\n\n${link}\n\n${footnote}\n`,
    html: `<p>${h(lede)}</p><p><a href="${h(link)}">${h(link)}</a></p><p style="color:#666;font-size:13px">${h(footnote)}</p>`,
  };
}

function adviserContent({ link, mapName, to }) {
  const map = mapName ? `${mapName} bus map` : 'bus map';
  const signIn = signInPageFrom(link);
  const stale = signIn && to
    ? `That link lasts about fifteen minutes and can only be used once. If it has already gone stale, open ${signIn} and enter ${to} — the address this email came to — and a fresh one will be sent.`
    : 'That link lasts about fifteen minutes and can only be used once. If it has already gone stale, ask whoever invited you for another.';
  const paras = [
    `You have been asked to look at the ${map} before it goes out, and this is how to see it.`,
    `Sign in here:`,
    link,
    stale,
    'Once you are in, you stay signed in on that browser for a week, and every visit extends it — so you should not have to do this each time. Closing the browser or restarting the computer does not sign you out.',
    `You will see one map and nothing else. There is nothing to set up, nothing to download, and nothing you can change by accident.`,
    'If you were not expecting this and do not know what it is about, you can ignore it. Nothing happens until the link is used.',
  ];
  return {
    subject: `You can now see the ${map} before it is published`,
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
 * `mapName` is read only by the `adviser` kind and is what makes that email
 * recognisable; `to` is passed into the content as well as to the transport,
 * because the adviser email names the address to re-request a link with. */
export async function sendMagicLink({ to, link, kind = 'signin', mapName = null }) {
  const { subject, text, html } = magicLinkContent({ link, kind, mapName, to });
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
