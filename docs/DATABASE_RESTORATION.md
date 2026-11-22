# Restoring the original real database (2026-11-22)

The database the owner had been working in before the code was merged (`publisher.db`, last written 2026-11-20 14:33) was recovered from the Recycle Bin into
`_backups/restored-from-recycle-bin-2026-11-22/workspace/`. This page records how it was inspected, restored into the live workspace, migrated to the current
schema, and verified. **The recovered original is the source of truth; nothing was recreated, reset, dropped or overwritten.**

## 1. What was found (read-only inspection, on copies)

| | recovered original | pre-016 snapshot in the live workspace | live workspace before this work |
|---|---|---|---|
| file | `_backups/restored-from-recycle-bin-2026-11-22/workspace/publisher.db` (3,162,112 B, WAL empty) | `workspace/backups/publisher-before-016-s1000d-reference.db` (3,678,208 B, taken 2026-11-22 16:19) | **no `publisher.db` at all** |
| integrity / FK | `ok` / 0 violations | n/a (snapshot of a later state) | - |
| migrations | 001-015 | 001-015 | - |
| users / projects / documents / revisions / blobs / audit | 3 / 7 / 454 / 250 / 246 / 637 | 3 / 9 / 551 / 317 / 280 / 682 | - |

* The original is a **strict subset** of the snapshot: every table and every row of the original exists in the snapshot (0 rows only in the original). The snapshot
  additionally holds work done on 2026-11-18 .. 2026-11-21 (projects `atest` and `test-1`, 97 more document rows, 45 more audit rows, later session rows).
* Project folders: five of the original's project folders were byte-identical to the live ones; `sample-hydraulic-pump-2` existed **only** in the original
  workspace (35 files, the live workspace had lost it); `stest` differed in one file (the live copy of one data module had been re-serialised on 2026-11-22; the
  original's authored bytes were restored). `atest` (159 files), `fgddd` (8) and `s1000d-test` (50) exist only in the live workspace and have no rows in the
  original database.
* The newer line's own DB (the snapshot) was **not** used as the base, because the instruction is explicit that the original is the source of truth. Its extra
  rows are preserved in the snapshot and its three live-only project folders are indexed again by the application at start-up (see 4).

## 2. Safety steps, in order

1. The whole live `workspace/` (1,100 files, 220 MB) was copied to `_backups/live-workspace-before-db-restore-20261122-210940/` (robocopy, verified by file count),
   and the three database files that matter were hashed (`_backups/db-restore-manifest-20261122-210940.json`). **No backup was overwritten or deleted.**
2. The restore was **rehearsed** on a scratch copy of that backup (`restore-workspace.cjs`, plan then apply), the application booted on it (migrations, start-up
   step, `/api/health`), and the result compared row by row with the original before anything was done to the live workspace.
3. The restore into the live workspace: `publisher.db` copied byte for byte from the recovered original (SHA-256 `bd4dbffa...433c11`, verified equal; refused if a
   `publisher.db` already exists); project folders added or, where bytes differed, replaced by the original's version after the live file had been copied aside;
   house templates and brand packs missing from the live workspace added (`xignal-s1000d.house.json`, `lnt-xignal`, `neutral`); nothing else touched.
4. The application was started in **development mode** (`npm run dev` equivalent, ts-node-dev) against the restored workspace.

## 3. Migrations applied (in order, additive, each in its own transaction)

`016-s1000d-reference` (catalogue, SNS preset, project configuration, project code / SNS / DM-type tables), `017-s1000d-completion` (lifecycle events, CIR links,
extension profiles), `018-sns-preset-model` (one nullable column), `019-review-comment-anchor` (one nullable column). Then the start-up step: seeds the S1000D
reference catalogue and the eight SNS presets, carries authored legacy rows once (none were authored: the four `sns` rows are the old demo seed), applies spec-
corrected DM-type defaults only where the row still holds the old placeholder, and derives a configuration for every project that has none.

Before 016 ran, the application took its own consistent copy (`VACUUM INTO`) as `workspace/backups/publisher-before-016-s1000d-reference-<timestamp>.db`.
**Defect found and fixed here:** that copy was skipped whenever a file with the standard name already existed, which is exactly the case when a database is
restored into a workspace that holds the snapshot of a *different* database. The file name is now never trusted as proof of protection: an existing file is left
exactly as it is and this database is copied beside it under a time-stamped name (`services/dbSnapshot.ts`, `backend/test/db-snapshot.test.js`).

## 4. Verification

* Integrity: `PRAGMA integrity_check` = `ok`, `PRAGMA foreign_key_check` = 0 rows, 19 migrations recorded.
* Data: against the recovered original, **0 rows missing in every original table** (users 3, projects 7, project_members 8, folder_owners 2, documents 454,
  revisions 250, blobs 246, audit_log 637, releases 3, notifications 11, sessions 14, cir_modules 1). Differences are only additive or explained: +15 new tables
  (reference catalogue, presets, configuration), `schema_migrations` +4, `config_items` +2 (the two start-up markers) and 1 changed (`wrngflds` default code
  `000` -> `029`, the specification-corrected default applied because the row held the old placeholder), `review_comments.anchor` (new empty column), `projects`
  +3 and `documents` +77 (the live-only folders `atest`, `fgddd`, `s1000d-test`, indexed from disk by the application at start-up, not data taken from the snapshot).
* Real workflows (on a scratch copy, passwords reset only there): sign-in as the real `admin`, `manager` and `author` accounts; the project list each sees matches
  the memberships in the database (manager 5 projects, author 2, admin all); a non-member is refused; for each of `stest`, `demo`, `skla`, `test`,
  `sample-hydraulic-pump-2`: open, summary, data-module list, read a module, migration-derived S1000D configuration, **both SNS systems**, validation, PDF
  publication and download, HTML publication. `stest` (218 data modules, the 00039 sample) is refused by the publication gate until its custom BREX is created - its
  modules name `DMC-RDR-A-00-00-00-00A-022A-D`, which the project never contained; the gate's own "Create the BREX" action creates it and the PDF builds.
* Projects whose modules disagree (`demo`: two model codes; `sample-hydraulic-pump-2`: issues 4.2 and 5.0) get a configuration with that field **left blank and a note**,
  not a guess.

## 5. What is left as it is (decisions for the owner)

* The snapshot's extra rows (project `test-1`, the 12 extra `sample-hydraulic-pump-2` document rows, later sessions and audit rows) are **not merged**: they belong to
  project folders that no longer exist in either workspace, so importing them would create records without files. The snapshot stays untouched in
  `workspace/backups/` and in `_backups/`; a selective, additive import can be done on request.
* `atest`, `fgddd`, `s1000d-test` (live-only folders, no rows in the original database) are now registered as projects without members: an administrator sees them;
  assign an owner under Team to use them.
* Passwords were not touched in the live database. The sessions table is as it was on 2026-11-20 (sessions expire by their stored time).
