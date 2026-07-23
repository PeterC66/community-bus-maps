// Audit trail (P4). One tiny helper so every governance action records who did
// what, when, against which map/version — append-only, never mutated.

import { recordAudit } from '../db/index.js';

/**
 * Log a governance action attributed to the signed-in user on `req`.
 * @param {object} req    Fastify request (req.user may be null for anon/system)
 * @param {string} action dotted verb, e.g. 'version.publish', 'application.approve'
 * @param {object} [fields] { mapId, versionId, detail }
 */
export function logAudit(req, action, { mapId, versionId, detail } = {}) {
  const u = (req && req.user) || null;
  try {
    recordAudit({
      actorId: u ? u.id : null,
      actorEmail: u ? u.email : null,
      action,
      mapId,
      versionId,
      detail,
    });
  } catch (e) {
    // Auditing must never break the action it records; log and carry on.
    if (req && req.log) req.log.warn({ err: e, action }, 'audit write failed');
  }
}
