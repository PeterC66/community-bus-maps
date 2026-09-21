# Second-operator handover drill (H3) — BusMaps.uk portal

<!-- docstamp v1.1 | 2026-09-21 | sha=81ac7741 -->
**v1.1** · updated 21 September 2026

**For:** whoever picks this service up if Peter cannot — a hypothetical reader today, since `PeterC66` is the only GitHub collaborator ([CONVENTIONS.md](CONVENTIONS.md), Git). **Purpose:** prove, or say honestly where it is not yet proven, that this service can be deployed, verified and restored by somebody working from these documents alone, with none of Peter's tacit knowledge (`technical-audit_2026-08-19` C4: *"prove somebody else can deploy, verify and restore from the documentation alone"*).

This is not a duplicate of [DEPLOY.md](DEPLOY.md): that document already carries every command, in more depth than most services get. What it cannot carry is whether the person running those commands can get to the point of running them at all. **The real bus-factor risk in a one-person operation is access, not procedure** — and access is exactly the thing nobody writes down, because the person who has it never needs to.

## 1. What this drill actually measures

Two separate questions, and DEPLOY.md only answers the second:

1. **Can a second operator get access** — to the repository, the host, the secrets, the domain — starting from nothing?
2. **Can they then follow the documented procedure** to deploy, verify and restore?

§2 below answers the first question honestly, because nobody has tried it. §3 answers the second by pointing at what is already written, because it does not need rewriting.

## 2. The access checklist — what exists nowhere in writing

For each of the following, ordinary operation depends on it, and this drill could find no document — anywhere in this repository or in `buses-data` — that says where to get it. Where that is true it is stated plainly, in the same honest style [DEPLOY.md](DEPLOY.md) uses for its own gaps.

| What | Where it lives today | Written down anywhere? |
|---|---|---|
| GitHub org/repo access (`PeterC66/community-bus-maps`, `PeterC66/claude-skills`, `PeterC66/buses-data`) | Peter's GitHub account | **No** — no succession plan, no second collaborator ([CONVENTIONS.md](CONVENTIONS.md): *"`PeterC66` is the only collaborator"*) |
| The VPS itself — hosting account, billing, the box `busmaps.uk` runs on | Peter's hosting provider account | **No** |
| The SSH key that reaches it (`C:/Users/Peter/.ssh/busmaps_vps`, used throughout [DEPLOY.md](DEPLOY.md)) | Peter's laptop | **No** — no note of where a copy is kept, or how a lost one is replaced |
| DNS for `busmaps.uk` (the domain itself) | Peter's registrar account | **No** |
| The `.env` secrets on the host (`RESEND_API_KEY`, `METRICS_TOKEN`, `STATUS_TOKEN`, `OPERATOR_TOKEN`) | the host's `.env`, readable only once already on the host | Rotation is documented ([DEPLOY.md §2](DEPLOY.md)); first-time *issuance* — where `RESEND_API_KEY` itself comes from — is not |
| The `BACKUP_RECIPIENT` private key that opens an encrypted backup | "the operator's password manager" ([DEPLOY.md §2](DEPLOY.md)) | The *fact* of where it lives is written; the password manager's own access is not |
| The password manager itself | Peter | **No** |
| The Resend account (email provider) | Peter's account with Resend | **No** |
| `community-bus-maps-ops` — the local-only customer/vetting/incident register | `C:\Claude\community-bus-maps-ops\`, Peter's laptop, no cloud, no git | Its existence and purpose are documented (H1 §6); it is backed up nowhere but **"back it up yourself"** (H1 §6, verbatim) |
| `sudo` on the host, for the Caddy steps in [DEPLOY.md §3a](DEPLOY.md) | whichever account `npm run ssh` connects as | Connection is documented; escalation is assumed |

**This table is the finding, not a side note.** Nine of ten rows above have no written answer, and the service currently has exactly one person who could answer any of them. Closing this gap is mostly not even a documentation change — it is Peter choosing, per row, either to write down where the thing is (turning a secret into a recorded one, a trade-off that is his to make) or to name a specific person who would be told in an emergency. Until one of those happens, this drill's honest answer to *"could somebody else actually get in"* is **no**, however good the procedure is past that point.

## 3. The procedure, once access exists — by pointer, not by repetition

Assuming the checklist above is somehow satisfied (an emergency hand-off, say), the sequence a second operator follows is already written and does not need saying twice here:

1. **Orientation.** Read [H1](H1-operations-handbook.md) start to finish, then [`ROADMAP.md`](ROADMAP.md) and `CHANGELOG.d/` (the tracked source `CHANGELOG.md` is built from) — H1 §8 says this too.
2. **Local setup.** [`DEVELOPING.md`](DEVELOPING.md) — clone, install, run locally, the determinism contract.
3. **Reach the host.** [DEPLOY.md §3](DEPLOY.md) — `npm run ssh`, once the SSH key from §2 above is in hand.
4. **Deploy.** [DEPLOY.md §3b](DEPLOY.md) — `npm run deploy`, which merges, deploys and reads the result back on its own.
5. **Prove it is live and healthy.** [DEPLOY.md §4](DEPLOY.md) — the smoke test, `check:live-routes`, `check:sitemap`.
6. **Prove a backup restores.** [DEPLOY.md §5, "Drill the DECRYPTION first"](DEPLOY.md) — `restore-drill.mjs` against a real snapshot, needing the `BACKUP_RECIPIENT` private key from §2 above.
7. **The full restore, if it is ever actually needed.** [DEPLOY.md §5, "Restore drill"](DEPLOY.md) — stop, restore, restart, verify a published map's bytes are unchanged.

Nothing in this section duplicates a command from DEPLOY.md; it is the order to read them in.

## 4. What has actually been drilled, and by whom

[DEPLOY.md §5](DEPLOY.md)'s own table records three real drills — 9 August, and twice on 3 September 2026. **Every one of them was run by Peter.** That proves the *procedure* works; it proves nothing about whether a second operator, with no tacit knowledge and starting only from these documents, could do the same thing, because nobody who is not Peter has ever tried. That gap is real and this document does not close it; it is closed by §2's access questions being answered and then a real person who is not Peter actually doing §3 top to bottom and reporting what this document got wrong.

## Done when

This document exists and states the true position rather than an aspirational one, which is what `technical-audit_2026-08-19` C4 actually asked for. **It is not proven — it is honestly not-yet-proven**, because nobody but Peter has ever tried, and nobody but Peter can currently get the access in §2 to try. Closing that is Peter's choice among the rows in §2's table, not a further document. The next real evidence is a person who is not Peter completing §3 top to bottom, with this section updated to say what that found.
