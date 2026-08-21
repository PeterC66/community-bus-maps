// Is email actually working? (technical-audit_2026-08-19 O4)
//
// THE BUG THIS EXISTS TO CLOSE. `/api/auth/request` used to read:
//
//     const r = await sendMagicLink({ to: email, link, kind: 'signin' });
//     if (r.sent) { … } else { console.log(`🔗  Sign-in link for ${email}: …`); }
//     } catch (e) { req.log.error({ email, err: e.message }, '…failed to send'); }
//     return { ok: true, message: 'If that address is registered, a sign-in link has been sent.' };
//
// `sendMagicLink` returns `{sent:false}` only when EMAIL_PROVIDER is UNSET. If
// the provider IS set and then throws — bad key, Resend outage, suspended
// sending domain — the catch logged it and the caller was still told a link had
// been sent. Nobody could sign in, and nothing anywhere surfaced it. The laptop
// `.env` was in exactly that state on the day of the audit: EMAIL_PROVIDER set,
// RESEND_API_KEY absent, so every attempt threw.
//
// Two things follow, and they are deliberately kept apart.
//
// CONFIGURATION is checked in readiness() — `configStatus()` below. It is
// deterministic, needs no network, and cannot flap. A provider named but with
// no key is a fault whether or not anyone has tried to sign in yet.
//
// DELIVERY OUTCOMES are counted here and surfaced on the admin worklist, NOT in
// readiness. That is on purpose: `/health?deep=1` drives the external uptime
// alert (O2), and a third party's brief outage should not page someone about the
// site being down — the site is not down, sign-in is. Consecutive failures are
// worth a worklist row and worth refusing new sign-in attempts; they are not
// worth an alarm at 3am about the wrong thing.
//
// The counters are in memory. A restart forgets them, which is the correct
// trade here: persisting them means another ad-hoc migration (audit O5) to
// record something whose whole value is "right now", and the configuration half
// — the part that survives a restart as a real fault — is already covered by
// readiness().

/** Providers and the environment variable each one cannot work without. */
const REQUIRED_KEY = { resend: 'RESEND_API_KEY' };

const state = {
  consecutiveFailures: 0,
  lastError: null,
  lastErrorAt: null,
  lastSentAt: null,
  totalSent: 0,
  totalFailed: 0,
};

/**
 * How many consecutive failures before sign-in requests are refused outright.
 *
 * One is too few: the failure of a single send is also how an anti-enumeration
 * response is kept honest (see the note in server.js), and a solitary transient
 * should not lock the door. Three consecutive failures with no success between
 * them is not a transient.
 */
export const FAILURE_THRESHOLD = 3;

export function recordSendSuccess() {
  state.consecutiveFailures = 0;
  state.lastError = null;
  state.lastErrorAt = null;
  state.lastSentAt = new Date().toISOString();
  state.totalSent += 1;
}

export function recordSendFailure(err) {
  state.consecutiveFailures += 1;
  state.lastError = String((err && err.message) || err || 'unknown error');
  state.lastErrorAt = new Date().toISOString();
  state.totalFailed += 1;
}

/** Test seam only — nothing in the running server calls this. */
export function resetEmailHealth() {
  state.consecutiveFailures = 0;
  state.lastError = null;
  state.lastErrorAt = null;
  state.lastSentAt = null;
  state.totalSent = 0;
  state.totalFailed = 0;
}

/**
 * Configuration verdict. No network, no side effects.
 *
 * `{ ok, provider, mode, error? }` where mode is one of:
 *   'dev-console'  no provider: links are printed to the server console. Fine in
 *                  development, a fault in production — a production deployment
 *                  that cannot email is a deployment nobody can sign in to.
 *   'provider'     a provider is configured and its key is present.
 */
export function configStatus({ env = process.env } = {}) {
  const provider = env.EMAIL_PROVIDER || '';
  const production = env.NODE_ENV === 'production';

  if (!provider) {
    return production
      ? { ok: false, provider: null, mode: 'dev-console', error: 'EMAIL_PROVIDER is not set, so sign-in links are only printed to the server console. Nobody can sign in to this deployment.' }
      : { ok: true, provider: null, mode: 'dev-console' };
  }
  const keyName = REQUIRED_KEY[provider];
  if (!keyName) {
    return { ok: false, provider, mode: 'provider', error: `Unknown EMAIL_PROVIDER "${provider}" — supported: ${Object.keys(REQUIRED_KEY).join(', ')}` };
  }
  if (!env[keyName]) {
    return { ok: false, provider, mode: 'provider', error: `EMAIL_PROVIDER=${provider} but ${keyName} is not set, so every send throws.` };
  }
  return { ok: true, provider, mode: 'provider' };
}

/** Configuration verdict plus the delivery counters. Read by ops and the worklist. */
export function emailHealth({ env = process.env } = {}) {
  const cfg = configStatus({ env });
  return {
    ...cfg,
    consecutiveFailures: state.consecutiveFailures,
    failing: state.consecutiveFailures >= FAILURE_THRESHOLD,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    lastSentAt: state.lastSentAt,
    totalSent: state.totalSent,
    totalFailed: state.totalFailed,
  };
}

/**
 * Should a new sign-in request even be attempted?
 *
 * False when the configuration is broken, or when the provider has failed
 * FAILURE_THRESHOLD times in a row with no success since. The caller turns this
 * into a 503 with an honest message, for EVERY caller — which is what keeps it
 * free of address enumeration: the answer does not depend on whether the address
 * is registered.
 */
export function signInSendable({ env = process.env } = {}) {
  const cfg = configStatus({ env });
  if (!cfg.ok) return { ok: false, reason: cfg.error };
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    return { ok: false, reason: `The email provider has failed ${state.consecutiveFailures} times in a row (last: ${state.lastError}).` };
  }
  return { ok: true };
}
