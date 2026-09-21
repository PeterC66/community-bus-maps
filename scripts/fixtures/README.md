# Captured engine output, committed so the tests that read it run everywhere

<!-- docstamp v1.0 | 2026-09-14 | sha=bcf1eed2 -->
**v1.0** · updated 14 September 2026

Everything under this folder is **verbatim output of the bus engine**, copied off the map tree in `buses-data` and committed here unchanged. Nothing in it was written by hand, and nothing in it may be tidied: the whole value of a captured fixture is that it is the format the engine actually produced on a real town, rather than the format whoever wrote the parser believed it produced.

## Why these exist at all

`scripts/test-build-warnings.mjs` and `scripts/test-complexity-band.mjs` each had two halves — synthetic files the test wrote into a scratch directory, and one arm that walked the real map tree. The synthetic half runs anywhere. The real-corpus half needs `BUSES_DIR`, and the `test` workflow checks out only this repository, so from the day it was written it ran on one laptop and nowhere else. It said so, loudly, and skipped rather than passing: `· the Buses map tree is not on this machine — the real-corpus arm is SKIPPED, not passed`. Nobody reads a skip line.

What that cost is measured in the commit that added this folder. `readBuildWarnings()` was written on 2026-08-30 against `N warnings, M blocking.`; `build_log.js` in the engine gained `, and K measurement(s).` the same day (buses-data OA-118), and the lane measurement is unconditional, so every build since has written the longer line. The parser matched none of them. Over the 900 `build-warnings.txt` files on the tree, **595 parsed as `null`** — among them both of the only two files in the estate's history that report a BLOCKING warning, and all eight towns' current renders. The one arm that could have seen it was the arm that ran nowhere, and even on the laptop it stopped after three files in a single folder, all three of them copies of one place's sheet in the one shape that still parsed.

So the rule these fixtures exist to keep is the one portal PR #298 arrived at for the landmark tiers: **before accepting a skip, ask what the guard's subject actually needs, and commit the smallest real thing that supplies it.** A synthetic fixture cannot answer "does this parser cope with what the engine writes", because the synthetic fixture is written by whoever wrote the parser — it can only confirm what they already believed.

## What the laptop arm is still for

Both tests keep their real-tree arm, and it is not redundant. A committed capture answers *does the parser handle the formats the engine HAS written*; only the live tree answers *…and the one it writes today*. A capture cannot notice the engine changing its mind — that is precisely the change it just failed to notice — so the two halves ask different questions and both are kept.

## `build-warnings/`

Five directories, one per shape found in a sweep of all 900 files on the tree on 2026-09-14. Each holds a `build-warnings.txt` because `readBuildWarnings()` takes a directory and looks for that name inside it.

| Directory | Summary line | Why this shape is here |
|---|---|---|
| `counted-plain/` | `1 warning, 0 blocking.` | The pre-OA-118 shape. 86 files on the tree, and the only shape the old laptop arm ever sampled |
| `counted-with-measurements/` | `10 warnings, 0 blocking, and 2 measurements.` | What the engine writes today — every one of the eight towns' current renders |
| `blocking/` | `23 warnings, 1 blocking, and 3 measurements.` | The case the whole feature exists for. Two files in the estate's history report a blocking warning and this is one of them |
| `no-warnings/` | `No warnings — every generator ran clean.` | The zero-warning line carries no digits to read. A file that says zero is a zero, and must not be confused with the absent file, which stays `null` |
| `no-summary-line/` | *(raw entries, no header)* | Five real files have no summary line at all. `null` is the right answer here, and asserting it on a real file rather than on an invented "garbage" string is what stops a widened parser quietly guessing |

Source of each capture, all under `C:\u3a St Ives\Using AI\Buses` in `buses-data`:

| Directory | Copied from |
|---|---|
| `counted-plain/` | `Areas/Beaconsfield/Places/Beaconsfield Simpson Centre/S4-generate/v1.13_2026-08-19_0549/` |
| `counted-with-measurements/` | `Areas/St Ives/S5-render/v6.82_2026-09-13_2026/` |
| `blocking/` | `Areas/High Wycombe/S4-generate/v6.1_2026-09-06_2342/` |
| `no-warnings/` | `Areas/High Wycombe/Places/High Wycombe High Street/S4-generate/v1.1_2026-08-23_1904/` |
| `no-summary-line/` | `Areas/High Wycombe/S4-generate/v3.0_2026-09-01_2343/` |

## `complexity/`

One directory per town, holding that town's `complexity.json` from its newest S2 run as at 2026-09-14 — the same eight files the laptop arm reads, so CI now has the breadth the laptop had. Between them they cover all three bands (four GREEN, two AMBER, two RED — Beaconsfield and Huntingdon AMBER, High Wycombe and Wisbech RED), a `failedThresholds` list that is empty and ones that are not, the `P` metric both present and absent (it did not exist before 2026-08-31), and an `applied` object whose keys are all `null`.

## Re-capturing

These go stale on purpose — see *What the laptop arm is still for* above. If the engine's format moves and the laptop arm goes red, the fix is to correct the parser and then re-capture, never to re-capture alone. Both commands below are run from the portal root (`C:\Claude\community-bus-maps`), and `<source>`/`<case>` are the two columns of the tables above:

```bash
cp "C:/u3a St Ives/Using AI/Buses/<source>/build-warnings.txt" "scripts/fixtures/build-warnings/<case>/build-warnings.txt"
```

For a town's score, `<Town>` is the town's folder name under `Areas/` and `<run>` its newest `S2-geometry` run:

```bash
cp "C:/u3a St Ives/Using AI/Buses/Areas/<Town>/S2-geometry/<run>/complexity.json" "scripts/fixtures/complexity/<Town>/complexity.json"
```
