// Read structure out of ./Caddyfile — the site blocks, their addresses, and
// which of them import a given snippet.
//
// WHY THIS IS A MODULE. scripts/deploy-caddy.mjs used to find the public
// hostname with one line: "the first non-comment line ending in `{`". That was
// true for as long as the file held exactly one site block and nothing else.
// The 2026-08-31 change (buses-data OA-006/OA-172) added a `(access_log)`
// snippet definition ABOVE the site block and a second block for www, and a
// snippet definition is a non-comment line ending in `{` — so the old line would
// have reported the public hostname as `(access_log)` and every verification
// downstream of it would have been asked of a hostname that does not exist.
//
// Nothing caught that by reasoning; it was caught by asking what the deploy
// script reads before editing the file it reads. The parse now lives here so a
// test can drive it against text, rather than being a regex inside a script
// whose top level connects to a live host.
//
// This is deliberately NOT a Caddyfile parser. It knows three things — comments
// start with `#`, a snippet's address starts with `(`, and a block opens with a
// line ending in `{` — which is all this repository's Caddyfile has ever used,
// and it refuses rather than guesses when it sees something else.

/** One site block: its address list, and the snippet names it imports. */
export function siteBlocks(text) {
  const out = [];
  let depth = 0;
  let current = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (depth === 0 && line.endsWith('{')) {
      const addr = line.slice(0, -1).trim();
      depth = 1;
      // A snippet definition is `(name) {`. It is not a site.
      current = addr.startsWith('(') ? null : { addresses: addr.split(',').map((s) => s.trim()).filter(Boolean), imports: [], body: [] };
      continue;
    }
    if (depth === 0) continue;
    // Inside a block. Track nesting so a nested `}` does not close the site.
    if (line.endsWith('{')) { depth++; if (current) current.body.push(line); continue; }
    if (line === '}') {
      depth--;
      if (depth === 0) { if (current) out.push(current); current = null; }
      else if (current) current.body.push(line);
      continue;
    }
    if (!current) continue;
    current.body.push(line);
    if (line.startsWith('import ')) current.imports.push(line.slice(7).trim());
  }
  return out;
}

/**
 * The public hostname: the first address of the first SITE block.
 * Returns null when the file holds no site block at all.
 */
export function primaryHost(text) {
  const blocks = siteBlocks(text);
  return blocks.length ? blocks[0].addresses[0] : null;
}
