---
date: 2026-09-06
title: "\"Rotated by nothing here\" meant nothing in this file, not no rotation — and the sentence written to correct it got that wrong too"
---

A correction to the same day's P8b roadmap row, before it was merged.

- **The claim was that Caddy's access log is unrotated. It is not, and never was.** Caddy's file writer rolls **by default** — 100 MiB, 10 rolled files, 90 days — so the log has always been rotated and always had a retention. What the `Caddyfile`'s comment actually said was "rotated by nothing **here**", meaning nothing in that file, and the sentence written to fix it read that as no rotation at all. The real state was worse in a subtler way and better in the obvious one: a 90-day retention nobody had chosen, nothing had written down, and no page could honestly describe.
- **It was caught by reading the vendor's documentation before writing the config, not by review.** Nothing on this machine could have contradicted it — Caddy is not installed here and CI cannot run it either, which is the same reason `scripts/test-caddyfile.mjs` exists at all. The lesson is the cheap one: a claim about what a component does by default is a claim about that component, and the place to check it is its own documentation.
- **The row now says what phase 1 actually did**, rather than repeating the wrong premise: both logs mask the visitor's address, and the retention is stated in the file instead of inherited from a default.
