# Issue #33 — Batch Escrow Operations (Create / Claim / Cancel)

**Labels:** `contract` `feature` `escrow` `gas-optimization` `ux`

## Summary
Add `batch_create_escrow`, `batch_claim_escrow`, and `batch_cancel_escrow` entry-points that allow users to operate on up to 50 escrows in a single Soroban transaction, dramatically reducing gas costs and improving UX for high-volume users.

## Background

The existing escrow system (`escrow.rs`) requires one transaction per operation:

- **`create_escrow`**: Lock tokens until `release_ledger`. Each call: 1 transfer + 4 storage writes + TTL bumps.
- **`claim_escrow`** / **`claim_escrow_partial`**: Release funds after maturity. Each call: 1 transfer + 2 storage writes.
- **`cancel_escrow`**: Refund before maturity. Each call: 1 transfer + 2 storage writes.

A payroll provider creating 30 employee salary escrows at month-end must submit 30 separate transactions, paying Soroban's per-transaction base fee 30 times. For Stellar mainnet at typical fee levels, this is noticeably expensive compared to a single batched call.

The contract already has `batch_send` (batch token transfers to ≤50 recipients in one call, in `batch_send.rs`) which proves the batching pattern works within Soroban's resource budget. Escrow operations follow the same pattern — iterate over an input list, perform the same operation on each item, accumulate results.

## Problem Statement

High-volume escrow users (payroll providers, subscription services, DAO disbursement tools) face prohibitive gas costs from per-transaction overhead. A batch API would reduce costs by ~30× for max-size batches and make Finchippay competitive with traditional payment rails.

## Objectives

1. Implement `batch_create_escrow(env, token, from, recipients: Vec<BatchEscrowInput>) -> Vec<u32>` that creates up to `MAX_BATCH_SIZE` (50) escrows in one call.
2. Implement `batch_claim_escrow(env, escrow_ids: Vec<u32>) -> Vec<i128>` that claims up to 50 matured escrows.
3. Implement `batch_cancel_escrow(env, escrow_ids: Vec<u32>) -> Vec<i128>` that cancels up to 50 pending escrows.
4. Return partial-success results — if escrow #3 of 30 fails (already claimed), escrows #1, #2, #4–#30 still succeed.
5. Stay within Soroban's per-transaction resource budget for max-size (50) batches.

## Detailed Implementation Requirements

### 1. Data structures

```rust
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchEscrowInput {
    pub to: Address,
    pub amount: i128,
    pub release_ledger: u32,
    pub memo: Symbol,
}

#[contracttype]
#[derive(Clone, Debug)]
pub enum BatchEscrowResult {
    Success(u32),       // escrow ID
    Skipped(u32),       // index of skipped item with reason
}

#[contracttype]
#[derive(Clone, Debug)]
pub enum BatchClaimResult {
    Success(i128),      // amount claimed
    Skipped(u32),       // index with reason (not found, not matured, already claimed)
}
```

### 2. `batch_create_escrow`

- Accept `token_address`, `from`, and `recipients: Vec<BatchEscrowInput>`.
- `from.require_auth()` once (not per-item).
- Validate `recipients.len() <= MAX_BATCH_SIZE`.
- Transfer total sum from `from` to contract in **one** `require_transfer_succeeded` call **before** iterating. This avoids N transfers and prevents partial-funding states.
- For each recipient: validate bounds (`MAX_ESCROW_AMOUNT`, `MIN_ESCROW_AMOUNT`, `MAX_ESCROW_LEDGERS`, `MAX_USER_ESCROWS`). If validation fails, push `Skipped(index)` and continue.
- If validation passes, create escrow, push to recipient index, increment global counter.
- After all items, emit a single `batch_escrow_created` event with `(from, count_created, count_skipped, total_amount)`.
- Return `Vec<BatchEscrowResult>`.

**Key optimization**: Instead of calling `increase_locked_balance` per item (N storage writes), compute the total actually-created amount and update locked balance once at the end.

### 3. `batch_claim_escrow`

- Accept `escrow_ids: Vec<u32>`.
- `env.current_contract_address()` (no caller auth — each escrow's `to.require_auth()` is called individually within the loop, but since Soroban batches auth, this should be done upfront via a multi-auth pattern or by collecting all required signers).
- **Auth strategy**: Collect all unique `to` addresses from the escrows, call `require_auth()` on each. For escrows whose `to` didn't sign, skip with `Skipped`.
- For each escrow: load, check `Pending` status, check `release_ledger` reached, transfer, mark `Released`.
- Accumulate total claimed amount, update locked balance once.
- Emit `batch_escrow_claimed` event.
- Return `Vec<BatchClaimResult>`.

### 4. `batch_cancel_escrow`

- Mirror `batch_claim_escrow` but for `from` auth and pre-release-ledger check.
- Only the escrow creator (`from`) can cancel — all escrows in the batch must share the same `from` address, or multi-auth is required.

### 5. Resource budget analysis

For a 50-item batch:
- **Storage reads**: 50 escrow loads + 50 recipient index loads ≈ 100 reads. Soroban's default read budget is ~40–50 entries. **Mitigation**: implement as a two-phase function using the TTL sweep pattern — process in chunks of 20, persist a cursor, require repeated calls.
- **Storage writes**: 50 status updates + 1 locked balance update ≈ 51 writes. Within budget.
- **CPU**: 50 iterations of validation + transfer ≈ 5M instructions. Within budget.

Given the read budget constraint, implement as a **cursor-based batched operation** — `batch_claim_escrow(env, escrow_ids, start_index: u32, max_items: u32) -> BatchClaimCursor` where each call processes up to 20 items and returns a cursor for the next call.

## Expected Architecture

```
contracts/finchippay-contract/src/
├── escrow.rs                   (+ batch_create_escrow, batch_claim_escrow, batch_cancel_escrow)
├── batch_send.rs               (reference pattern for cursor-based batching)
└── lib.rs                      (+ BatchEscrowInput, BatchEscrowResult, BatchClaimResult types)
```

## Acceptance Criteria

- [ ] `batch_create_escrow` creates up to 50 escrows in one call with correct per-item validation.
- [ ] `batch_claim_escrow` claims up to 20 matured escrows per cursor step.
- [ ] `batch_cancel_escrow` cancels up to 20 pending escrows per cursor step.
- [ ] Partial success: failed items don't block successful ones.
- [ ] Resource budget: 50-item create batch stays within Soroban limits (split across ≤3 cursor calls).
- [ ] `cargo test` passes with ≥10 new batch-specific tests (create, claim, cancel, partial failure, auth edge cases).
- [ ] Gas benchmarks show ≥20× cost reduction vs. individual calls for 20-item batch.
- [ ] Existing escrow tests continue to pass.
