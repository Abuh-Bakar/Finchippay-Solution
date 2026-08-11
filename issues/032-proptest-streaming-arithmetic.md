# Issue #32 — Formal Property-Based Testing for `claimable_at` Streaming Arithmetic

**Labels:** `contract` `testing` `security` `streams` `formal-verification`

## Summary
Add a property-based testing harness for the `claimable_at` pure function and the streaming payment finite-state machine using the `proptest` framework. Verify critical invariants that, if violated, would cause fund loss or double-claim attacks.

## Background

The streaming payment system (`streams.rs`) is one of the most financially critical components of the contract. Its core arithmetic is in the pure function `claimable_at(stream: &Stream, current_ledger: u32) -> i128` defined in `lib.rs`:

```rust
pub fn claimable_at(stream: &Stream, current_ledger: u32) -> i128 {
    if current_ledger <= stream.start_ledger || stream.closed {
        return 0;
    }
    let active_paused_duration = if stream.paused_at_ledger > 0 {
        current_ledger.saturating_sub(stream.paused_at_ledger)
    } else { 0 };
    let effective_elapsed = current_ledger
        .saturating_sub(stream.start_ledger)
        .saturating_sub(stream.total_paused_duration)
        .saturating_sub(active_paused_duration);
    let total_streamed = stream.rate_per_ledger
        .checked_mul(effective_elapsed as i128)
        .expect("overflow");
    let capped = total_streamed.min(stream.deposited);
    (capped - stream.claimed).max(0)
}
```

The function is exercised by existing unit tests (`claimable_at` tests in `test.rs`), but only for hand-picked values. A subtle overflow in the paused-duration arithmetic, a timing edge case near `u32::MAX`, or an interaction between `paused_at_ledger` and `closed` could cause:

- **Overpayment**: `claimable_at` returns more than `deposited - claimed`, draining other users' funds.
- **Underpayment**: Streamed tokens become permanently unclaimable.
- **Division-by-zero-like edge**: The `checked_mul` can overflow if `rate_per_ledger * effective_elapsed` exceeds `i128::MAX`.

A single integer-edge-case bug could be catastrophic given the `MAX_STREAM_DEPOSIT` of 1 trillion stroops.

## Problem Statement

Manual unit tests cannot exhaustively explore the ~2^192 possible input combinations for `claimable_at`'s parameters. The current test suite covers happy paths only — no fuzzing exists for:

- Extreme ledger values near `u32::MAX`
- Edge cases around pause/resume boundaries
- Interaction of `closed`, `paused_at_ledger`, `total_paused_duration`
- `rate_per_ledger` near `MAX_STREAM_RATE` (10 billion)
- `deposited` near `MAX_STREAM_DEPOSIT` (1e18)

## Objectives

1. Add `proptest` as a dev-dependency in `Cargo.toml`.
2. Implement property tests for `claimable_at` covering 8+ invariants.
3. Implement property tests for the streaming state machine (open → claim → top-up → pause → close).
4. Run proptest as part of CI with a minimum of 10,000 cases per invariant.
5. Document any bugs found and fix them.

## Invariants to Verify

| # | Invariant | Significance |
|---|-----------|-------------|
| I1 | `claimable_at(s, ledger) >= 0` for all `(s, ledger)` | Never negative |
| I2 | `claimable_at(s, ledger) <= s.deposited - s.claimed` | Never overpay |
| I3 | If `s.closed`, `claimable_at(s, *) == 0` | Closed means zero |
| I4 | If `ledger <= s.start_ledger`, `claimable_at(s, ledger) == 0` | Not yet started |
| I5 | If `s.rate_per_ledger == 0`, `claimable_at(s, *) == 0` | Zero rate |
| I6 | `claimable_at(s, ledger2) >= claimable_at(s, ledger1)` for `ledger2 >= ledger1` (monotonic, no pause) | Time-monotonic |
| I7 | Pausing for N ledgers reduces claimable by exactly `rate * min(N, …)` | Pause correctness |
| I8 | `s.claimed + claimable_at(s, ledger) <= s.deposited` (round-trip invariant) | No double-claim possible |

## Detailed Implementation Requirements

### 1. Add proptest dependency

```toml
[dev-dependencies]
proptest = "1.5"
```

### 2. Strategy generators

Implement `Arbitrary` for `Stream` (or manual strategies using `proptest::strategy::Strategy`):

```rust
fn stream_strategy() -> impl Strategy<Value = Stream> {
    // Generate: id, payer/recipient as raw bytes, token as raw bytes,
    // rate_per_ledger in [0..MAX_STREAM_RATE],
    // deposited in [0..MAX_STREAM_DEPOSIT],
    // claimed in [0..deposited],
    // start_ledger in [0..u32::MAX/2],
    // paused_at_ledger in [0, start_ledger..u32::MAX/2],
    // total_paused_duration in [0..1_000_000],
    // closed in [true, false]
}
```

### 3. Property tests

Write tests in `contracts/finchippay-contract/tests/proptest_streaming.rs`:

```rust
proptest! {
    #[test]
    fn claimable_is_never_negative(stream in stream_strategy(), ledger in 0u32..u32::MAX) {
        let result = claimable_at(&stream, ledger);
        prop_assert!(result >= 0, "claimable_at returned {}", result);
    }

    #[test]
    fn claimable_never_exceeds_remaining_deposit(stream in stream_strategy(), ledger in 0u32..u32::MAX) {
        let result = claimable_at(&stream, ledger);
        prop_assert!(result <= stream.deposited - stream.claimed);
    }
    // ... all 8 invariants
}
```

### 4. CI integration

Add a CI step:
```yaml
- name: Property tests (streaming)
  run: cargo test --test proptest_streaming -- --nocapture
  timeout-minutes: 10
```

### 5. State machine tests

Model the streaming lifecycle as a state machine with transitions:
```
Open → [Claim*, TopUp*, Pause, Resume, Close, Reject, Transfer]
```
Use `proptest::state_machine` to generate random sequences of operations and verify end-state invariants (e.g., total tokens out ≤ total tokens in).

## Expected Architecture

```
contracts/finchippay-contract/
├── Cargo.toml                   (+ proptest dev-dep)
├── src/lib.rs                   (export claimable_at for testing)
└── tests/
    └── proptest_streaming.rs     (NEW: 8 invariant tests + state machine)
```

## Acceptance Criteria

- [ ] `proptest` added as dev-dependency.
- [ ] 8 invariant property tests pass with ≥10,000 cases each.
- [ ] State machine property test runs ≥1,000 random sequences.
- [ ] Any bugs discovered are fixed with regression unit tests.
- [ ] CI step runs property tests on every PR.
- [ ] `cargo test` (excluding proptest) still passes.
- [ ] No `claimable_at` logic regressions.
