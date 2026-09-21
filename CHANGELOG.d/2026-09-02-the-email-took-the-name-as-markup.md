---
date: 2026-09-02
title: "The email took the map name as markup"
---

- **The four emails this service sends built their HTML half by interpolating text straight into a template literal.** The map name is typed by the customer on the request form (120 characters), the rejection reason by an approver (2,000), and neither was escaped: a map called `Fen<b>marsh</b>` arrived in bold, and a reason with a `<` in it lost the rest of its sentence. It never reached the site, so it was not an XSS on busmaps.uk; it was wrong in the customer's inbox instead. Found by the 2026-09-01 codebase review (buses-data OA-224, Tier 1.2), which counted twelve HTML escapers across `src/` and `public/` and none used here.
- **`src/html.js` is now the one escaper for server-built markup**, and `notify.js` and the magic-link builder route every interpolation through it — the URL inside `href` too, because a `"` in a URL ends the attribute. The plain-text half is deliberately untouched: it is a `text/plain` part, and a fix that escaped both would pass a naive check and mangle the readable copy.
- **`scripts/test-notify.mjs` holds the case and its control**: a map name carrying a tag, an ampersand and quotes, and a reason carrying a script tag, must come out escaped in `html` and byte-for-byte in `text` and `subject`. The control is the half that would go silently wrong under an over-eager fix.
