'use strict';
// Migration 016-s1000d-reference. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      S1000D reference configuration: catalogues, SNS and per-project configuration. ADDITIVE ONLY.

      ref_sources        where reference data came from (file, sha-256, rule, limitation) - provenance is data, not a comment
      ref_codes          information / learn / learn-event / item-location codes, per S1000D issue. origin 'brex' rows are read
                         from the bundled default BREX and are never edited; origin 'custom' rows are the administrator's own
      ref_code_ranges    ranges the BREX leaves "project available" (a pattern, not a list: any code matching it is BREX-valid)
      ref_dmtype_codes   which codes a DM type RECOMMENDS (its default code lives in the dm-types table) (advice, never a restriction - BREX stays the validation authority)
      sns_presets / sns_preset_nodes   reusable SNS starting points (e.g. the S1000D 4.2 maintained SNS tables)
      project_config     one row per project: its S1000D configuration (MIC, issue, language, BREX, publication defaults ...)
      project_codes      the codes a project has enabled, when it narrows the catalogue (config.codeMode = 'selected')
      project_sns        the project's OWN SNS hierarchy: (project_id, path) -> title; path is "21", "21/1/0", "21/1/0/00"
      project_dm_types   the DM types a project offers (absent row = offered)
      catalogue_impacts  a record of every confirmed catalogue change that touched projects (what was previewed, who confirmed)
    */
    name: '016-s1000d-reference',
    sql: `
      CREATE TABLE IF NOT EXISTS ref_sources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, file TEXT, sha256 TEXT, issue TEXT,
        limitation TEXT, loaded_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ref_codes (
        kind TEXT NOT NULL, issue TEXT NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('brex','custom')),
        source_id TEXT, rule_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, issue, code)
      );
      CREATE TABLE IF NOT EXISTS ref_code_ranges (
        kind TEXT NOT NULL, issue TEXT NOT NULL, pattern TEXT NOT NULL, title TEXT NOT NULL, source_id TEXT, rule_id TEXT,
        PRIMARY KEY (kind, issue, pattern)
      );
      CREATE TABLE IF NOT EXISTS ref_dmtype_codes (
        schema TEXT NOT NULL, code TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (schema, code)
      );
      CREATE TABLE IF NOT EXISTS sns_presets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, source TEXT NOT NULL, limitation TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sns_preset_nodes (
        preset_id TEXT NOT NULL REFERENCES sns_presets(id) ON DELETE CASCADE, path TEXT NOT NULL,
        level INTEGER NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL, definition TEXT,
        PRIMARY KEY (preset_id, path)
      );
      CREATE TABLE IF NOT EXISTS project_config (
        project_id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS project_codes (
        project_id TEXT NOT NULL, kind TEXT NOT NULL, code TEXT NOT NULL, PRIMARY KEY (project_id, kind, code)
      );
      CREATE TABLE IF NOT EXISTS project_sns (
        project_id TEXT NOT NULL, path TEXT NOT NULL, level INTEGER NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL,
        preset_id TEXT, PRIMARY KEY (project_id, path)
      );
      CREATE TABLE IF NOT EXISTS project_dm_types (
        project_id TEXT NOT NULL, schema TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (project_id, schema)
      );
      CREATE TABLE IF NOT EXISTS catalogue_impacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT, change TEXT NOT NULL, impact TEXT NOT NULL
      );
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
