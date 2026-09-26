// track-live.mjs — deploy.mjs step 5b: bring the LIVE store's map packs up to
// the engine the deploy just shipped, then read the store back (buses-data
// OA-130 decided TRACK, not freeze; docs/DEPLOY.md §4a says why the live store
// is the only one whose answer counts).
//
// WHY THE DEPLOY DOES THIS AND NOBODY ELSE DOES. A map's data pack carries its
// own copy of the generators and `generateSvg()` runs THAT copy, so a deployed
// re-vendor reaches no map already in the store until `track-engine.mjs --apply`
// has run on the host. Until 2026-09-26 that was two raw `ssh` commands only
// Peter could run — the auto-mode classifier refuses a raw `ssh` to a session —
// and nothing on the bus-work board said when a run was owed. Five re-vendors
// (#373, #381, #384, #386, #389, 25–26 Sep 2026) were waiting at once when that
// was noticed. `npm run deploy` is the one route to the host a session is
// allowed, and every re-vendor goes live through it, so this is where the step
// belongs: it is owed by exactly the event that runs it.
//
// It runs on EVERY deploy, not only after a re-vendor. On a deploy that moved no
// engine file it copies nothing and reports "0 BEHIND", which costs one
// `docker compose exec`; deciding whether a deploy "was a re-vendor" would be a
// second answer to a question the script already asks of the files themselves.
//
// APPLY, THEN READ BACK. The verdict is the exit code of the SECOND, report-only
// run, because that run is a read of the store after the write — not the absence
// of an error from the write. track-engine.mjs's report form exits non-zero while
// any pack is BEHIND or any row is a `?` finding (a pack naming a generator this
// engine does not vendor, or a declaration that will not parse); `--apply` fixes
// the first and never the second. A `·` row — the pack does not record which
// external generator it came from, so it is left alone rather than guessed — is
// printed and is not a failure, exactly as in the script itself.
//
// Nothing is re-rendered and no published byte changes; what changes is the NEXT
// render of each map.

export const TRACK_APPLY = 'node scripts/track-engine.mjs --apply';
export const TRACK_REPORT = 'node scripts/track-engine.mjs';

/**
 * @param {object} o
 * @param {string} o.appDir          the directory on the host holding compose.yaml
 * @param {(remote: string) => number} o.sshRun  runs one remote command, returns its exit status
 * @returns {{ ok: boolean, applyStatus: number, reportStatus: number|null, message: string }}
 */
export function trackLiveStore({ appDir, sshRun }) {
  const exec = (cmd) => `cd ${appDir} && docker compose exec -T portal ${cmd}`;

  const applyStatus = sshRun(exec(TRACK_APPLY));
  // An ssh or docker failure (255, 125–127) means the store was never reached,
  // and a report run would fail the same way; say which it was rather than
  // reading an unreachable store as a behind one.
  if (applyStatus !== 0 && applyStatus !== 1) {
    return {
      ok: false, applyStatus, reportStatus: null,
      message: `track-engine --apply did not run on the host (exit ${applyStatus}) — the live store was not reached, so nothing is known about it.`,
    };
  }

  const reportStatus = sshRun(exec(TRACK_REPORT));
  if (reportStatus === 0) {
    return {
      ok: true, applyStatus, reportStatus,
      message: 'every tracked pack in the live store matches the engine just deployed.',
    };
  }
  return {
    ok: false, applyStatus, reportStatus,
    message: reportStatus === 1
      ? 'the live store still has a pack BEHIND or a `?` row after --apply (read the report above). '
        + 'A `?` is a pack naming a generator this engine does not vendor, or an engine-source.json that '
        + 'will not parse; --apply cannot fix either (docs/DEPLOY.md §4a).'
      : `the read-back did not run on the host (exit ${reportStatus}), so the write above is unconfirmed.`,
  };
}
