// Magic-link email. GO-LIVE.md §2.3 — before this module existed,
// EMAIL_PROVIDER had no send path at all: setting it would have silently
// stopped links reaching anyone, since server.js only ever printed them to
// the console. EMAIL_PROVIDER unset (the default) keeps that dev behaviour —
// this module is a no-op and the caller's own console.log carries on working.
//
// Add a provider by dropping a `send{to,from,subject,text,html}` function into
// PROVIDERS below and pointing EMAIL_PROVIDER at its key.

import { sendViaResend } from './resend.js';

const PROVIDERS = { resend: sendViaResend };

function fromAddress() {
  return process.env.EMAIL_FROM || 'BusMaps.uk <noreply@busmaps.uk>';
}

function magicLinkContent({ link, kind }) {
  const invite = kind === 'invite';
  const subject = invite ? 'You’ve been invited to BusMaps.uk' : 'Your BusMaps.uk sign-in link';
  const lede = invite ? 'You’ve been invited to sign in to BusMaps.uk.' : 'Sign in to BusMaps.uk.';
  const footnote = 'This link expires shortly and can only be used once. If you didn’t request it, you can ignore this email.';
  return {
    subject,
    text: `${lede}\n\n${link}\n\n${footnote}\n`,
    html: `<p>${lede}</p><p><a href="${link}">${link}</a></p><p style="color:#666;font-size:13px">${footnote}</p>`,
  };
}

/** Send a magic-link email. Returns {sent:false} when EMAIL_PROVIDER is unset
 * (the caller should fall back to its own dev-console logging); throws on a
 * configured provider actually failing, so the caller decides how loud to be. */
export async function sendMagicLink({ to, link, kind = 'signin' }) {
  const { subject, text, html } = magicLinkContent({ link, kind });
  return sendEmail({ to, subject, text, html });
}

/**
 * Send one already-composed email. Same contract as sendMagicLink: a no-op
 * returning {sent:false} when no provider is configured, and it throws when a
 * configured provider fails. Used by the transactional notifications in
 * ./notify.js, which is the only other thing this service ever emails about.
 */
export async function sendEmail({ to, subject, text, html }) {
  const provider = process.env.EMAIL_PROVIDER;
  if (!provider) return { sent: false, reason: 'EMAIL_PROVIDER not set' };
  const send = PROVIDERS[provider];
  if (!send) throw new Error(`Unknown EMAIL_PROVIDER "${provider}" — supported: ${Object.keys(PROVIDERS).join(', ')}`);
  return send({ to, from: fromAddress(), subject, text, html });
}
