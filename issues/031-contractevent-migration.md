# Issue #31 — Migrate from `env.events().publish()` to `#[contractevent]` Macro

**Labels:** `contract` `soroban` `technical-debt` `pre-mainnet` `events`

## Summary
Replace all `env.events().publish()` calls with the structured `#[contractevent]` macro across all contract modules. The current approach relies on `#[allow(deprecated)]` and raw tuples — the Soroban SDK's `#[contractevent]` provides typed, schema-enforced events that indexers and SDKs can consume reliably.

## Background

The contract currently emits events using the low-level `env.events().publish()` API throughout all modules:

- **lib.rs**: ~50 call sites across tips, receipts, escrows, streams, multi-sig, vesting, emergency withdrawal, admin governance, upgrades, TTL sweeps, and rescue tokens. The entire `FinchippayContract` impl block carries `#[allow(deprecated)]`.
- **escrow.rs**: `escrow_create`, `escrow_claim`, `escrow_cancelled`, `disputable_escrow_created`, `dispute_raised`, `dispute_resolved`, `arbitrator_added`, `arbitrator_removed`
- **streams.rs**: `stream_open`, `stream_claim`, `stream_topped_up`, `stream_close`/`stream_closed`, `stream_reject`, `stream_transfer`
- **yield_escrow.rs**: `yield_escrow_create`, `yield_escrow_claim`, `yield_escrow_cancelled`
- **batch_send.rs**, **airdrop.rs**, **multi_sig.rs**: various event emissions

The `publish()` API takes raw `(Symbol, ...)` tuples with implicit data types, making event schemas fragile across contract upgrades. The `#[contractevent]` macro (stable in soroban-sdk >= 22.0) generates typed structs with automatic SCVal encoding, enables SDK codegen for event listeners, and integrates with Soroban's event filtering on RPC.

The `events.rs` module provides a structured `Events` helper with `Symbol::new` factory functions, but these are not used consistently — most modules construct `Symbol::new(env, "event_name")` inline.

## Problem Statement

1. **Deprecation**: The contract cannot upgrade to newer soroban-sdk versions that may remove `publish()`.
2. **Schema fragility**: Adding/removing fields from event tuples silently breaks downstream indexers, dashboards, and SDK consumers.
3. **No type safety**: Events are raw tuples — a field-type mismatch compiles but emits garbage data.
4. **Missed SDK integration**: Soroban RPC's `getEvents` filtering on contract event topics doesn't work with ad-hoc tuple events.
5. **Audit blocker**: Third-party auditors flag deprecated API usage as a pre-mainnet concern.

## Objectives

1. Define typed `#[contractevent]` structs for every event in the event catalog (see `events.rs`).
2. Replace all `env.events().publish(...)` calls with `env.events().publish(&event_struct)`.
3. Remove `#[allow(deprecated)]` from the contract impl block.
4. Update all unit tests, integration tests, and fuzz targets to assert on typed events.
5. Update the backend event indexer (`backend/src/services/eventIndexer.js`) to parse the new typed event format.
6. Update `events.rs` to document the new typed event structs alongside the existing catalog.

## Scope

- **In scope**: All 50+ event emission sites across `lib.rs`, `escrow.rs`, `streams.rs`, `yield_escrow.rs`, `batch_send.rs`, `airdrop.rs`, `multi_sig.rs`.
- **Out of scope**: Changing event semantics or adding new events; SDK release for typed events (track separately).

## Detailed Implementation Requirements

### 1. Define typed event structs

Create one `#[contractevent]` struct per distinct event in the catalog. Each struct carries typed fields matching the current tuple payloads. Example:

```rust
#[contractevent]
pub struct TipSent {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub ledger: u32,
}

#[contractevent]
pub struct EscrowCreated {
    pub escrow_id: u32,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    pub release_ledger: u32,
}
```

### 2. Replace publish() calls

Replace every `env.events().publish((Symbol::new(&env, "tip_sent"),), (from, to, amount, ledger))` with:

```rust
env.events().publish(&TipSent { from: from.clone(), to: to.clone(), amount, ledger });
```

### 3. Remove #[allow(deprecated)]

Once no `publish()` calls remain, remove the attribute from the `#[contractimpl]` block.

### 4. Update the Events helper module

Deprecate the `Events` struct's factory functions in favor of the typed struct constructors. Keep the event catalog documentation in `events.rs` updated.

### 5. Update tests

- All unit tests that inspect event emissions must now assert on typed event structs.
- Integration tests must be updated to deserialize typed events.
- Fuzz targets must use typed events for assertions.

### 6. Update backend event indexer

The `backend/src/services/eventIndexer.js` parses raw tuple events from Horizon SSE. Update the parser to handle typed event structs with named fields.

## Event Migration Map

| Current publish() tuple | Typed struct |
|---|---|
| `("init",), admin` | `Init { admin: Address }` |
| `("tip_sent",), (from, to, amount, ledger)` | `TipSent { from, to, amount, ledger }` |
| `("escrow_create", id), (from, to, amount, release_ledger)` | `EscrowCreated { escrow_id, from, to, amount, release_ledger }` |
| `("stream_open", id), (payer, recipient, rate, deposit)` | `StreamOpened { stream_id, payer, recipient, rate, deposit }` |
| `("multisig_created", id), (proposer, recipient, amount, threshold, signers_count, expiration)` | `MultisigCreated { proposal_id, proposer, recipient, amount, threshold, signers_count, expiration_ledger }` |
| … all others from `events.rs` catalog | … |

## Acceptance Criteria

- [ ] All 50+ `env.events().publish()` calls replaced with typed event structs.
- [ ] `#[allow(deprecated)]` removed from contract impl.
- [ ] `cargo build --target wasm32v1-none` compiles without deprecation warnings.
- [ ] `cargo test` passes — all unit tests assert on typed events.
- [ ] Backend event indexer updated to parse typed events.
- [ ] Event catalog in `events.rs` updated.
- [ ] Integration test for at least 5 event types verifies round-trip.
