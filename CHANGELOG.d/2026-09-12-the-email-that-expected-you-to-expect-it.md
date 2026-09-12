---
date: 2026-09-12
title: "The adviser invitation was the customer's invite email, sent to somebody who had applied for nothing"
---

Granting a local adviser sent them `kind: 'invite'` — the email a customer's first editor receives when their organisation is approved. That person is expecting it, which is what lets it be two lines long. A local adviser is the opposite case: a member of the public who wrote in about a bus map a fortnight earlier, at whose end nothing has happened.

What arrived was *You've been invited to BusMaps.uk*, from a bare `info@busmaps.uk` with no display name, containing an unsolicited link, an urgency note (*this link expires shortly*) and no mention of which map, who was writing, or why. That is the shape of a phishing email, sent to precisely the sort of careful person who reports faults on bus maps — and the likeliest outcome was that they deleted it.

**It was found by sending one to a second address and looking at it.** No test, gate or type in this codebase can see that an email is addressed to the wrong situation; the template was correct, the send succeeded, and the fault was entirely in who it assumed the reader was.

A third kind, `adviser`, now carries the four things the other two can leave out: **which map**, by name, in the subject, because it is the only thing that makes the email recognisable as part of a conversation already under way; **what to do when the link has gone stale**, naming the address to re-request with, because a magic link lives fifteen minutes — right for one somebody just asked for, wrong for one pushed at them — and the re-request form answers identically whether or not an address is registered, so a typo there is met with silence; **how long a session lasts**, because somebody who thinks they get one visit uses it differently from somebody who knows they can come back; and **permission to ignore it**, which is more use to a puzzled reader than an urgency line.

The fifteen-minute expiry itself is deliberately unchanged. A longer-lived credential sitting in an inbox is a worse trade than one extra click, and the click is now signposted from inside the email.

`scripts/test-magic-link-email.mjs` reads the words, which nothing in this repository did before: every assertion about the adviser email is paired with the same question asked of `invite`, because "it names the map" means nothing unless the email that must *not* name one is checked too, and because a fix must not quietly rewrite the two kinds that were already right.
