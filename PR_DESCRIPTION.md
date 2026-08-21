## Summary

Adds milestone-based conditional releases to the escrow contract. Where the existing escrow releases a single lump sum at a fixed ledger (`create_escrow` → `claim_escrow`/`cancel_escrow`), milestone escrows hold a deposit and pay it out in stages: an escrow agent (or the client) approves individual milestones, and the recipient claims each approved milestone. This gives freelancers, contractors, and DAO contributors a way to structure payments around deliverables without trusting the payer to release funds manually.

## Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Documentation update
- [ ] Refactor / chore
- [x] Smart contract change

## Related issue

Closes #476

## What this fixes / the gap

The escrow system had no partial or staged release path. `EscrowStatus` was limited to `Pending`/`Released`/`Cancelled`, and `claim_escrow` moved the entire balance at once after a single `release_ledger`. There was no way to hold funds and release them gradually as work milestones are approved.

## The fix and why this approach

New contract surface:

- `create_milestone_escrow(token, from, to, agent, milestones, deposit)` — validates 1..=10 milestones, positive amounts, milestone amounts summing **exactly** to the deposit, an approval deadline that is in the future (when set), and that `agent != to` (the recipient must not be able to self-approve); transfers the full deposit into the contract and assigns sequential milestone ids `0..n`.
- `approve_milestone(id, milestone_id, approver)` — only the designated `agent` or the client (`from`) may approve; enforces the per-milestone `approval_deadline_ledger`.
- `claim_milestone(id, milestone_id, recipient)` — only the recipient may claim; pays the approved milestone and marks the escrow `Released` once the **last** milestone is claimed.
- `get_milestones(id)` and `get_escrow_summary(id)` — read-only views for dashboards/off-chain consumers.

Data model: `Escrow` gains `agent: Option<Address>`, `milestones: Vec<Milestone>`, and `is_milestone_based: bool`; new `Milestone` and `EscrowSummary` contract types. Existing escrows are unaffected (`is_milestone_based = false`, empty milestones).

**Design choice — milestones live inside the `Escrow` record** (which is stored in the recipient's index, the repo's existing pattern) rather than a separate `DataKey::EscrowMilestone(escrow_id, milestone_id)` per-milestone store. Rationale: a single source of truth that is updated in place exactly like `amount`/`status` already are (`claim_escrow_partial` follows the same shape), avoiding dual-write inconsistencies between two storages. The acceptance criteria (partial claims, role checks, cancellation refunds, ≥8 tests) are all met by this layout.

**Critical-path guards (funds custody):**

- `claim_escrow` / `claim_escrow_partial` now refuse milestone escrows (`panic!("milestone escrow must be claimed via claim_milestone")`), so the generic path can never drain a staged escrow.
- `cancel_escrow` on a milestone escrow refunds **only unclaimed** milestone amounts — claimed milestones stay with the recipient. There is no single release ledger for milestone escrows, so cancellation is allowed while `Pending` (each milestone carries its own approval deadline instead).
- Locked-balance accounting (`increase_locked_balance`/`decrease_locked_balance`) is preserved on create, claim, and cancel, so `rescue_tokens`/balance reconciliation invariants hold.
- All state mutations are committed before the external token transfer (checks-effects-interactions), matching the existing re-entrancy-hardened escrow functions, and each function is covered by the `ReentrancyGuard`.

Trade-offs to be aware of:

- Milestone escrows are not disputable in this change (no `arbitrator`); dispute resolution is out of scope per the issue and can be layered on later.
- On-chain milestone verification is intentionally out of scope — approval is a role-based off-chain decision by the agent/client, as the issue specifies.
- `release_ledger` is stored as `0` for milestone escrows; it is cosmetic for them (claims are gated on approval, cancellation on the milestone flags) and is never used on this path.

## Changes

- `contracts/finchippay-contract/src/lib.rs`: `Milestone` and `EscrowSummary` contract types; `Escrow` extended with `agent`/`milestones`/`is_milestone_based`; `MAX_MILESTONES = 10`; contract wrappers for the five new entry points; 14 new unit tests.
- `contracts/finchippay-contract/src/escrow.rs`: `create_milestone_escrow`, `approve_milestone`, `claim_milestone`, `get_milestones`, `get_escrow_summary`; milestone guards on `claim_escrow`/`claim_escrow_partial`; milestone-aware cancellation in `cancel_escrow`; both existing escrow constructors set the new fields.
- Events: `milestone_escrow_created (id, milestone_count)`, `milestone_approved (escrow_id, milestone_id)`, `milestone_claimed (escrow_id, milestone_id, amount)` — same inline-symbol publishing style as the existing escrow events.

## Testing

- [ ] Tested locally on Testnet
- [x] Added/updated unit tests
- [ ] Manually tested UI flow

14 new unit tests in `contracts/finchippay-contract/src/lib.rs` (`test_milestone_escrow_*`): create validation (deposit moved, ids assigned, summary), partial release lifecycle (agent approves → recipient claims → escrow `Released` after last milestone), client-as-approver, unauthorized approver and unauthorized claim rejection, claim-before-approval, double-claim, cancellation refunding only unclaimed amounts, generic `claim_escrow` blocked on milestone escrows, amounts-must-sum-to-deposit, >10 milestones rejected, zero-amount milestone rejected, agent-must-not-be-recipient, approval-deadline enforcement, and exact event topics/data.

Verified locally:

- `cargo test` — full suite passes: 129 lib tests + all integration test binaries (previously 115 lib tests).
- `cargo check --target wasm32v1-none` — clean.
- `cargo build --target wasm32v1-none --release` — clean.
- `cargo clippy --all-targets` — no new warnings from this change (remaining warnings are pre-existing in unrelated test/bench files).

## Follow-ups worth filing separately

- Dispute resolution for milestone escrows (arbitrator-mediated approval overrides).
- Auto-expiry sweep: milestones past `approval_deadline_ledger` could be flagged refundable without an explicit cancel.
- SDK/docs coverage for the new entry points (dashboard summary consumption).

## Screenshots (if UI change)

N/A — contract-only change.

## Checklist

- [x] My code follows the project style
- [x] I've updated docs if needed
- [x] No console errors or warnings
- [x] I've rebased on latest `main`
