// The laptop's private map tree cannot be seen by the server — it needs live
// network, an LLM and judgement to build a map, which is exactly what the
// portal must never do (see CLAUDE.md: determinism, no network at render
// time). So engine/S6/gate staleness can only ever be PUSHED in, not computed
// here. This module just stores whatever `push-status.mjs` last sent and hands
// it back to src/worklist/index.js — one file under DATA_DIR, one snapshot,
// overwritten each push. No history; the worklist only ever cares "is it
// wrong right now".
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db/index.js';

const FILE = path.join(DATA_DIR, 'status-snapshot.json');

export function saveStatusSnapshot(payload) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ receivedAt: new Date().toISOString(), ...payload }, null, 2));
}

// Absent or corrupt ⇒ null. Callers treat that exactly like "nobody has
// pushed yet" — ranks 0 and 8 stay empty, same as before this file existed.
export function loadStatusSnapshot() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return null; }
}
