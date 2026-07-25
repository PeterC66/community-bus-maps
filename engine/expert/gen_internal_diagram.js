// Portal wrapper for the TUBE-MAP DIAGRAM output (P7).
//
// Same shape as gen_internal_schematic.js (see that file's header for why the
// wrapper is needed at all — artefact naming, a loud failure when the map has no
// `internalDiagram` config, and unsetting LEAFLET_DIR so the pre-stage's child
// render reads the WORKSPACE and not the parent data folder).
//
// The diagram engine differs from the schematiser in one way that matters here:
// it honours **diagram-layout.json** (the expert's hand-placed junction pins) from
// the map's data folder, re-resolving a pin by its stored lat/lon when a data
// refresh changes a node key. That file is what the portal's expert pin editor
// writes (/app/maps/:id/diagram, admin-only), so a saved layout is picked up by
// every later render — including a monthly refresh — without any extra plumbing.
//
// The pre-stage itself (diagram_internal.js) is vendored UNCHANGED beside this
// file — see engine/expert/README.md.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = process.env.LEAFLET_DIR || process.cwd();
const PRESTAGE = path.join(__dirname, 'diagram_internal.js');
const OUT = 'internal-diagram.svg';

const rj = JSON.parse(fs.readFileSync(path.join(DIR, 'routes.json'), 'utf8'));
if (!rj.internalDiagram) {
  console.error('this map has no "internalDiagram" config — the diagram output is not available for it');
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
  console.error(`diagram_internal.js finished but wrote no ${OUT}`);
  process.exit(1);
}
process.stdout.write((res.stdout || '').trim());
