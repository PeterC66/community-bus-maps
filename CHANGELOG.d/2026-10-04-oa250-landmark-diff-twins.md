---
date: 2026-10-04
title: "A second same-name place arriving is reported as an arrival"
---

- **The landmark arrivals check tells a same-name pair apart by element id.** `diffLandmarks()` compared builds by `<cat>:<name>` alone, so a second Aldi appearing beside the first was invisible: the key was already there, and the customer was never told a new place had arrived carrying no answer. Where a key is shared on either side, the OpenStreetMap element id is now the identity; every other key is compared exactly as before, so a lone place whose element id merely changed is still not reported (buses-data OA-250). `scripts/test-landmark-arrivals.mjs` holds the four cases, and was seen to go red on the old function.
