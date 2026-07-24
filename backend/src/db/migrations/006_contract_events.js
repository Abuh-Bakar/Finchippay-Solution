/**
 * Migration: Create contract_events table for Soroban event indexer.
 *
 * Stores on-chain events emitted by the FinchippayContract on the
 * Soroban smart contract platform.
 */

exports.up = function (knex) {
  return knex.schema.createTable("contract_events", (table) => {
    table.increments("id").primary();
    table.string("event_type", 64).notNullable();
    table.string("contract_id").notNullable();
    table.integer("ledger_sequence").notNullable();
    table.timestamp("emitted_at").notNullable();
    table.jsonb("payload").defaultTo("{}");
    table.timestamp("created_at").defaultTo(knex.fn.now());

    table.index("event_type");
    table.index("contract_id");
    table.index("ledger_sequence");
    // Composite unique constraint to prevent duplicate event ingestion
    table.unique(
      ["ledger_sequence", "contract_id", "event_type"],
      "contract_events_dedup"
    );
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("contract_events");
};
