# Issue #34 — Dispute Resolution: Timelock, Appeal Mechanism & Arbitrator Accountability

**Labels:** `contract` `security` `governance` `escrow` `dispute-resolution`

## Summary
Harden the escrow dispute resolution system with a mandatory review period before resolution, a two-tier appeal mechanism, and on-chain arbitrator accountability (stake slashing for malicious resolutions).

## Background

The current dispute resolution flow (`escrow.rs`) allows a single designated arbitrator to unilaterally resolve disputes with immediate effect:

```
raise_dispute → (arbitrator reviews off-chain) → resolve_dispute(arbitrator, resolution, to, amount)
```

The `resolve_dispute` function supports three resolution types: `"release"` (to recipient), `"refund"` (to sender), and `"split"` (partial to both). There is **no timelock** — the arbitrator can resolve instantly after a dispute is raised. There is **no appeal** — the arbitrator's decision is final. There is **no accountability** — an arbitrator can collude with one party, resolve in their favor, and face zero on-chain consequence.

For a production-grade payment escrow system handling real value, this is insufficient. The system needs:

1. **Review period**: mandatory N-ledger delay between `raise_dispute` and `resolve_dispute` so both parties can review evidence.
2. **Appeal mechanism**: either party can escalate to a higher-tier arbitrator or a multi-sig panel.
3. **Arbitrator stake**: arbitrators must lock a stake that can be slashed if a resolution is successfully appealed.

## Problem Statement

A compromised or colluding arbitrator can steal escrowed funds with zero on-chain friction. This undermines trust in the dispute resolution system and makes disputable escrows riskier than non-disputable ones — the opposite of the intended design.

## Objectives

1. Add a configurable `DISPUTE_REVIEW_LEDGERS` constant (default: 1,000 ledgers ≈ 83 minutes at 5s/ledger).
2. Enforce that `resolve_dispute` can only be called after `dispute_raised_at + DISPUTE_REVIEW_LEDGERS`.
3. Implement an appeal mechanism: either party can call `appeal_dispute(escrow_id, appeal_to: Address)` to escalate to a higher-tier arbitrator within the review period.
4. Add arbitrator registration with a staking requirement: `register_arbitrator(env, arbitrator, stake_amount, token)` locks stake in the contract.
5. Implement `slash_arbitrator(escrow_id)` — if a resolution is successfully appealed and the appeal arbitrator reverses it, the original arbitrator's stake is partially or fully slashed (transferred to the prevailing party).
6. Add a `MAX_APPEAL_DEPTH` constant (default: 2) to prevent infinite appeal chains.

## Detailed Implementation Requirements

### 1. Constants & storage

```rust
/// Mandatory delay between dispute raised and resolution allowed.
const DISPUTE_REVIEW_LEDGERS: u32 = 1_000; // ~83 min

/// Maximum depth of appeal chain (prevents griefing).
const MAX_APPEAL_DEPTH: u32 = 2;

/// Minimum stake an arbitrator must lock to be registered.
const MIN_ARBITRATOR_STAKE: i128 = 100_000_000; // 100 XLM in stroops
```

Add to `Escrow` struct:
```rust
pub appeal_depth: u32,             // 0 = not appealed, 1 = first appeal, 2 = second appeal
pub appeal_arbitrator: Option<Address>, // set when appealed
pub resolution_ledger: u32,        // ledger at which resolution was executed
```

Add new storage keys:
```rust
DataKey::ArbitratorStake(Address), // i128 — locked stake amount
DataKey::ArbitratorStakeToken(Address), // Address — token of the stake
```

### 2. `raise_dispute` enhancement

- Store `dispute_raised_at = env.ledger().sequence()` (already done).
- Emit event with review-period-end ledger for off-chain UI.

### 3. `resolve_dispute` timelock enforcement

Add check at the top of `resolve_dispute`:
```rust
if env.ledger().sequence() < escrow.dispute_raised_at + DISPUTE_REVIEW_LEDGERS {
    panic!("Review period has not elapsed");
}
```

### 4. `appeal_dispute` entry-point

```rust
pub fn appeal_dispute(env: Env, escrow_id: u32, appellant: Address, appeal_to: Address)
```

- Only `from` or `to` of the escrow may appeal.
- Must be called before `resolve_dispute` is executed.
- Must be called within the review period (before `dispute_raised_at + DISPUTE_REVIEW_LEDGERS`).
- `appeal_to` must be a different registered arbitrator than the current one.
- `escrow.appeal_depth` must be < `MAX_APPEAL_DEPTH`.
- Updates `escrow.arbitrator = Some(appeal_to)`, increments `appeal_depth`.
- Resets `dispute_raised_at` to current ledger (new review period for new arbitrator).
- Emits `dispute_appealed` event.

### 5. Arbitrator registration with stake

Modify `add_arbitrator`:
```rust
pub fn add_arbitrator(env: Env, admin: Address, arbitrator: Address, stake_token: Address, stake_amount: i128)
```

- Admin-gated (or can be self-serve with `arbitrator.require_auth()`).
- `stake_amount >= MIN_ARBITRATOR_STAKE`.
- Transfers stake from arbitrator (or admin-funded pool) to contract.
- Stores `(stake_amount, stake_token)` in `DataKey::ArbitratorStake`.

### 6. `slash_arbitrator` logic

- Called automatically as part of `appeal_dispute` when the new arbitrator resolves differently from the original.
- Or called explicitly by admin after an off-chain governance decision.
- Transfers slashed amount (e.g., 50% of stake) to the prevailing party, burns remainder (or returns to admin treasury).

```rust
fn slash_arbitrator(env: &Env, arbitrator: &Address, beneficiary: &Address, amount: i128) {
    // Transfer `amount` of the arbitrator's stake to the beneficiary
    // The remaining stake stays locked
}
```

### 7. Multi-tier arbitrator hierarchy

Add a `tier` field to the arbitrator registration:
```rust
pub tier: u32, // 0 = primary, 1 = appellate, 2 = final
```

- Appeals can only go to a higher-tier arbitrator.
- Tier 2 (MAX_APPEAL_DEPTH) resolutions are final.

## Expected Architecture

```
contracts/finchippay-contract/src/
├── escrow.rs                   (~ appeal_dispute, slash_arbitrator, modified resolve_dispute/raise_dispute)
├── lib.rs                      (+ new structs, DataKey variants, storage keys)
└── tests/
    └── integration.rs          (+ dispute lifecycle tests with appeals and slashing)
```

## Acceptance Criteria

- [ ] `resolve_dispute` rejects calls before the review period elapses.
- [ ] `appeal_dispute` allows either party to escalate within the review period.
- [ ] Appeal to the same arbitrator is rejected.
- [ ] Appeal beyond `MAX_APPEAL_DEPTH` (2) is rejected.
- [ ] Arbitrator registration requires minimum stake.
- [ ] `slash_arbitrator` transfers stake to prevailing party on successful appeal.
- [ ] Existing escrow tests (non-disputable) continue to pass.
- [ ] ≥8 new dispute-specific tests (timelock, appeal, slashing, depth limit).
- [ ] `cargo test` passes.
