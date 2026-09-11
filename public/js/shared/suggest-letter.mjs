// OA-308 TIER 3 — the letter a reader sends when nobody publishes a map of their town.
//
// Tier 2 put the national directory under the /maps search, so a miss now ends
// in "then does anybody publish one?" rather than "No matches". For roughly half
// the authorities in that directory the honest answer is still **nobody does**,
// and that is where a reader who wants a bus map has run out of road. This file
// is what happens next: a ready-to-send letter, addressed to the authority the
// directory just named, saying what is missing and asking for it.
//
// FIVE RULES, AND THE FIRST ONE IS THE WHOLE DESIGN.
//
//   1. **The READER sends it. We never do, and there is no way to make us.**
//      There is no recipient address in this markup, no form, no queue, no
//      "send it for me" button anywhere, because every one of those would need
//      consent machinery this project does not have and would read as spam from
//      us by the tenth one. A council answers a resident; it files a supplier's
//      mail-merge. The text is on the page in full so a reader with JavaScript
//      off can read it and retype it, and the copy button is a convenience over
//      the top of that, never the only route to it.
//
//   2. **The letter does not pitch us, and the pitch that exists says so.**
//      Peter's fourth point for this action was that a reader should be able to
//      suggest an authority commissions a map "from us", and the honest way to
//      do that is not to write the plug into a letter the reader signs without
//      noticing. So the letter asks for a MAP. A separate, clearly labelled
//      paragraph — `extra` below — offers to name us, and the reader adds it or
//      does not. A resident's letter we ghost-wrote to recommend our own
//      service, with no indication it was ours, is astroturf whatever it says.
//
//   3. **Every factual claim in it comes from the directory row, or is not
//      made.** "You publish a network map dated April 2025" is a thing the
//      survey recorded on a date; "you have no map" where the survey says
//      `unknown` is not. The letter's own last line tells the authority where
//      the claim came from and invites a correction, because a letter that
//      asserts something wrong about the recipient is one they answer by
//      correcting us instead of by commissioning anything.
//
//   4. **No suggestion where a map already exists for the place asked about.**
//      If the reader searched a town the directory records a map FOR, the
//      answer is the link, not a letter. Handing somebody a "why is there no
//      map?" letter about a map we have just linked them to is the shape that
//      makes the whole panel look unread.
//
//   5. **AND THE FIRST RULE GIVES ITSELF AWAY IF NOBODY SAYS THIS.** Every
//      reader gets a word-identical letter. Rule 1 exists so that a council
//      receives a resident's letter rather than a supplier's round robin — but
//      fifty residents sending fifty identical letters have sent a campaign,
//      which is the same object with a different return address. The text
//      cannot fix that; only the reader can. So the note above the letter
//      (map-card.mjs) tells them plainly that a short letter in their own words
//      is worth ten identical ones, and that what follows is a starting point
//      rather than a form. Found by reading the rendered letter back on
//      2026-09-11 rather than by any check, and no check can hold it.
//
// It is a plain ES module for the reason map-card.mjs is one: the server
// renders this panel and so does the browser, and two copies of a letter would
// be two letters within the month. No DOM, no `node:` imports, strings in and
// strings out.

/**
 * Whether this row should offer a letter at all, and what it can truthfully say.
 *
 * @param {object} offer     an offer as shaped by offerOf() in src/search/directory.js
 * @param {string} query     what the reader actually typed — the place they care about
 * @param {string} matchKind 'authority' | 'area' | 'town' — how the row was matched
 * @returns {{show: boolean, why: string}}
 */
export function suggestionApplies(offer, query, matchKind) {
  if (!offer || !query) return { show: false, why: 'nothing to write about' };
  // Rule 4. A town hit means the reader's own place is in this authority's list
  // of towns it publishes maps of: the card above already links it.
  if (matchKind === 'town') return { show: false, why: 'a map of this town already exists' };
  // The row publishes town-level maps and the reader landed on it by the
  // authority or area name. We cannot tell whether THEIR town is one of the ones
  // covered, so the letter is still worth offering — the reader can see the list
  // on the card and decide. `towns` being non-empty is what the card showed them.
  if (offer.status === 'town' && (offer.towns || []).length === 0) {
    return { show: false, why: 'the directory records town maps but not which towns' };
  }
  return { show: true, why: '' };
}

/** One sentence saying what this authority publishes today, in the reader's voice. */
function whatTheyHave(offer) {
  if (offer.status === 'network') {
    // An OBSERVATION, not a review. This said "and it is useful for planning a
    // journey across the area" until it was read back on 2026-09-11: that is an
    // opinion about a map the sender may never have opened, put in their mouth
    // by us. What the row supports is that the map exists and when it is dated.
    const dated = offer.dated ? `, dated ${monthWords(offer.dated)}` : '';
    return `I can see that you publish a map of the whole network${dated}. What I cannot find is a map of the buses in one town at a scale I can read at a bus stop.`;
  }
  if (offer.status === 'town') {
    const towns = (offer.towns || []).join(', ');
    return `I can see that you publish bus maps for ${towns}. I cannot find one that covers where I live.`;
  }
  return 'As far as I can tell you do not publish a bus map of any kind — not of the whole network, and not of any individual town.';
}

// "2025-04" as "April 2025". map-card.mjs has monthGB(), which does the same
// thing, and this is NOT imported from there on purpose: map-card.mjs imports
// THIS file, and importing back would make the pair circular for the sake of
// four lines. If the two ever need to agree about anything harder than a month
// name, the answer is a third module both import, not an edge back.
function monthWords(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return String(ym || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return isNaN(d) ? String(ym) : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The letter itself: subject, body, and the optional paragraph that names us —
 * which is the reader's to add or leave out, and is never part of `body`.
 *
 * Nothing here reads the clock. The letter a reader copies today and the letter
 * they copy tomorrow are the same letter, and the only date in it is the one the
 * directory recorded — which is a value in a file.
 *
 * @param {object} offer an offer as shaped by offerOf()
 * @param {string} query the place the reader searched for
 */
export function suggestionLetter(offer, query) {
  const place = String(query || '').trim();
  const authority = offer.authority || 'the local transport authority';
  const subject = `A bus map for ${place}`;
  const body = [
    // A RECIPIENT LINE, then "Dear Sir or Madam". Both halves were changed on
    // 2026-09-11 after the letter was read back. "Dear <Council>, … Yours
    // faithfully" is a convention mismatch — *faithfully* pairs with *Sir or
    // Madam* and a named addressee takes *sincerely* — and this letter's whole
    // credibility rests on reading as a resident's own. Dropping the name
    // outright would have cost something real, though: a reader holding two
    // copied letters could no longer tell which was which, so the authority
    // moves to a `To:` line, where a letter normally carries it. It is the
    // organisation's NAME and never a contact address: rule 1 stands.
    `To: ${authority}`,
    '',
    'Dear Sir or Madam,',
    '',
    // CLAIMS NOTHING ABOUT ABSENCE. This said "and there does not appear to be
    // one" until it was read back against the real data: for every authority
    // that publishes a network map and no town maps — the largest group in the
    // directory — the very next sentence then said "I can see that you publish
    // a map of the whole network", and an officer read both before reaching the
    // request. The accurate claim belongs to whatTheyHave(), which has the row.
    `I am looking for a map of the local bus services where I live, in ${place}.`,
    '',
    whatTheyHave(offer),
    '',
    // The cost comparison that used to end this paragraph — "a very small
    // fraction of what running the services costs" — is gone. It carried no
    // source, it is the one sentence a procurement officer could argue with,
    // and it is a supplier's argument in a resident's mouth, which is the rule
    // this file exists to keep.
    'A single sheet showing the buses in a town — which routes there are, where they go, how often they run and where to catch them — is the thing most often missing, and it is what people ask for when they say they cannot work out how to use the buses.',
    '',
    'Could you tell me:',
    '',
    // Asks about TOWNS, not about `place`. The reader may well have searched a
    // county — the panel tells them to when a village misses — and "do you
    // publish a map of the bus services in Essex" is a question Essex answers
    // "yes, here it is", correctly, ending the exchange with nothing gained.
    '  1. whether you publish, or plan to publish, bus maps of the individual towns in your area;',
    '  2. if not, what it would take for you to commission one.',
    '',
    'I understand that an Enhanced Partnership scheme can require a single set of multi-operator information across all operators in an area. A town bus map is the most useful form that information takes for somebody standing at a stop.',
    '',
    `I found my way to you through busmaps.uk, which keeps a public directory of what each English local transport authority publishes. It records that ${describeRecord(offer)} If that is out of date or wrong, I would be glad to know, and so would they.`,
    '',
    'Yours faithfully,',
    '',
    '[your name]',
    // Not "[where you live in <place>]": `place` is as often a county as a town,
    // and "where you live in Essex" reads oddly in the commonest case.
    '[the town you live in]',
  ].join('\n');

  const extra = `If it helps, there is a supplier already producing exactly this kind of sheet from the open Bus Open Data Service data — busmaps.uk. I have no connection to them beyond having used their site to find you.`;

  return { subject, body, extra };
}

/** What the directory says about this authority, as one clause for the letter's last paragraph. */
function describeRecord(offer) {
  const checked = offer.checked ? ` when it last looked, on ${dayWords(offer.checked)}.` : '.';
  if (offer.status === 'network') return `you published a map of the whole network, and no map of an individual town,${checked}`;
  if (offer.status === 'town') return `you published maps of some individual towns${checked}`;
  return `it could find no bus map published by you${checked}`;
}

/** "2026-09-11" as "11 September 2026". */
function dayWords(iso) {
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
  return isNaN(d) ? String(iso || '') : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The letter as one block of text, which is what a copy button puts on the
 * clipboard and what a reader retypes. Subject line included and labelled,
 * because an email without one gets filed as junk.
 */
export function letterPlainText(letter, { withExtra = false } = {}) {
  return [`Subject: ${letter.subject}`, '', letter.body, ...(withExtra ? ['', letter.extra] : [])].join('\n');
}
