# Issue #35 — Recipient-Initiated Stream Pause/Resume with Auto-Resume Deadline

**Labels:** `contract` `feature` `streams` `ux`

## Summary
Allow a stream recipient to temporarily pause the stream (stop the flow of claimable tokens) and later resume it, with an optional auto-resume deadline after which the stream automatically reactivates. This complements the existing payer-only `close_stream` and recipient-only `reject_stream` with a non-destructive middle ground.

## Background

The current streaming payment system (`streams.rs`) supports these lifecycle operations:

| Operation | Who can call | Effect |
|-----------|-------------|--------|
| `open_stream` | Payer | Create stream, deposit tokens |
| `claim_stream` | Recipient | Withdraw claimable tokens |
| `top_up_stream` | Payer | Add more tokens |
| `close_stream` | **Payer only** | End stream, pay recipient accrued + refund remainder |
| `reject_stream` | **Recipient only** | End stream, claim accrued + refund remainder to payer |
| `transfer_stream` | Recipient | Transfer stream to new recipient |

Both `close_stream` and `reject_stream` are **destructive** — the stream ends permanently. There is no way for a recipient to temporarily halt a stream without permanently ending it.

Use cases where recipient pause is needed:

1. **Compliance / KYC refresh**: A recipient's KYC status is under review for 48 hours. They need to pause incoming streams until cleared, then resume — not permanently reject the funds.
2. **Travel / offline period**: A recipient knows they'll be offline for 2 weeks and wants to pause streams so they don't accumulate claimable tokens (which could attract unwanted attention or complicate accounting).
3. **Dispute in progress**: A recipient is disputing the stream terms with the payer but doesn't want to reject it outright — pause while negotiating.
4. **Tax threshold management**: A recipient pauses streams near the end of a tax year to manage reportable income thresholds, resuming in the new year.

## Problem Statement

The only recipient-controlled lifecycle action is the nuclear option (`reject_stream`). There's no way to pause without permanently ending the relationship with the payer. This is a significant UX gap for real-world payment streams.

## Objectives

1. Add `pause_stream_by_recipient(env, stream_id, recipient, auto_resume_ledger: Option<u32>)` — pauses accrual, optionally setting an auto-resume deadline.
2. Add `resume_stream_by_recipient(env, stream_id, recipient)` — resumes a recipient-paused stream.
3. Add `get_stream_pause_info(env, stream_id)` — returns pause state and auto-resume ledger.
4. Track pause reason as an optional `Symbol` for off-chain context.
5. Ensure a paused stream still allows the payer to `top_up_stream` and `close_stream`.
6. Ensure a paused stream's claimable amount freezes at the pause point — no tokens accrue while paused.

## Detailed Implementation Requirements

### 1. Stream struct extension

Add fields to `Stream`:
```rust
pub struct Stream {
    // ... existing fields ...
    /// Whether the recipient has paused the stream.
    pub recipient_paused: bool,
    /// Ledger at which the recipient paused (0 if not paused).
    pub recipient_paused_at: u32,
    /// Total ledgers the stream has been paused by the recipient.
    pub recipient_paused_duration: u32,
    /// Ledger at which the stream auto-resumes, if set (0 = no auto-resume).
    pub auto_resume_ledger: u32,
    /// Symbol describing why the stream was paused (e.g., "kyc_review", "travel").
    pub pause_reason: Symbol,
}
```

Note: The existing `paused_at_ledger` and `total_paused_duration` fields are for **payer-initiated** pause (contract-level circuit breaker / admin pause). The new fields are specifically for **recipient-initiated** pause and should be tracked separately so both pause sources compose correctly.

### 2. `pause_stream_by_recipient`

```rust
pub fn pause_stream_by_recipient(
    env: Env,
    stream_id: u32,
    recipient: Address,
    auto_resume_ledger: Option<u32>,
    reason: Symbol,
)
```

- `recipient.require_auth()`.
- Stream must not be closed.
- Stream must not already be paused by recipient.
- If `auto_resume_ledger` is `Some(L)`, require `L > env.ledger().sequence()` and `L <= env.ledger().sequence() + MAX_PAUSE_LEDGERS` (e.g., 1 year ≈ 6,307,200 ledgers).
- Set `recipient_paused = true`, `recipient_paused_at = env.ledger().sequence()`, `auto_resume_ledger = L | 0`, `pause_reason = reason`.
- Emit `stream_paused_by_recipient` event with `(stream_id, recipient, auto_resume_ledger, reason)`.

### 3. `resume_stream_by_recipient`

```rust
pub fn resume_stream_by_recipient(env: Env, stream_id: u32, recipient: Address)
```

- `recipient.require_auth()`.
- Stream must be paused by recipient.
- Accumulate paused duration: `recipient_paused_duration += env.ledger().sequence() - recipient_paused_at`.
- Set `recipient_paused = false`, `recipient_paused_at = 0`, `auto_resume_ledger = 0`.
- Emit `stream_resumed_by_recipient` event.

### 4. Auto-resume in `claim_stream`

Before computing claimable amount in `claim_stream`, check:
```rust
if stream.recipient_paused && stream.auto_resume_ledger > 0
   && env.ledger().sequence() >= stream.auto_resume_ledger {
    // Auto-resume: accumulate duration and clear pause state
    stream.recipient_paused_duration += env.ledger().sequence() - stream.recipient_paused_at;
    stream.recipient_paused = false;
    stream.recipient_paused_at = 0;
    stream.auto_resume_ledger = 0;
}
```

This ensures that even if the recipient never calls `resume_stream_by_recipient`, the stream auto-resumes and the payer isn't stuck with a permanently frozen stream.

### 5. Update `claimable_at`

Modify the pure function to account for recipient pause:
```rust
pub fn claimable_at(stream: &Stream, current_ledger: u32) -> i128 {
    if current_ledger <= stream.start_ledger || stream.closed {
        return 0;
    }
    // ... existing pause logic ...
    let recipient_active_pause = if stream.recipient_paused {
        current_ledger.saturating_sub(stream.recipient_paused_at)
    } else { 0 };
    let effective_elapsed = current_ledger
        .saturating_sub(stream.start_ledger)
        .saturating_sub(stream.total_paused_duration)       // payer/admin pause
        .saturating_sub(active_paused_duration)              // active payer pause
        .saturating_sub(stream.recipient_paused_duration)    // accumulated recipient pause
        .saturating_sub(recipient_active_pause);             // active recipient pause
    // ... rest unchanged ...
}
```

### 6. Interaction with other operations

- **`top_up_stream`**: Allowed while recipient-paused. No change needed.
- **`close_stream`**: Payer can close even if recipient-paused. Auto-claim accrued tokens (up to pause point), refund remainder.
- **`reject_stream`**: Recipient can reject even if paused (this cancels the pause).
- **`transfer_stream`**: Allowed while paused. New recipient inherits pause state.

### 7. Maximum pause duration

```rust
const MAX_PAUSE_LEDGERS: u32 = 6_307_200; // ~1 year at 5s/ledger
```

Prevents a recipient from pausing a stream indefinitely with a far-future auto-resume.

## Expected Architecture

```
contracts/finchippay-contract/src/
├── streams.rs                  (+ pause_stream_by_recipient, resume_stream_by_recipient,
│                                  modified claim_stream, modified claimable_at)
├── lib.rs                      (+ new Stream fields, MAX_PAUSE_LEDGERS constant)
└── tests/
    └── integration.rs          (+ pause/resume lifecycle tests)
```

## Acceptance Criteria

- [ ] Recipient can pause an open stream with an optional auto-resume deadline.
- [ ] `claimable_at` returns 0 additional tokens while paused (existing claimable still accessible).
- [ ] Recipient can resume a paused stream; `claimable_at` resumes accrual from resume point.
- [ ] Auto-resume fires correctly when `claim_stream` is called after the deadline.
- [ ] Payer can still `top_up_stream` and `close_stream` on a recipient-paused stream.
- [ ] `reject_stream` works on a recipient-paused stream (pause state cleared).
- [ ] Pause beyond `MAX_PAUSE_LEDGERS` is rejected.
- [ ] New property tests verify pause doesn't break `claimable_at` invariants (I1–I8 from #32).
- [ ] `cargo test` passes with ≥6 new pause-specific tests.
- [ ] Existing stream tests continue to pass.
