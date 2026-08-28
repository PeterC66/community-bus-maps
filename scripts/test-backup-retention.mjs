// Backup retention (src/ops/backup-retention.js).
//
// RUN IT FROM: the repository root, C:\Claude\community-bus-maps
//
//   node scripts/test-backup-retention.mjs
//
// It takes no arguments and reads nothing off disk — every case below is a list
// of fabricated folder names and a fixed `now`, so the result cannot depend on
// what the machine happens to hold or on what day it is run.
//
// The last case is the one that matters. It is not a test of the new rule at
// all: it re-implements the OLD rule (slice the newest 14) over the same names
// and asserts the two DISAGREE. Without it every case here would still pass if
// someone quietly restored the count-only behaviour, because most days the two
// rules agree — 2026-08-27 was not most days.

import { planRetention, parseSnapshotTime } from '../src/ops/backup-retention.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `\n    ${detail}`}`);
  if (!ok) failures++;
};

const at = (day, hhmmss) => `2026-08-${String(day).padStart(2, '0')}T${hhmmss}`;
const nightly = (day) => at(day, '03-15-02');

// --- the names are parsed, not trusted -------------------------------------
check('a snapshot name parses to its UTC instant',
  parseSnapshotTime('2026-08-28T03-15-02').toISOString() === '2026-08-28T03:15:02.000Z',
  parseSnapshotTime('2026-08-28T03-15-02')?.toISOString());
check('a non-snapshot name parses to null', parseSnapshotTime('cron.log') === null);
check('a near-miss name parses to null', parseSnapshotTime('2026-08-28T03-15') === null);

// --- 1. the incident: a day of manual backups must not evict the fortnight ---
// Twelve runs on the 27th, as actually happened, on top of a fortnight of
// nightlies. `now` is the morning of the 28th.
{
  const burst = ['12-48-05', '13-12-52', '14-15-39', '15-20-46', '15-32-33', '15-46-46',
                 '16-12-55', '19-03-36', '23-09-55', '23-58-55'].map((t) => at(27, t));
  const names = [
    ...Array.from({ length: 14 }, (_, i) => nightly(13 + i)), // 13th .. 26th
    ...burst,
    at(28, '01-18-17'), at(28, '03-15-02'), at(28, '13-29-23'),
  ];
  const now = new Date('2026-08-28T14:00:00Z');
  const { keep, prune } = planRetention(names, { now, keepDays: 14, keepAll: 7, keepRecentHours: 48 });

  check('the 14-day window survives a day of manual backups',
    keep.includes(nightly(15)) && keep.includes(nightly(20)) && keep.includes(nightly(26)),
    `kept: ${keep.join(' ')}`);
  // On the morning after, the whole of the 27th is still inside the 48-hour
  // window and every one of those twelve runs is kept — deliberately: that is
  // the day whose deploy is still being judged.
  check('the day just gone is kept whole while it is still recent',
    keep.filter((n) => n.startsWith('2026-08-27')).length === burst.length,
    `27th kept: ${keep.filter((n) => n.startsWith('2026-08-27')).join(' ')}`);

  // Once the 27th has left both the recent window AND the floor of newest
  // snapshots, the thinning that bounds disk use bites: one survives for that
  // day, the newest. Nightlies for the 29th to the 31st push it past the floor,
  // which is what the extra days below are for — with only the names above, the
  // floor of 7 legitimately still holds four of the burst and the thinning
  // never gets a look at them.
  {
    const onwards = [...names, nightly(29), nightly(30), nightly(31)];
    const later = planRetention(onwards, {
      now: new Date('2026-09-02T14:00:00Z'), keepDays: 14, keepAll: 7, keepRecentHours: 48,
    });
    const kept27 = later.keep.filter((n) => n.startsWith('2026-08-27'));
    check('once past the recent window and the floor, the burst thins to one for the day',
      kept27.length === 1 && kept27[0] === at(27, '23-58-55'), `27th kept: ${kept27.join(' ')}`);
    check('thinning a burst does not touch that day\'s neighbours',
      later.keep.includes(nightly(26)) && later.keep.includes(at(28, '13-29-23')),
      `kept: ${later.keep.join(' ')}`);
  }

  check('everything in the last 48 hours is kept',
    keep.includes(at(28, '01-18-17')) && keep.includes(at(28, '13-29-23')) && keep.includes(at(27, '19-03-36')),
    `kept: ${keep.join(' ')}`);
  check('nothing inside the window is pruned for being surplus to a count',
    !prune.includes(nightly(16)), `pruned: ${prune.join(' ')}`);

  // THE CONTROL. The old rule kept the newest 14 names and deleted the rest.
  const oldRulePrunes = [...names].sort().reverse().slice(14);
  check('CONTROL: the old count-only rule would have deleted most of the fortnight',
    oldRulePrunes.includes(nightly(20)) && !prune.includes(nightly(20)),
    `old rule pruned ${oldRulePrunes.length} incl. ${nightly(20)}; new rule prunes ${prune.length}`);
}

// --- 2. genuinely old snapshots do go ---------------------------------------
{
  const names = [
    ...Array.from({ length: 30 }, (_, i) => nightly(i + 1)), // 1st .. 30th, but see now
  ].filter((n) => n <= nightly(28));
  const now = new Date('2026-08-28T14:00:00Z');
  const { keep, prune } = planRetention(names, { now, keepDays: 14, keepAll: 7, keepRecentHours: 48 });
  check('a snapshot older than the window is pruned',
    prune.includes(nightly(5)) && prune.includes(nightly(1)), `pruned: ${prune.join(' ')}`);
  check('a snapshot inside the window is kept',
    keep.includes(nightly(20)), `kept: ${keep.join(' ')}`);
  check('the window is 14 days, not 14 folders',
    !keep.includes(nightly(10)) && keep.includes(nightly(15)),
    `kept: ${keep.join(' ')}`);
}

// --- 3. the floor: an age rule must never empty the directory ---------------
// The cron has been dead for four months. Every snapshot is far outside the
// window, and deleting them would leave nothing at the moment they are the only
// copies in existence.
{
  const names = Array.from({ length: 9 }, (_, i) => `2026-04-${String(i + 1).padStart(2, '0')}T03-15-02`);
  const now = new Date('2026-08-28T14:00:00Z');
  const { keep, prune } = planRetention(names, { now, keepDays: 14, keepAll: 7, keepRecentHours: 48 });
  check('the floor keeps the newest 7 however old they are',
    keep.length === 7 && prune.length === 2, `kept ${keep.length}, pruned ${prune.length}`);
  check('the floor keeps the NEWEST, not any 7',
    keep.includes('2026-04-09T03-15-02') && prune.includes('2026-04-01T03-15-02'),
    `kept: ${keep.join(' ')}`);
}

// --- 4. anything that is not a snapshot is left completely alone ------------
{
  const names = ['cron.log', 'README.md', '.incoming', nightly(27), nightly(28)];
  const now = new Date('2026-08-28T14:00:00Z');
  const { keep, prune, ignored } = planRetention(names, { now, keepDays: 14, keepAll: 1, keepRecentHours: 0 });
  check('non-snapshot entries are never pruned',
    prune.length === 0 && ignored.length === 3 && keep.length === 2,
    `keep=${keep.join(',')} prune=${prune.join(',')} ignored=${ignored.join(',')}`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nbackup retention: all good');
process.exit(failures ? 1 : 0);
