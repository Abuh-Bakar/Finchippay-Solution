#!/usr/bin/env node

/**
 * src/db/migrate-status.js
 * Report migration status and fail (exit 1) if any migrations are pending.
 *
 * Used by `npm run migrate:status` and the CI gate: unlike the built-in
 * `knex migrate:status`, this exits non-zero when the database schema is not
 * fully migrated, so CI fails on unrun migrations.
 *
 * Usage: node src/db/migrate-status.js
 */

"use strict";

require("dotenv").config();

const knex = require("./connection");

async function main() {
  try {
    // knex.migrate.list() → [completedMigrations, pendingMigrations]. Entry
    // shape varies by knex version (string filename or { name/file }), so
    // normalise before printing.
    const label = (m) =>
      typeof m === "string" ? m : m.name || m.file || JSON.stringify(m);

    const [completed, pending] = await knex.migrate.list();

    console.log(`Completed migrations: ${completed.length}`);
    completed.forEach((m) => console.log(`  ✔ ${label(m)}`));

    console.log(`Pending migrations: ${pending.length}`);
    pending.forEach((m) => console.log(`  ✗ ${label(m)}`));

    await knex.destroy();

    if (pending.length > 0) {
      console.error(
        `\n${pending.length} pending migration(s). Run \`npm run migrate\`.`,
      );
      process.exit(1);
    }

    console.log("\nDatabase schema is up to date.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to read migration status:", err.message);
    console.error(err.stack);
    await knex.destroy();
    process.exit(1);
  }
}

main();
