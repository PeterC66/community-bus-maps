---
date: 2026-09-03
title: "The customer guide answers the three things this morning's reader had to be told"
---

**`docs/C1-customer-user-guide.md` gains one paragraph on landmarks**, and every sentence of it comes from a real reader hitting a real edge rather than from imagining one. Peter went through High Wycombe's 171 places on the live site and sent six reports; five were faults, fixed in [#215](https://github.com/PeterC66/community-bus-maps/pull/215). Three of them change what a customer needs telling.

- **The first draft deliberately has far too many places on it.** Every one is there because OpenStreetMap has it and nobody has yet said it does not belong, so *taking places off* is the most useful thing a local can do and the answer we least often get. Saying this in the guide is cheaper than hoping it is inferred from a screen full of chemists.
- **A row you answer now leaves *Not looked at yet* immediately.** It used not to, unless you clicked the chip again, so the filter kept showing rows you had just dealt with. The list holds its place while the row goes, so answering does not throw you back to the top of 145.
- **A few places have no name in the map's data at all** — chemists and surgeries, whose names the printed sheet never shows, so nobody ever recorded one. They now read *Unnamed pharmacy* in italics; the guide says to click the row to find it on the map and put the real name in the box, and that the name given there is the one the sheet will use.

**Not added, deliberately:** the order of operations. *Build the map first, then ask for the landmarks* is our decision about how to run an onboarding, not something a customer acts on — it lives in buses-data's [customer guide](https://github.com/PeterC66/buses-data/blob/main/Documentation/README%20-%20How%20to%20handle%20a%20customer.md) and the new [README - How the landmark chooser works](https://github.com/PeterC66/buses-data/blob/main/Documentation/README%20-%20How%20the%20landmark%20chooser%20works.md), which is also where the seven faults this screen has had are written down.
