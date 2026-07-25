/**
 * src/db/connection.js
 * Database connection layer using Knex.
 *
 * The connection configuration lives in the canonical knexfile.js at the
 * backend root — the single source of truth shared with the `knex` CLI. This
 * module selects the config for the current NODE_ENV and exports a live Knex
 * instance used throughout the app (services require it via ./index or ../db).
 *
 * Environments (see knexfile.js): development | test | production.
 */

"use strict";

const knexConfig = require("../../knexfile");

const env = process.env.NODE_ENV || "development";
const config = knexConfig[env] || knexConfig.development;

// Validate the selected environment lazily (knexfile.js stays throw-free at
// load time so requiring it never fails on unrelated environments). A pg
// config with no connection string can't work, so fail fast with a clear
// message rather than a cryptic driver error later.
if (config.client === "pg" && !config.connection) {
  throw new Error(
    `DATABASE_URL must be set for NODE_ENV=${env} (DB_PROVIDER=postgres)`,
  );
}

const knex = require("knex")(config);

module.exports = knex;
