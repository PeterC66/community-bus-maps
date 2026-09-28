---
date: 2026-09-28
title: "Hospitals, theatres, cinemas and colleges on every map; pubs and stations on unless switched off"
---

- **Re-vendors `engine/poi_select.js`, `engine/icons.js`, `engine/services_panel.js` and `engine/place/gen_internal.js` from PeterC66/claude-skills#202 (buses-data OA-500, Peter's landmark categories review of 28 September).** Every map now draws hospitals, theatres and arts centres, cinemas, and colleges and universities, each with a new symbol and Key row. Pubs and railway stations are drawn unless a map switches them off. Allotments, post offices and industrial estates are drawn only if a map switches them on. A pub's name is placed after every other name when labels compete, and a station prints as *March Station* rather than *March*.
- **The Landmarks page follows the engine (buses-data OA-498).** Its category boxes ask the engine's `categoryOn()`, so pubs and stations show ticked where the map draws them, and unticking one saves a switch-off. It offers two new switches, post offices and industrial estates. The FAQ's `#landmarks` answer and the customer guide C1 say the same.
- **Moves ink.** The St Ives and High Wycombe Aldi gate fixtures lose their industrial estates, so `verify:area` and `verify:place` differ until those fixtures are rebuilt in buses-data and re-vendored with `npm run fixtures:vendor -- --apply`.
- **Deploy history, written before the deploy per [DEPLOY §3b](docs/DEPLOY.md#3b-the-deploy-history-entry-is-written-before-the-deploy-and-merged-with-it).** This pull request's merge is the commit that goes live. A published map changes only when it is next rebuilt; the Landmarks page changes at once.
