// Portal wrapper for the OCTOLINEAR SCHEMATIC output (P7).
//
// The schematiser is a GEOMETRY PRE-STAGE, not a second renderer: it rewrites the
// map's geometry into a workspace subfolder ("schematic/") as pseudo lat/lon and
// then runs the map's OWN gen_internal.js in there, so badges, labels, the
// Services panel and POI icons are reused verbatim. This wrapper exists only to
// make that two-step behave like every other portal generator:
//
//   • it is named for its artefact (renderMap.js maps it to internal-schematic.svg),
//   • it fails loudly when the map has no `internalSchematic` config, instead of
//     the pre-stage's "nothing to do" exit 0 (which would leave no SVG to copy),
//   • **it unsets LEAFLET_DIR for the child.** The portal always sets LEAFLET_DIR
//     to the map's data folder; the pre-stage spawns gen_internal with cwd = the
//     WORKSPACE and inherits the environment, so an inherited LEAFLET_DIR would
//     send that render back to the parent folder and silently reproduce the
//     ordinary geographic map. Everything else (SKILL_ASSETS for icons.js,
//     OVERRIDES_FILE for the customer's recolours/POI hides) is passed straight
//     through, so a customer's safe-subset edits apply to this output too.
//
// The pre-stage itself (schematize_internal.js) is vendored UNCHANGED beside this
// file — see engine/expert/README.md.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = process.env.LEAFLET_DIR || process.cwd();
const PRESTAGE = path.join(__dirname, 'schematize_internal.js');
const OUT = 'internal-schematic.svg';

const rj = JSON.parse(fs.readFileSync(path.join(DIR, 'routes.json'), 'utf8'));
if (!rj.internalSchematic) {
  console.error('this map has no "internalSchematic" config — the schematic output is not available for it');
  process.exit(2);
}

const env = { ...process.env };
delete env.LEAFLET_DIR; // the pre-stage uses cwd; its child must see the workspace

const res = spawnSync(process.execPath, [PRESTAGE], {
  cwd: DIR, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
if (res.status !== 0) {
  process.stderr.write(res.stderr || res.stdout || '(no output)');
  process.exit(res.status || 1);
}
if (!fs.existsSync(path.join(DIR, OUT))) {
  console.error(`schematize_internal.js finished but wrote no ${OUT}`);
  process.exit(1);
}
process.stdout.write((res.stdout || '').trim());
