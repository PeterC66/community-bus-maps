#!/usr/bin/env node
// Who has used the portal lately, and what they did — one reader, read-only.
//
//   node scripts/activity-report.mjs               the last 28 days, one block per person
//   node scripts/activity-report.mjs --days 90     a longer window
//   node scripts/activity-report.mjs --json        the same figures as JSON
//
// Run it from the repository root (`C:\Claude\community-bus-maps`). There are no
// placeholders in those commands, and `--days` takes a whole number of days. It
// reads DATA_DIR's database, so the answer about busmaps.uk comes from the VPS,
// not from a laptop whose database is seeded with demo accounts that read like
// real customers. From the laptop, with no placeholders:
//
//   npm --prefix "C:/Claude/community-bus-maps" run ssh -- "docker compose exec -T portal node scripts/activity-report.mjs"
//
// WHY IT EXISTS. Asked on 2026-09-25 — "who, apart from me, has accessed the
// portal in the past four weeks, and what did they do?" — and answered with a
// query piped into the container by hand. This is that query, kept.
//
// WHAT COUNTS AS A SIGN-IN, and why it is not the `session` table. Sessions are
// deleted when they expire (the server purges hourly) and when somebody signs
// out, so a count of session rows is a count of sessions STILL OPEN, and it
// under-reports anyone who signed in more than a few days ago. A magic link is
// kept with its `used_at` stamp, so a USED link is the durable record of a
// sign-in, and a requested-but-unused one is somebody who was sent a link and
// never followed it. Emails that requested a link but hold no account are
// listed too.
//
// WHAT IT CANNOT SEE. The audit log records CHANGES — saves, submits, publishes,
// grants — not page views. "No actions" means nothing was changed, never that
// nothing was looked at; and nothing here says who read the public site, whose
// visitors are not signed in and whose addresses Caddy masks.
//
// THIS PRINTS PERSONAL DATA — names and email addresses of real people — to
// stdout. Read it; do not paste it into a file under git (buses-data keeps
// correspondents' details only in its gitignored `_people.local.json`).
//
// Exit codes follow docs/CONVENTIONS.md: 0 printed, 2 used wrongly, 3 no
// database at DB_PATH.

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../src/db/paths.js';
import { arg, has, die } from './lib/cli.mjs';

const KNOWN = ['--days', '--json'];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--days') { i++; continue; }
  if (!KNOWN.includes(argv[i])) die(`activity-report: unknown flag ${argv[i]}. Known flags: --days <n> --json`);
}
const days = Number(arg('days', '28'));
if (!Number.isInteger(days) || days < 1) die('activity-report: --days needs a whole number of days, 1 or more.');
if (!existsSync(DB_PATH)) die(`activity-report: no database at ${DB_PATH}.`, 3);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const since = db.prepare('SELECT datetime(\'now\', ?) AS s').get(`-${days} days`).s;
const all = (sql, ...p) => db.prepare(sql).all(...p);
const key = (e) => String(e || '').trim().toLowerCase();
const oneLine = (t, n = 160) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

const accounts = all(`SELECT u.id, u.email, u.name, u.role, u.status, u.created_at, c.name AS org, c.is_demo
  FROM user u LEFT JOIN customer c ON c.id = u.customer_id ORDER BY u.id`);
const links = all(`SELECT email, COUNT(*) AS requested, SUM(used_at IS NOT NULL) AS used, MAX(used_at) AS lastSignIn
  FROM magic_link WHERE created_at >= ? GROUP BY lower(email)`, since);
const actions = all(`SELECT a.actor_email AS email, a.action, COUNT(*) AS n, MAX(a.created_at) AS last,
  GROUP_CONCAT(DISTINCT COALESCE(m.name, json_extract(a.detail_json, '$.name'))) AS maps
  FROM audit_log a LEFT JOIN map m ON m.id = a.map_id
  WHERE a.created_at >= ? GROUP BY a.actor_email, a.action ORDER BY last DESC`, since);
const applications = all(`SELECT created_at, org_name, contact_name, email, status FROM application
  WHERE created_at >= ? ORDER BY created_at`, since);
const messages = all(`SELECT m.created_at, m.kind, m.name, m.email, m.status, mp.name AS map, substr(m.body, 1, 400) AS body
  FROM message m LEFT JOIN map mp ON mp.id = m.map_id WHERE m.created_at >= ? ORDER BY m.created_at`, since);

// One entry per email address, whichever table it turned up in first.
const people = new Map();
const person = (email) => {
  const k = key(email);
  if (!people.has(k)) people.set(k, { email, account: null, signIns: null, actions: [], applications: [], messages: [] });
  return people.get(k);
};
for (const a of accounts) person(a.email).account = a;
for (const l of links) person(l.email).signIns = { requested: l.requested, used: l.used, last: l.lastSignIn };
const tools = [];
for (const a of actions) {
  // `cli:<script>` and a NULL actor are the system and the command line, not a person.
  if (!a.email || a.email.startsWith('cli:')) tools.push(a);
  else person(a.email).actions.push(a);
}
for (const a of applications) person(a.email).applications.push(a);
for (const m of messages) if (m.email) person(m.email).messages.push(m);
const anonymousMessages = messages.filter((m) => !m.email);

const active = (p) => p.signIns || p.actions.length || p.applications.length || p.messages.length;
const list = [...people.values()];
const report = {
  db: DB_PATH, days, since,
  people: list.filter(active),
  quiet: list.filter((p) => !active(p)).map((p) => p.email),
  commandLine: tools,
  anonymousMessages,
};

if (has('json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`Portal activity since ${since} UTC (${days} days) — ${DB_PATH}`);
console.log('Actions are changes, not page views: "no actions" does not mean nothing was looked at.\n');
for (const p of report.people) {
  const a = p.account;
  const who = a
    ? `${a.name || '(no name)'} <${p.email}> — ${a.role}${a.org ? `, ${a.org}${a.is_demo ? ' [DEMO]' : ''}` : ''}${a.status !== 'active' ? `, ${a.status}` : ''}; account since ${a.created_at.slice(0, 10)}`
    : `<${p.email}> — no account`;
  console.log(who);
  const s = p.signIns;
  if (s) console.log(`  sign-in links: ${s.requested} sent, ${s.used} used${s.last ? `, last sign-in ${s.last}` : ' — never signed in'}`);
  else if (a) console.log('  sign-in links: none sent in this window');
  if (a && !p.actions.length) console.log('  actions: none');
  for (const x of p.actions) console.log(`  ${x.action} ×${x.n}, last ${x.last}${x.maps ? ` — ${x.maps}` : ''}`);
  for (const x of p.applications) console.log(`  applied ${x.created_at}: ${x.org_name} (${x.contact_name}) — ${x.status}`);
  for (const x of p.messages) console.log(`  wrote ${x.created_at} (${x.kind}${x.map ? `, about ${x.map}` : ''}, ${x.status}): ${oneLine(x.body)}`);
  console.log('');
}
if (!report.people.length) console.log('Nobody used the portal in this window.\n');
if (tools.length) {
  console.log('Command line and system:');
  for (const x of tools) console.log(`  ${x.email || '(system)'} ${x.action} ×${x.n}, last ${x.last}${x.maps ? ` — ${x.maps}` : ''}`);
  console.log('');
}
for (const m of anonymousMessages) console.log(`Unsigned message ${m.created_at} (${m.kind}): ${oneLine(m.body)}`);
if (report.quiet.length) console.log(`No activity in this window: ${report.quiet.join(', ')}`);
