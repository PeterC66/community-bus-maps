// The one argument reader for `scripts/`.
//
// OA-224 Tier 3.3. Fourteen scripts each carried their own three-line `arg` and
// `has`, in four spellings — some over `process.argv`, some over
// `process.argv.slice(2)`, one returning `null` where the rest return
// `undefined`, and one guarding against the next token being another flag while
// the rest did not. Each copy is trivial. The cost is that the guard exists in
// one of them and not the other thirteen.
//
// THE ONE BEHAVIOUR CHANGE, made deliberately. The majority body was
// `i >= 0 && i + 1 < argv.length ? argv[i + 1] : def`, which reads the next token
// whatever it is — so `--note --quiet` set the note to the string `"--quiet"`
// AND lost `--quiet`, silently, on scripts that write to the VPS. The shared
// reader takes `personal-data.mjs`'s stricter rule: a value must be present and
// must not itself start with `--`, otherwise the default stands. That is also
// the rule `make-bus-leaflet/assets/cli.js` uses, so the two repositories agree
// about what a flag is. The cost is a value that legitimately begins with `--`,
// which no caller in this repository passes; `argAllowingDashes` is there for
// the day one does, rather than a second copy of the reader.
//
// Exit codes are the ones `docs/CONVENTIONS.md` states: 0 ok, 1 the thing failed,
// 2 the script was used wrongly, 3 the input is not the shape it claims.
import process from 'node:process';

/** The value after `--name`, or `def` when the flag is absent or valueless. */
export function arg(name, def = undefined, argv = process.argv) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v !== undefined && !v.startsWith('--') ? v : def;
}

/** The value after `--name`, even when it starts with `--`. Use only where a
 *  value legitimately looks like a flag; `arg` is what you want. */
export function argAllowingDashes(name, def = undefined, argv = process.argv) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}

/** Is `--name` present? */
export function has(name, argv = process.argv) {
  return argv.includes(`--${name}`);
}

/** All the values given for a repeatable flag, in order. */
export function all(name, argv = process.argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== `--${name}`) continue;
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith('--')) out.push(v);
  }
  return out;
}

/** Refuse: the message on stderr, and exit 2 (used wrongly) unless told otherwise. */
export function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

/*
 * confirm — the "really do it" vocabulary, in one place, so a script cannot
 * invent a fifth. `docs/CONVENTIONS.md` settles which of the two a script gets:
 *
 *   local  — reports by default, writes only on `--apply`.
 *   remote — anything reaching the VPS or the live site DOES it by default, so
 *            the safety has to be the confirmation: `--yes` to proceed,
 *            `--dry-run` to see what would happen.
 *
 * Returns `{ apply, dryRun }` for either kind, so the caller reads one shape.
 */
export function confirm(kind, argv = process.argv) {
  if (kind === 'local') {
    const apply = has('apply', argv);
    return { apply, dryRun: !apply };
  }
  if (kind === 'remote') {
    const dryRun = has('dry-run', argv);
    return { apply: !dryRun, dryRun, confirmed: has('yes', argv) };
  }
  throw new Error(`confirm(): kind must be 'local' or 'remote', got ${JSON.stringify(kind)}`);
}
