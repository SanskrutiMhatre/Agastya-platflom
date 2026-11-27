'use strict';
// Migration 018-sns-preset-model. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      018 - SNS presets can belong to a model: the Administrator types the model code (and, in the preset's name, the model name), builds the model's systems,
      subsystems and assemblies once, and a project with that model code is offered that SNS when it is created. Additive: one nullable column.
    */
    name: '018-sns-preset-model',
    sql: `ALTER TABLE sns_presets ADD COLUMN model_code TEXT;`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
