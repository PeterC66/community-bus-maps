---
date: 2026-09-28
title: "A hang in the hygiene step fails in three minutes, and says which process it was"
---

- **The `tests` job was cancelled at its 15-minute cap twice on 2026-09-28** (runs 36376386881 and 36474498886). Both times the file-hygiene step printed "all clean" in under a second and never finished. The runner's only clue was an orphan named `MainThread`, which is Node 24's name for its own main thread. It was the checker itself, deadlocked in native teardown, not a process leaked by `npm test`. When the checker was run 800 times per cell on `ubuntu-latest`, `process.exit()` hung about 1 run in 80. Running `npm test` first made no difference and left nothing alive. The source fix is in claude-skills #221: the checker ends by `process.exitCode`, which hung 0 times in 1,600 (buses-data OA-513).
- **Both hygiene steps now carry `timeout-minutes: 3`**, so the next hang there is a red step within minutes rather than a cancelled job at fifteen.
- **A new last step, `What was still running when this job failed?`, runs only on a red or cancelled job.** It prints the process tree, plus each surviving `node` process's command line and where each of its threads is waiting. The next stall of any step arrives with its culprit named.
