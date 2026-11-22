# The two SNS systems (kept separate on purpose)

The platform has **two independent SNS (Standard Numbering System) implementations**. They were built at different times for different jobs. The owner decided
(2026-11-22) to **keep both, side by side, and not to merge, rename, delete or migrate either into the other**. This page says what each one is, where it lives,
what touches it, and how that separation is enforced and tested.

| | System 1 - presets and the project SNS | System 2 - the row model |
|---|---|---|
| **Job** | Start a project from a reference SNS (the eight S1000D Issue 4.2 Chap 8.2 tables, or an organisation's own model SNS) and let the project own an edited copy | Author, order and check the SNS as rows; derive the publication structure from it; learn it from existing data modules; import it from a BREX |
| **Shape** | A tree keyed by a path (`21`, `21/1/0`, `21/1/0/00`) with a title per node | Flat rows with `systemCode`, `subSystemCode`, `subSubSystemCode`, `assyCode`, `title`; the tree is derived |
| **Project data** | SQLite table `project_sns` (`project_id, path, level, code, title, preset_id`) in `publisher.db` | `workspace/projects/<id>/.sns.json` (a dot-file: it travels with a copy of the project and the document index ignores it) |
| **Organisation data** | Tables `sns_presets` (with `model_code`, migration 018) and `sns_preset_nodes`; seeded with the eight 4.2 presets | Rows in `config_items`, collection `sns-defaults` (the "SNS defaults") |
| **Code** | `backend/src/services/sns.ts`, `routes/s1000d.ts`, `services/s1000dRef.ts`, `services/bootReference.ts` | `backend/src/services/sns/*` (`model.ts`, `store.ts`, `service.ts`, `derive.ts`, `learn.ts`, `dms.ts`, `pmxml.ts`, `codes.ts`), `routes/sns.ts` |
| **Project API** | `GET/POST/PATCH/DELETE /api/projects/:id/sns`, `POST .../sns/preset`, `GET .../sns/export`, `POST .../sns/import` | `GET/POST /api/projects/:id/sns-rows`, `PUT/DELETE .../sns-rows/:rowId`, `.../ordering`, `.../title`, `.../derive`, `.../import-brex`, `.../import-defaults`, `.../learn` |
| **Administrator API** | `/api/s1000d/presets`, `/api/admin/s1000d/presets/...` | `/api/sns/defaults`, `/api/sns/defaults/:rowId`, `/api/sns/defaults/merge-legacy` |
| **Studio / UI** | Project configuration: SNS section; Administrator: "Numbering (SNS)" / SNS presets | Project: "SNS" page; Administrator: "SNS defaults" |
| **Who may write** | project manager / owner (`config.write`) | editor and above (`pm.write`); defaults: administrator |
| **Audit actions** | `project.sns.added/updated/deleted`, `sns.preset.*` | `sns.created`, `sns.ordering`, `sns.defaults.*` |

## The contract

1. **Neither system reads or writes the other's storage.** System 1 never touches `.sns.json` or `config_items`/`sns-defaults`; system 2 never touches
   `project_sns`, `sns_presets` or `sns_preset_nodes`.
2. **Nothing is copied across automatically.** Creating a project, creating a preset, adding an organisation default or importing a BREX changes one system only.
   A new project starts empty in both (a model-coded project may be offered a preset by system 1 at creation; that fills system 1 only).
3. **Neither is renamed or removed.** URLs, table names, file names and collection names above are stable. A database or workspace that holds data for one
   system and none for the other is normal.
4. **The retired flat `sns` table** (`config_items` collection `sns`, the demo rows of the very first version) belongs to neither. Migration 016's start-up step
   (`bootReference.carryOverLegacy`) copies authored rows from it **once** into a system 1 preset named "Migrated flat SNS" (the four seed rows are skipped as demo
   content), and the old rows are left where they are. The row-model screen has a separate, explicit "merge legacy" action into the organisation defaults.

## How it is verified

* `backend/test/sns-separation.test.js` - writes through one system and asserts the other (API and storage) did not change, in both directions; deletes in one;
  checks a second project; checks the administrator surfaces (presets vs organisation defaults); checks a project created *after* organisation changes starts empty
  in both. Storage is asserted directly: `project_sns` rows, the presence of `.sns.json`, `config_items` and `sns_presets`.
* System 1 alone: `backend/test/s1000d-reference.test.js`, `s1000d-migration.test.js`, the e2e `s1000d-config.spec.ts`.
* System 2 alone: `backend/test/sns.test.js`, `sns-http.test.js`, `sns-polish.test.js`, the e2e `project-sns.spec.ts` and `sns-admin-defaults.spec.ts`.
* The real restored database (see `docs/DATABASE_RESTORATION.md`): both endpoints answer for every real project; `project_sns` and `.sns.json` hold no authored
  data there (nothing to lose); the four legacy `sns` rows are still in `config_items`.

## What "unifying" would take (not done; for the owner)

A single SNS would need: one storage choice; a one-time, reversible import of `.sns.json` rows into `project_sns` (or the reverse) with a report; one set of
endpoints with the other pair kept as aliases for a release; and one Studio screen. None of that is started, by decision.
