---
date: 2026-09-24
title: "A refresh can be staged without emailing the customer"
---

- **`propose-update.mjs` takes `--no-notify`**, and `npm run deliver` forwards it. The update is staged exactly as before, but the *an update is ready* email is not sent, and the run says that nobody was told. Before this, every staged map sent its own email: the 2026-08-28 round put 18 near-identical notices in one customer's inbox, and a delivery could not be rehearsed against a real customer record without mailing them. `scripts/test-propose-update-no-notify.mjs` runs the script with and without the flag against a throwaway database. The per-customer digest that should replace the per-map emails, as publishing already has with `published-batch`, is not built yet (buses-data OA-152).
