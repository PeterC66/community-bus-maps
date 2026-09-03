// The three transactional emails (findings B2).
//
// Before these existed, nothing told anyone anything: not when an update was
// staged for a customer, not when their submission was published, not when it
// was sent back. Every state change was discovered by signing in and looking,
// which is why a staged update could sit for weeks — and why eight live maps
// once held a draft nobody remembered. For a monthly cycle handled by a
// part-time clerk that was the largest practical gap in the flow.
//
// Three rules govern everything here:
//
//   1. **An email must never break the flow it reports on.** Publishing a map
//      succeeded whether or not the notification went out, so every send is
//      fire-and-forget: failures are logged, never thrown at the caller, and
//      never rolled back into the HTTP response.
//   2. **No provider ⇒ no send, exactly as before.** With EMAIL_PROVIDER unset
//      (local dev, and the host before Resend was wired up) src/email/index.js
//      is a no-op and this module just logs who it would have told.
//   3. **Undeliverable addresses are skipped, not attempted.** The seeded demo
//      organisations use the RFC 2606 reserved domains (.example, .invalid);
//      sending to them earns nothing but bounces against the sending domain's
//      reputation, which is the one thing that would stop the magic links —
//      the emails people actually need — from arriving.
//
// Wording follows the vocabulary the screens now use: an *update* is what
// arrives, a *version* is a saved state, *review* is what an approver does and
// *publish* is theirs alone.

import { sendEmail } from './index.js';
import { escapeHtml as h } from '../html.js';
import { listUsersAdmin } from '../db/index.js';
import { publicBaseUrl } from '../config.js';

const SITE = 'BusMaps.uk';

/** Absolute URL for a portal path, from PUBLIC_BASE_URL (blank ⇒ a bare path). */
export function appUrl(pathname) {
  const base = publicBaseUrl();   // one normalisation for all three readers (Tier 5, F7)
  return `${base}${pathname}`;
}

// RFC 2606 / RFC 6761 reserved names, matched against the DOMAIN half:
// reachable by nobody, ever.
const UNDELIVERABLE = /(^|\.)(example|invalid|test|localhost)$|^example\.(com|net|org)$/i;
export function deliverable(email) {
  const at = String(email || '').split('@');
  if (at.length !== 2 || !at[1]) return false;
  return !UNDELIVERABLE.test(at[1]);
}

/**
 * Who to tell about a map. The customer's own active users — an approver at
 * BusMaps.uk is not on this list, because none of these three emails is
 * addressed to us: the review queue is already the operator's own worklist.
 */
export function recipientsFor(customerId) {
  if (customerId == null) return [];
  return listUsersAdmin(customerId)
    .filter((u) => u.status === 'active' && deliverable(u.email))
    .map((u) => u.email);
}

function wrap({ lede, body, action, footnote }) {
  const text = [lede, '', ...body, '', action ? `${action.label}: ${action.url}` : '', '', footnote]
    .filter((l) => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');
  // Every value is escaped on the way into the HTML half. The text half is the
  // same words unescaped, which is what a text/plain part is for (OA-224 Tier 1.2).
  const html = `<p>${h(lede)}</p>${body.map((b) => `<p>${h(b)}</p>`).join('')}`
    + (action ? `<p><a href="${h(action.url)}">${h(action.label)}</a></p>` : '')
    + `<p style="color:#666;font-size:13px">${h(footnote)}</p>`;
  return { text, html };
}

const SIGN_OFF = `You are receiving this because your organisation has a map on ${SITE}. Reply to this email if you would rather not.`;

/**
 * Compose one of the three. Pure and exported so the wording can be read (and
 * tested) without a mail provider or a database.
 * @param {'update-ready'|'published'|'sent-back'|'published-batch'} kind
 * @param {{mapName:string, mapUrl:string, versionKey?:string, publishedVersion?:string,
 *          sourceNote?:string, reason?:string, publicUrl?:string,
 *          maps?:{mapName:string, versionKey?:string, mapUrl:string}[]}} f
 */
export function compose(kind, f) {
  const map = f.mapName || 'your map';
  if (kind === 'update-ready') {
    return {
      subject: `An update is ready for ${map}`,
      ...wrap({
        lede: `A rebuilt version of <strong>${map}</strong> is waiting for you at ${SITE}.`.replace(/<\/?strong>/g, ''),
        body: [
          f.sourceNote ? `What changed: ${f.sourceNote}` : 'It has been rebuilt from newer timetable data.',
          'Nothing is public yet and your map is unaffected until you decide. Open it to see exactly what moved, then accept the update or decline it.',
          'Accepting creates a new draft with your colours and landmark choices re-applied — you then send it to us for review, and an approver publishes it.',
        ],
        action: { label: 'See what changed', url: f.mapUrl },
        footnote: SIGN_OFF,
      }),
    };
  }
  if (kind === 'published') {
    return {
      subject: `${map} ${f.versionKey ? f.versionKey + ' ' : ''}is published`,
      ...wrap({
        lede: `An approver has reviewed and published <strong>${map}</strong>${f.versionKey ? ` ${f.versionKey}` : ''}.`.replace(/<\/?strong>/g, ''),
        body: [
          'It is now the official version: the print-ready sheets people rely on, and what your public page serves.',
          f.publicUrl ? `Public page: ${f.publicUrl}` : 'It is not listed on the public site — tick "List this map" on the map page when you want the page live.',
        ],
        action: { label: 'Open the map', url: f.mapUrl },
        footnote: SIGN_OFF,
      }),
    };
  }
  if (kind === 'published-batch') {
    const maps = Array.isArray(f.maps) ? f.maps : [];
    const n = maps.length;
    return {
      subject: `${n} map${n === 1 ? '' : 's'} published on ${SITE}`,
      ...wrap({
        lede: `An approver has reviewed and published ${n} map${n === 1 ? '' : 's'} for your organisation.`,
        body: [
          'Each is now the official version: the print-ready sheets people rely on, and what your public page serves.',
          ...maps.map((m) => `${m.mapName}${m.versionKey ? ` ${m.versionKey}` : ''} — ${m.mapUrl}`),
        ],
        footnote: SIGN_OFF,
      }),
    };
  }
  if (kind === 'sent-back') {
    return {
      subject: `${map} ${f.versionKey ? f.versionKey + ' ' : ''}was sent back`,
      ...wrap({
        lede: `An approver has sent <strong>${map}</strong>${f.versionKey ? ` ${f.versionKey}` : ''} back to you rather than publishing it.`.replace(/<\/?strong>/g, ''),
        body: [
          f.reason ? `Their reason: “${f.reason}”` : 'No reason was recorded.',
          `Nothing changed for the public${f.publishedVersion ? ` — they still have ${f.publishedVersion}` : ''}. You can edit the map again and send it back for review when you are happy with it.`,
        ],
        action: { label: 'Edit the map', url: f.mapUrl },
        footnote: SIGN_OFF,
      }),
    };
  }
  throw new Error(`Unknown notification kind "${kind}"`);
}

/**
 * Send one notification to a customer's people. Never throws, never rejects:
 * the caller has already done the thing this describes.
 * @param {object} log  a pino-ish logger ({info, warn}) — the request log, usually
 * @returns {Promise<{sent:number, skipped:number}>}
 */
export async function notify(kind, { customerId, log = console, ...fields }) {
  const to = recipientsFor(customerId);
  if (!to.length) {
    log.info?.({ kind, customerId }, 'notification: nobody deliverable to tell');
    return { sent: 0, skipped: 0 };
  }
  let msg;
  try { msg = compose(kind, fields); } catch (e) { log.warn?.({ kind, err: e.message }, 'notification: could not compose'); return { sent: 0, skipped: to.length }; }
  let sent = 0, skipped = 0;
  for (const addr of to) {
    try {
      const r = await sendEmail({ to: addr, subject: msg.subject, text: msg.text, html: msg.html });
      if (r && r.sent) sent++; else skipped++;
    } catch (e) {
      skipped++;
      log.warn?.({ kind, to: addr, err: e.message }, 'notification: send failed (the action itself succeeded)');
    }
  }
  log.info?.({ kind, sent, skipped, subject: msg.subject }, sent ? 'notification sent' : 'notification not sent (no provider, or every send failed)');
  return { sent, skipped };
}
