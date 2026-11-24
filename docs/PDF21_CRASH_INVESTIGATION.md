# Investigation: the intermittent native crash of `pdf21.test.js` in the full backend suite

Date: 2026-11-23 / 24. Machine: Windows 11, 16 logical cores, 16 GB RAM, Node.js 22.14.0, bundled JRE 21 / FOP 2.10, `xmllint-wasm`. Command under study: `node --test test/*.test.js` in `backend/`
(the runner starts one `node` process per test file, about 15 at a time).

## 1. Verdict

* **The crash is real, intermittent, and not caused by the JSG work.** It reproduces on a clean checkout of the original commit (no JSG code at all): there the same command killed a different heavy
  file (`brex-gate.test.js`). So it is a property of running this suite on this machine, not of any change made in this session.
* **It is not specific to `pdf21`.** It hits whichever "21 types x S1000D issues" test file is running (all of them validate with `xmllint-wasm` and render with FOP), and the same load also produces
  10-15 minute **hangs** (timeouts) in other such files.
* **The root cause is NOT identified.** What is established is where it happens, what it is not, and what it correlates with. No crash dump could be obtained (section 5). The suite's
  full-run failure must therefore be treated as an unresolved defect of the test environment, not as noise.

## 2. What the failure is

The runner reports `not ok - test\pdf21.test.js`, `exitCode: 3221225477` = `0xC0000005` (access violation), `signal: ~`, with **no assertion text, no stderr and no Node fatal-error report**
(`--report-on-fatalerror` was on in run 4 and wrote nothing, so it is not a V8 out-of-memory / fatal error). The test *process* dies, not a child (Java, `pdftotext`). Windows recorded no
`Application Error` or `Windows Error Reporting` event for it.

## 3. Evidence: every run

| # | Run | Result |
|---|---|---|
| 1 | full suite (after the UHB/ISPL work) | `pdf21` crashed after **454 s**, 5 of 8 subtests passed; the crash came ~11 s into subtest 6 (`s1000dtojss`, **Issue 5-0**) |
| 2 | full suite, sampled | `pdf21` crashed after **143 s**, 1 subtest passed; ~13 s into subtest 2 (`s1000dtofo`, **Issue 5-0**) |
| 3 | full suite, sampled | `pdf21` **passed 8/8** (757 s). Another test failed for an unrelated reason (section 6.2) |
| 4 | full suite, sampled, Node report flags on | `pdf21` crashed again, 5 subtests passed, during subtest 6 (**Issue 5-0**); plus two **timeouts** in other tests named "issue 5-0" (900 s and 600 s) and one load-starved timing test; the run took 1,308 s instead of ~600-750 s |
| 5 | **clean checkout of the original commit**, same command | **crashed (`0xC0000005`) in `brex-gate.test.js` after 358 s**; `pdf21` passed 8/8; run took 866 s (the scratch copy also failed ~28 tests for reasons of its own: it lacks files that are not in git) |
| - | `pdf21` alone (3 runs, one sampled) | passed 8/8 each time (335 s when sampled) |
| - | `pdf21` four copies at once, nothing else running | all four passed 8/8 (676 s each) |
| - | schema validation only (`xmllint-wasm`, the platform's own `validateProjectSchema`), 12 processes at once, 240 s each, Issue 5-0 and then Issue 6 as control | 24 of 24 processes finished normally (~4,000 validations per issue) |

Pattern in the crashes of the *same* file: all three happened within about 11-13 s of the **start** of an Issue 5-0 subtest, and the hangs are also Issue 5-0 tests. Issue 5-0 is the second issue in
every file's loop (4-2, 5-0, 6, 7), so it is reached at roughly the same moment in every file - the correlation with 5-0 may be a correlation with *time since start / how many files are in their heavy
phase together*, not with the 5.0 schemas themselves (the 5.0 schema set is the same size as 4.2 and 6.0, 8 MB, and validated cleanly under stress). This was not separated.

## 4. What was ruled out, and how

| Hypothesis | Evidence against |
|---|---|
| The JSG work caused it | reproduces on a clean checkout of the original commit (run 5); `pdf21` runs no JSG code |
| Out of RAM | at the crash of run 2 the machine had ~4 GB free RAM and 21.6 of 32.1 GB commit; worst case in runs 1-4 was 1.1 GB free. (Run 5 dipped to 69 MB free at one moment, so memory pressure may *contribute* there.) |
| Memory leak in the test process | the process stayed at 100-250 MB over a full 335 s alone run; no growth |
| Disk full | run 4 crashed with ~2 GB free; run 3 drove the disk to 1 MB free and `pdf21` still passed. A full disk is not necessary and not sufficient (but see 6.1) |
| A fixed shared file between test files | none found in `pdf21`'s path; the only fixed temp name (`jss-fop-warmup.pdf`) belongs to the server start-up, which these tests do not run |
| Something killing Java processes by name | no `taskkill`/`pkill`/`java.exe` kill anywhere in `src`, `vendor/engine`, `test`, `scripts` |
| Endpoint-security DLL injection into node | a plain `node` process on this machine loads 35 modules, all Windows or node itself |
| V8 fatal error / heap exhaustion | `--report-on-fatalerror` produced no report |
| The WASM validator alone under heavy parallel load | 24 processes, ~8,000 validations, no crash |
| Plain concurrency of the same workload | four copies of `pdf21` together, no crash |

## 5. What is *not* established

* The faulting module and stack. Windows logged nothing and no debugger or dump tool is installed. To capture one, **Windows Error Reporting LocalDumps** for `node.exe` would be needed
  (a machine-wide registry setting under `HKLM`); I did not change it without your approval.
* Whether the trigger is the combination of many simultaneous FOP JVMs + many `xmllint-wasm` instances in a Node 22.14 process on Windows (plausible, **unproven** - this is a hypothesis, not a finding),
  a defect in Node 22.14 itself, or an interaction with the real-time scanning of the thousands of files the suite writes.
* Why 3 of 4 full runs crashed in this session while two other full runs (run 3 here, and the earlier merge run recorded in `docs/JSS_MERGE_2026-11-23.md`) did not.

## 6. Other findings made while investigating

1. **The suite leaks about 2.5 GB of temp files per full run and the disk was already at 0.8 GB free (100% full).** Tests create `mkdtemp` folders and never remove them (for example `pdf21` makes a folder
   holding a PDF for every one of its 168 checks, and some tests write large ZIPs). The temp folder held 4,980 folders from many sessions. This makes any long run fragile on a nearly full drive; no real out-of-space failure was seen in the logs (the one `ENOSPC` line comes from a test that simulates a full disk on purpose), but a near-full system drive also slows everything. I removed only the folders created by my own test runs in this session (matching the tests' `mkdtemp` prefixes plus six random characters): 2,540 + 671
   folders, about 3.7 GB. About 2,400 older ones from earlier sessions were left alone.
2. **A JSS/S1000D isolation guard is date-dependent.** `jss-cover-isolation.test.js` ("S1000D and the old JSS User Handbook path: the XSL-FO is what it was before the change") passed on 23 November and fails
   from 24 November. The S1000D sample project prints *today's date* in its XSL-FO (the issue date marker and the "Printed" line; 6 occurrences of the bare date), and the test normalises only
   `YYYY-MM-DD HH:MM` timestamps, not a bare date. **Proof**: building the sample now and changing only the date back to 2026-11-23 gives a fingerprint **equal to the stored baseline
   (`794e3aaa...`)**; with today's date it differs (`1fb6ae89...`). So the S1000D output is unchanged - the guard simply has a clock in it. I did not edit that file (it belongs to the S1000D/JSS side);
   the fix is one line: also normalise `\d{4}-\d{2}-\d{2}` in `norm()` in the test.
3. `catalogue-race` ("a concurrent reader never sees an empty or partial file", "the reader ran (400 reads)") fails under load on the clean checkout as well as here: it asserts a count of reads
   completed in a fixed time and starves when the machine is busy.

## 7. Recommendations (nothing below has been done)

1. Run the three heavy files (`pdf21`, `brex-gate`, `publish-gate`) separately from the parallel run, or lower the runner's concurrency (`node --test --test-concurrency=4`). I did not test whether this removes the crash
   (one run cannot show it when the crash rate is 3 in 4).
2. Capture a dump (WER LocalDumps for `node.exe`) and, in parallel, try the latest 22.x Node.
3. Make the tests clean up their `mkdtemp` folders and free the disk; the current state cannot run the suite reliably.
4. Fix the date in the isolation guard's normaliser.
