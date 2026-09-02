// The admin console (P3), as a Fastify plugin (OA-231, codebase review Tier 4.4).
//
// Application review, the map-request lifecycle, customers, users, messages,
// the monthly-refresh queue, live sessions, the published-batch digest, ops and
// the audit trail: 22 routes, registered under the prefix /api/admin by
// src/server.js. The handlers are the ones server.js carried until 2026-09-02,
// moved verbatim -- the only edit inside them is that each no longer opens with
// its own requireAdmin() call.
//
// ONE GUARD, NOT 22. Every route here is admin-only, and until this file
// existed each said so for itself: 22 calls, and a new route that forgot the
// line was refused by nothing (portal-src F8). The preHandler below runs before
// every handler registered in this plugin, so a route cannot be added here
// without it. The single exception is declared as route config rather than as
// a second call site: GET /worklist admits the read-only OPERATOR_TOKEN
// (OA-203), and the guard reads that flag itself. scripts/test-admin-plugin.mjs
// enumerates the live route table and asserts the door on every one.
//
// POST /api/admin/status is NOT here on purpose. It is a STATUS_TOKEN drop-box
// for the operator's laptop that 404s to a session, the opposite of this guard,
// and it stays in server.js with the other token-authorised ops routes.
import { adminSummary, deleteSessionByHash, deleteSessionsForUser, getApplication, getCustomer, getMap, getMessage, getUser, getUserByEmail, insertCustomer, insertUser, listApplications, listAudit, listAwaitingBuild, listCustomersAdmin, listMapsByStatus, listMessages, listPendingProposedUpdates, listSessions, listUsersAdmin, publicCounts, quotaUsage, setApplicationReviewed, setMapCustomer, setMapStatus, setMessageStatus, updateCustomerAdmin, updateUserAdmin } from '../db/index.js';
import { buildWorklist } from '../worklist/index.js';
import { orgPageUrl } from '../public/index.js';
import { opsSnapshot } from '../ops/index.js';
import { SESSION_DAYS, STEP_UP_MINUTES, clearCookie, handleFromHash, requestMagicLink, sessionTokenHash } from '../auth/index.js';
import { logAudit } from '../audit/index.js';
import { bumpSearchIndex } from '../search/index.js';
import { APP_VERSION } from '../version.js';
import { sendMagicLink } from '../email/index.js';
import { notify } from '../email/notify.js';
import { DEV_LINKS, MSG_STATUSES, ORG_TYPES, authLink, baseUrl, isEmail, isHttps, operatorRead, parseJson, requireAdmin, requireStepUp, str } from '../http/helpers.js';

export default async function adminRoutes(app) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.routeOptions.config.operatorRead && operatorRead(req)) return;
    if (!requireAdmin(req, reply)) return reply;
  });

  app.get('/summary', async (req, reply) => {
    return { ok: true, summary: { ...adminSummary(), ...publicCounts() } };
  });

  // The To-do list: every queue above, ranked by who is blocked, in one response.
  // The admin console's landing tab renders this, and the operator's bus-work
  // skill consumes the same shape (importing src/worklist/index.js directly when
  // it runs beside the portal, GETting this when the portal is remote) — so the
  // console and the laptop can never show two different lists.
  //
  // Links are absolute against the request's own origin so they stay clickable
  // when the caller is a terminal on another machine.
  app.get('/worklist', { config: { operatorRead: true } }, async (req, reply) => {
    // OPERATOR_TOKEN reads this too (OA-203) — it is the list bus-work prints in
    // the terminal, and the same one the To-do tab shows. Declared as route config
    // so the plugin's guard admits it; the guard is the only reader of that flag.
    // Through the shared baseUrl(), which prefers PUBLIC_BASE_URL and only falls
    // back to the request's own Host. This route is admin-only so the header was
    // never a takeover risk here, but it was the last hand-built absolute URL in
    // the file, and leaving one behind is how the pattern comes back (N5).
    return { ok: true, worklist: buildWorklist({ baseUrl: baseUrl(req) }) };
  });

  app.get('/applications', async (req, reply) => {
    const status = ['pending', 'approved', 'rejected'].includes((req.query || {}).status) ? req.query.status : undefined;
    return { ok: true, applications: listApplications({ status }) };
  });

  // Approve an application: create the customer, its first editor user, and issue
  // a passwordless invite (printed to the server console; surfaced to the admin in
  // dev so the loop is demoable without email).
  app.post('/applications/:id/approve', async (req, reply) => {
    const appn = getApplication(Number(req.params.id));
    if (!appn) return reply.code(404).send({ ok: false, error: 'No such application.' });
    if (appn.status !== 'pending') return reply.code(409).send({ ok: false, error: `Already ${appn.status}.` });

    const email = str(appn.email, 200).toLowerCase();
    if (!isEmail(email)) return reply.code(400).send({ ok: false, error: 'The application has no valid contact email.' });
    if (getUserByEmail(email)) {
      return reply.code(409).send({ ok: false, error: `${email} already has an account. Approve this organisation manually or ask them to sign in.` });
    }

    const b = req.body || {};
    const type = ORG_TYPES.includes(appn.org_type) ? appn.org_type : 'other';
    const quota_areas = b.quotaAreas != null ? Math.max(0, Number(b.quotaAreas) | 0) : 1;
    const quota_places = b.quotaPlaces != null ? Math.max(0, Number(b.quotaPlaces) | 0) : 3;

    const customerId = insertCustomer({ name: appn.org_name, type, quota_areas, quota_places });
    insertUser({ customer_id: customerId, email, name: str(b.editorName, 120) || appn.contact_name, role: 'editor' });
    setApplicationReviewed(appn.id, 'approved', customerId);

    const token = requestMagicLink(email);
    const link = token ? authLink(req, token) : null;
    if (link) {
      try {
        const r = await sendMagicLink({ to: email, link, kind: 'invite' });
        if (!r.sent) console.log(`\n🔗  Invite (sign-in) link for ${email}:\n    ${link}\n`);
      } catch (e) {
        req.log.error({ email, err: e.message }, 'invite email failed to send');
      }
    }
    req.log.info({ applicationId: appn.id, customerId, email }, 'application approved → customer + editor created');
    logAudit(req, 'application.approve', { detail: { applicationId: appn.id, customerId, org: appn.org_name, email, quotaAreas: quota_areas, quotaPlaces: quota_places } });

    return {
      ok: true,
      customer: { id: customerId, name: appn.org_name, type, quotaAreas: quota_areas, quotaPlaces: quota_places },
      user: { email },
      inviteLink: DEV_LINKS ? link : undefined,
    };
  });

  app.post('/applications/:id/reject', async (req, reply) => {
    const appn = getApplication(Number(req.params.id));
    if (!appn) return reply.code(404).send({ ok: false, error: 'No such application.' });
    if (appn.status !== 'pending') return reply.code(409).send({ ok: false, error: `Already ${appn.status}.` });
    setApplicationReviewed(appn.id, 'rejected', null);
    req.log.info({ applicationId: appn.id }, 'application rejected');
    logAudit(req, 'application.reject', { detail: { applicationId: appn.id, org: appn.org_name } });
    return { ok: true };
  });

  // Map-request queue + lifecycle. Approving accepts the request (the central
  // pipeline builds the data later); rejecting archives it and frees the quota slot.
  //
  // `awaitingBuild` is the other half of that lifecycle: approved requests the
  // pipeline has yet to build. The importer fulfils one IN PLACE
  // (`import-map.mjs --request <id>`), so the placeholder row becomes the built map
  // — no duplicate row to archive, and quota counts the map once. Each row carries
  // the exact command, so the admin console is the single place the build starts.
  app.get('/map-requests', async (req, reply) => {
    const shape = (m) => ({
      id: m.id, name: m.name, slug: m.slug, kind: m.kind, subject: m.subject, requestNote: m.request_note,
      customer: m.customer_id ? { id: m.customer_id, name: m.customer_name } : null,
      requestedBy: m.requested_by_email || null, createdAt: m.created_at, status: m.status,
    });
    return {
      ok: true,
      requests: listMapsByStatus(['requested']).map(shape),
      awaitingBuild: listAwaitingBuild().map((m) => ({
        ...shape(m),
        importCommand: `node scripts/import-map.mjs --request ${m.id} --src "<S5-render dir>"`,
      })),
    };
  });

  app.post('/maps/:id/approve', async (req, reply) => {
    const m = getMap(Number(req.params.id));
    if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
    if (m.status !== 'requested') return reply.code(409).send({ ok: false, error: `This map is "${m.status}", not a pending request.` });
    setMapStatus(m.id, 'approved');
    req.log.info({ mapId: m.id }, 'map request approved');
    logAudit(req, 'maprequest.approve', { mapId: m.id, detail: { name: m.name, kind: m.kind } });
    return { ok: true, status: 'approved' };
  });

  // Archive a request. Valid for a request still pending AND for one already
  // approved but never built (plans change) — either way the quota slot is freed.
  // Once a map has been built it has renders and possibly a public page, so it
  // leaves this lifecycle: archiving it is not a request decision.
  app.post('/maps/:id/reject', async (req, reply) => {
    const m = getMap(Number(req.params.id));
    if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
    const unbuiltApproved = m.status === 'approved' && !m.current_version_id;
    if (m.status !== 'requested' && !unbuiltApproved) {
      return reply.code(409).send({
        ok: false,
        error: m.current_version_id
          ? `"${m.name}" has already been built (${m.cur_key}) — it is no longer a request.`
          : `This map is "${m.status}", not a pending or awaiting-build request.`,
      });
    }
    setMapStatus(m.id, 'archived');
    req.log.info({ mapId: m.id, from: m.status }, 'map request archived');
    logAudit(req, 'maprequest.reject', { mapId: m.id, detail: { name: m.name, kind: m.kind, from: m.status } });
    return { ok: true, status: 'archived' };
  });

  // WHO OWNS THIS MAP (OA-008, 2026-08-30).
  //
  // An unowned map is not a cosmetic gap: listPublicMaps and getPublicMapBySlug
  // both JOIN customer, deliberately — that is what makes a suspended
  // organisation's maps disappear — and the same join drops a map whose
  // customer_id is NULL however published it is. St Ives Bus Station was imported
  // without --customer, went right through submit → review → publish to v2.0,
  // reported status=published, public_listed=1, and served a 404.
  //
  // Until this route existed the repair was a hand-written UPDATE against the live
  // database. `user.reassign` had had an HTTP equivalent since P2; the map did
  // not. Step-up is required for the same reason it is on the user's role: this
  // moves an asset between tenants, and a stale cookie must not be enough.
  app.post('/maps/:id/owner', async (req, reply) => {
    const m = getMap(Number(req.params.id));
    if (!m) return reply.code(404).send({ ok: false, error: 'No such map.' });
    const b = req.body || {};
    if (!('customerId' in b)) return reply.code(400).send({ ok: false, error: 'customerId is required (null to un-own).' });
    if (!requireStepUp(req, reply, "changing which organisation owns a map")) return;

    let toId = null, to = null;
    if (b.customerId != null && b.customerId !== '') {
      to = getCustomer(Number(b.customerId));
      if (!to) return reply.code(404).send({ ok: false, error: 'No such organisation.' });
      toId = to.id;
    }
    if (toId === (m.customer_id ?? null)) {
      return reply.code(409).send({ ok: false, error: to ? `That map already belongs to "${to.name}".` : 'That map is already unowned.' });
    }

    // Quota is counted per organisation, so moving a map INTO one spends a slot
    // there. Refused rather than silently overspent — the same rule the map
    // request queue applies, applied at the other door into the same count.
    if (to) {
      const used = quotaUsage(to.id);
      const cap = m.kind === 'place' ? to.quota_places : to.quota_areas;
      const held = m.kind === 'place' ? used.place : used.area;
      if (cap != null && held >= cap) {
        return reply.code(409).send({
          ok: false, code: 'quota',
          error: `"${to.name}" already holds ${held} of ${cap} ${m.kind} maps. Raise their quota first.`,
        });
      }
    }

    const from = m.customer_id ? getCustomer(m.customer_id) : null;
    if (!setMapCustomer(m.id, toId)) return reply.code(500).send({ ok: false, error: 'The owner could not be set.' });
    bumpSearchIndex(); // the public queries' answer just changed in both directions
    req.log.info({ mapId: m.id, from: m.customer_id, to: toId }, 'map owner changed by admin');
    logAudit(req, 'map.reassign', {
      mapId: m.id,
      detail: {
        mapId: m.id, slug: m.slug, name: m.name, kind: m.kind,
        fromCustomerId: m.customer_id ?? null, fromCustomerName: from ? from.name : null,
        toCustomerId: toId, toCustomerName: to ? to.name : null,
      },
    });
    return { ok: true, map: { id: m.id, slug: m.slug, name: m.name }, customer: to ? { id: to.id, name: to.name } : null };
  });

  app.get('/customers', async (req, reply) => {
    const rows = listCustomersAdmin().map((c) => ({
      id: c.id, name: c.name, type: c.type, status: c.status, plan: c.plan,
      quotaAreas: c.quota_areas, quotaPlaces: c.quota_places,
      usedAreas: c.area_used, usedPlaces: c.place_used, users: c.users, createdAt: c.created_at,
      // P6 — where the organisation appears publicly, and how it has branded itself.
      slug: c.slug || null, publicUrl: c.slug ? orgPageUrl(c.slug) : null,
      branding: parseJson(c.branding_json),
      hideOperatorsEnabled: !!c.hide_operators_enabled,
      watermarkEnabled: !!c.watermark_enabled,
    }));
    return { ok: true, customers: rows };
  });

  app.patch('/customers/:id', async (req, reply) => {
    const cust = getCustomer(Number(req.params.id));
    if (!cust) return reply.code(404).send({ ok: false, error: 'No such customer.' });
    const b = req.body || {};
    // Quota and status are the two that decide how much of the service an
    // organisation gets and whether its maps stay public, so the whole route is
    // step-up gated rather than picking fields out of the body.
    if (!requireStepUp(req, reply, "changing an organisation's settings")) return;
    const ok = updateCustomerAdmin(cust.id, {
      quota_areas: b.quotaAreas, quota_places: b.quotaPlaces, status: b.status, plan: b.plan,
      hide_operators_enabled: b.hideOperatorsEnabled, watermark_enabled: b.watermarkEnabled,
    });
    if (!ok) return reply.code(400).send({ ok: false, error: 'Nothing valid to update.' });
    if (b.status !== undefined) bumpSearchIndex(); // P9 — a suspended org's maps must stop being searchable
    req.log.info({ customerId: cust.id }, 'customer updated by admin');
    const c = getCustomer(cust.id);
    logAudit(req, 'customer.update', { detail: { customerId: c.id, name: c.name, quotaAreas: c.quota_areas, quotaPlaces: c.quota_places, status: c.status, plan: c.plan, hideOperatorsEnabled: !!c.hide_operators_enabled, watermarkEnabled: !!c.watermark_enabled } });
    return { ok: true, customer: { id: c.id, name: c.name, status: c.status, plan: c.plan, quotaAreas: c.quota_areas, quotaPlaces: c.quota_places, hideOperatorsEnabled: !!c.hide_operators_enabled, watermarkEnabled: !!c.watermark_enabled } };
  });

  // User CRUD (admin-only). Invite adds another person to an existing customer
  // (or, with no customerId, a platform admin); update/disable are the same
  // PATCH — status:'disabled' is how an account is switched off, mirroring the
  // customer status pattern above. No delete: disabling is the reversible,
  // audit-preserving equivalent (history keeps referencing the row).
  //
  // Disabling REVOKES the account's live sessions, in the same request (OA-183).
  // It did not until 2026-08-30, and the console's own copy — "disabling is the
  // reversible, audit-preserving equivalent" of a delete — was true about the
  // record and silent about the credential.
  const userShape = (u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
    customerId: u.customer_id, customerName: u.customer_name || null, createdAt: u.created_at,
  });

  app.get('/users', async (req, reply) => {
    const q = req.query || {};
    const customerId = q.customerId != null && q.customerId !== '' ? Number(q.customerId) : undefined;
    return { ok: true, users: listUsersAdmin(customerId).map(userShape) };
  });

  app.post('/users', async (req, reply) => {
    const b = req.body || {};
    const email = str(b.email, 200).toLowerCase();
    if (!isEmail(email)) return reply.code(400).send({ ok: false, error: 'A valid email is required.' });
    if (getUserByEmail(email)) return reply.code(409).send({ ok: false, error: `${email} already has an account.` });

    let customerId = null;
    if (b.customerId != null && b.customerId !== '') {
      const cust = getCustomer(Number(b.customerId));
      if (!cust) return reply.code(404).send({ ok: false, error: 'No such customer.' });
      customerId = cust.id;
    }
    const role = ['editor', 'approver', 'admin'].includes(b.role) ? b.role : 'editor';

    const userId = insertUser({ customer_id: customerId, email, name: str(b.name, 120) || null, role });
    const token = requestMagicLink(email);
    const link = token ? authLink(req, token) : null;
    if (link) {
      try {
        const r = await sendMagicLink({ to: email, link, kind: 'invite' });
        if (!r.sent) console.log(`\n🔗  Invite (sign-in) link for ${email}:\n    ${link}\n`);
      } catch (e) {
        req.log.error({ email, err: e.message }, 'invite email failed to send');
      }
    }
    req.log.info({ userId, customerId, email, role }, 'user invited by admin');
    logAudit(req, 'user.invite', { detail: { userId, customerId, email, role } });
    return { ok: true, user: userShape(getUser(userId)), inviteLink: DEV_LINKS ? link : undefined };
  });

  app.patch('/users/:id', async (req, reply) => {
    const u = getUser(Number(req.params.id));
    if (!u) return reply.code(404).send({ ok: false, error: 'No such user.' });
    const b = req.body || {};
    if (b.status === 'disabled' && u.id === req.user.id) {
      return reply.code(400).send({ ok: false, error: 'You cannot disable your own account.' });
    }
    // Role is the privilege escalation path — `role: 'admin'` on this route is the
    // whole of it — so a stale cookie must not be enough to travel it.
    if (('role' in b || 'status' in b || 'customerId' in b) && !requireStepUp(req, reply, "changing a user's role or organisation")) return;
    let customerId; // undefined = leave alone
    if ('customerId' in b) {
      if (b.customerId == null || b.customerId === '') {
        customerId = null;
      } else {
        const cust = getCustomer(Number(b.customerId));
        if (!cust) return reply.code(404).send({ ok: false, error: 'No such customer.' });
        customerId = cust.id;
      }
    }
    const fromCustomer = u.customer_id ? getCustomer(u.customer_id) : null;
    const ok = updateUserAdmin(u.id, { name: b.name, role: b.role, status: b.status, customerId });
    if (!ok) return reply.code(400).send({ ok: false, error: 'Nothing valid to update.' });
    const updated = getUser(u.id);
    req.log.info({ userId: u.id }, 'user updated by admin');
    logAudit(req, 'user.update', { detail: { userId: u.id, email: updated.email, role: updated.role, status: updated.status, customerId: updated.customer_id } });

    // Switching an account off ends the sessions it is holding, here rather than
    // in a second step somebody has to remember on the day a person leaves a
    // customer badly (OA-183). The preHandler above would refuse each of those
    // sessions on its next use anyway; this closes the window now, and — the
    // reason it is worth both — it is what makes the count reportable, so the
    // admin sees "3 sessions signed out" instead of trusting that they will be.
    let revokedSessions = 0;
    if (updated.status !== 'active' && u.status === 'active') {
      revokedSessions = deleteSessionsForUser(u.id);
      req.log.info({ userId: u.id, revoked: revokedSessions }, 'sessions revoked because the account was switched off');
      logAudit(req, 'session.revoke-all', { detail: { userId: u.id, email: updated.email, revoked: revokedSessions, reason: `status set to ${updated.status}` } });
    }
    if (customerId !== undefined && customerId !== u.customer_id) {
      const toCustomer = customerId ? getCustomer(customerId) : null;
      req.log.info({ userId: u.id, from: u.customer_id, to: customerId }, 'user reassigned to another organisation by admin');
      logAudit(req, 'user.reassign', {
        detail: {
          userId: u.id, email: updated.email,
          fromCustomerId: u.customer_id, fromCustomerName: fromCustomer ? fromCustomer.name : null,
          toCustomerId: customerId, toCustomerName: toCustomer ? toCustomer.name : null,
        },
      });
    }
    return { ok: true, user: userShape(updated), revokedSessions };
  });

  app.get('/messages', async (req, reply) => {
    return { ok: true, messages: listMessages() };
  });

  app.post('/messages/:id/status', async (req, reply) => {
    const msg = getMessage(Number(req.params.id));
    if (!msg) return reply.code(404).send({ ok: false, error: 'No such message.' });
    const status = String((req.body || {}).status || '');
    if (!MSG_STATUSES.includes(status)) return reply.code(400).send({ ok: false, error: 'Unknown status.' });
    setMessageStatus(msg.id, status);
    req.log.info({ messageId: msg.id, status }, 'message status set');
    logAudit(req, 'message.status', { detail: { messageId: msg.id, status } });
    return { ok: true };
  });

  // Read-only view of the monthly-refresh queue (P5) — proposed updates awaiting a
  // customer's accept/decline. Staged by the central pipeline (propose-update.mjs).
  app.get('/proposed-updates', async (req, reply) => {
    const updates = listPendingProposedUpdates().map((pu) => ({
      id: pu.id, createdAt: pu.created_at, sourceNote: pu.source_note || '',
      summary: parseJson(pu.summary_json),
      map: { id: pu.map_id, name: pu.map_name, kind: pu.map_kind, subject: pu.map_subject },
      customer: pu.customer_name || null,
    }));
    return { ok: true, updates };
  });

  // One grouped "N maps published" email per customer, for a scripted batch that
  // published several maps with suppressNotify:true on each individual approve
  // (see the comment on /api/review/:id/approve). Never called by the UI — the
  // review screen always sends its own single notify('published', ...) inline.
  // Grouping happens HERE, server-side, so the digest wording and the recipient
  // lookup stay in one tested place (src/email/notify.js) rather than being
  // duplicated in a laptop script that has no access to EMAIL_PROVIDER anyway.
  // ---------------------------------------------------------------------------
  // Active sessions (technical-audit_2026-08-19 S5)
  //
  // There was no way to see who was signed in, and no way to end a session short
  // of waiting a month for it to expire — `purgeExpiredSessions` removes only the
  // already-dead. So a session token that escaped (a laptop, a backup, a file left
  // on disk) was a valid admin credential until its own clock ran out, and nobody
  // could do anything about it.
  //
  // Sessions are named by a HANDLE — the first 12 hex of the token's SHA-256 —
  // never by the token. See sessionHandle() in src/auth/index.js for why: a list of
  // live tokens is a list of accounts whoever holds it can become, and an admin
  // console is not a place to put those.
  // ---------------------------------------------------------------------------
  app.get('/sessions', async (req, reply) => {
    // The stored hash of MY session. The list holds hashes now (N3), so "current"
    // is a hash-to-hash comparison and no raw token is involved on either side.
    const mine = sessionTokenHash(req.user.sessionToken);
    return {
      ok: true,
      stepUpMinutes: STEP_UP_MINUTES,
      sessionDays: SESSION_DAYS,
      sessions: listSessions().map((r) => ({
        handle: handleFromHash(r.token_hash),
        current: r.token_hash === mine,
        user: { id: r.user_id, email: r.email, name: r.name, role: r.role, status: r.status },
        customer: r.customer_id ? { id: r.customer_id, name: r.customer_name } : null,
        signedInAt: r.created_at,
        expiresAt: r.expires_at,
        // expires_at is always exactly SESSION_DAYS after the last use, so it is
        // also the record of when that was — no extra column needed.
        lastSeenAt: new Date(new Date(`${String(r.expires_at).replace(' ', 'T')}Z`).getTime() - SESSION_DAYS * 86_400_000)
          .toISOString().slice(0, 19).replace('T', ' '),
      })),
    };
  });

  app.post('/sessions/:handle/revoke', async (req, reply) => {
    const handle = str(req.params.handle, 64);
    const row = listSessions().find((r) => handleFromHash(r.token_hash) === handle);
    if (!row) return reply.code(404).send({ ok: false, error: 'No such live session (it may already have expired).' });
    const self = row.token_hash === sessionTokenHash(req.user.sessionToken);
    deleteSessionByHash(row.token_hash);
    req.log.info({ handle, userId: row.user_id, self }, 'session revoked by admin');
    logAudit(req, 'session.revoke', { detail: { handle, userId: row.user_id, email: row.email, self } });
    // Revoking your own session really does sign you out — clear the cookie so
    // the browser stops presenting a token the server has already forgotten.
    if (self) reply.header('Set-Cookie', clearCookie({ secure: isHttps(req) }));
    return { ok: true, self };
  });

  // The one to reach for when a credential has leaked rather than when a laptop
  // has been lost: every session that user holds, everywhere, gone at once.
  app.post('/users/:id/revoke-sessions', async (req, reply) => {
    const u = getUser(Number(req.params.id));
    if (!u) return reply.code(404).send({ ok: false, error: 'No such user.' });
    const n = deleteSessionsForUser(u.id);
    req.log.info({ userId: u.id, revoked: n }, 'all sessions revoked for user by admin');
    logAudit(req, 'session.revoke-all', { detail: { userId: u.id, email: u.email, revoked: n } });
    const self = u.id === req.user.id;
    if (self) reply.header('Set-Cookie', clearCookie({ secure: isHttps(req) }));
    return { ok: true, revoked: n, self };
  });

  app.post('/notify-published-batch', async (req, reply) => {
    const items = Array.isArray((req.body || {}).items) ? (req.body || {}).items : [];
    const byCustomer = new Map();
    for (const it of items) {
      if (it == null || it.customerId == null || !it.mapName || !it.mapUrl) continue;
      if (!byCustomer.has(it.customerId)) byCustomer.set(it.customerId, []);
      byCustomer.get(it.customerId).push({ mapName: it.mapName, versionKey: it.versionKey, mapUrl: it.mapUrl });
    }
    const results = [];
    for (const [customerId, maps] of byCustomer) {
      const r = await notify('published-batch', { customerId, maps, log: req.log });
      results.push({ customerId, maps: maps.length, ...r });
    }
    req.log.info({ customers: results.length, items: items.length }, 'published-batch digest sent');
    return { ok: true, results };
  });

  // Operational snapshot (P7): readiness, disk usage per map, and the counts an
  // operator watches. Same numbers as /metrics, shaped for the admin console.
  app.get('/ops', async (req, reply) => {
    return { ok: true, ops: await opsSnapshot(APP_VERSION) };
  });

  // Append-only governance audit trail (publish reviews + P3 actions).
  app.get('/audit', async (req, reply) => {
    const limit = Math.max(1, Math.min(1000, Number((req.query || {}).limit) || 200));
    const rows = listAudit({ limit }).map((a) => ({
      id: a.id, at: a.created_at, actor: a.actor_email || 'system', action: a.action,
      mapId: a.map_id, mapName: a.map_name || null, versionId: a.version_id,
      detail: parseJson(a.detail_json),
    }));
    return { ok: true, audit: rows };
  });
}
