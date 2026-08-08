//! # Yield Escrow — AMM/DeFi Pool Integration
//!
//! Time-locked token custody where deposited funds are placed into a liquidity
//! pool (AMM) to earn yield while escrowed. The beneficiary receives the
//! principal plus any accumulated yield when the release ledger is reached.
//!
//! This module is a **scaffold** for future DeFi integration. Currently the
//! `pool_address` and share accounting are placeholders. When a real AMM is
//! integrated, `create_yield_escrow` will deposit into the pool for LP shares,
//! and `claim_yield_escrow` will withdraw shares plus accrued yield.

use soroban_sdk::{contracttype, token, Address, Env, Symbol};

use crate::storage;
use crate::DataKey;

/// TTL bump amount for yield escrow entries (~30 days at 5 s/ledger).
const YIELD_ESCROW_BUMP_AMOUNT: u32 = 518_400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct YieldEscrow {
    pub id: u64,
    pub token_a: Address,
    pub token_b: Address,
    /// Liquidity pool address for yield generation (placeholder).
    pub pool_address: Address,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
    /// LP shares received after depositing into the pool (placeholder).
    pub shares_received: i128,
    pub release_ledger: u32,
    pub status: YieldEscrowStatus,
    pub memo: Symbol,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum YieldEscrowStatus {
    Pending,
    Claimed,
    Cancelled,
}

/// Retrieve and increment the yield escrow counter from persistent storage.
fn next_id(env: &Env) -> u64 {
    let key = DataKey::YieldEscrowCount;
    let count: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage().persistent().set(&key, &(count + 1));
    storage::bump(env, &key);
    count
}

/// Create a new yield escrow. Tokens are transferred from `from` into the
/// contract and deposited into the designated liquidity pool. The beneficiary
/// (`to`) can claim principal + yield after `release_ledger`.
pub fn create_yield_escrow(
    env: &Env,
    token_a: &Address,
    token_b: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
    release_ledger: u32,
    memo: &Symbol,
) -> u64 {
    from.require_auth();

    if amount <= 0 {
        panic!("Amount must be positive");
    }
    if release_ledger <= env.ledger().sequence() {
        panic!("Release ledger must be in the future");
    }

    let id = next_id(env);

    // Transfer tokens from funder to contract.
    let token_client = token::Client::new(env, token_a);
    token_client.transfer(from, &env.current_contract_address(), &amount);

    // TODO(#amm-integration): Deposit tokens into the liquidity pool and
    // record the actual LP shares received. Currently shares = amount (1:1 placeholder).
    let shares: i128 = amount;

    let escrow = YieldEscrow {
        id,
        token_a: token_a.clone(),
        token_b: token_b.clone(),
        pool_address: token_a.clone(), // placeholder — real pool address TBD
        from: from.clone(),
        to: to.clone(),
        amount,
        shares_received: shares,
        release_ledger,
        status: YieldEscrowStatus::Pending,
        memo: memo.clone(),
    };

    let escrow_key = DataKey::YieldEscrow(id);
    env.storage().persistent().set(&escrow_key, &escrow);
    storage::bump_to_floor(env, &escrow_key);

    env.events().publish(
        (Symbol::new(env, "yield_escrow_create"), id),
        (from.clone(), to.clone(), token_a.clone(), amount, shares),
    );

    id
}

/// Claim a matured yield escrow. Transfers principal + yield to the
/// beneficiary. Panics if the escrow is not yet at its release ledger.
pub fn claim_yield_escrow(env: &Env, id: u64) -> i128 {
    let escrow_key = DataKey::YieldEscrow(id);
    let mut escrow: YieldEscrow = env
        .storage()
        .persistent()
        .get(&escrow_key)
        .unwrap_or_else(|| panic!("YieldEscrow not found"));

    if escrow.status != YieldEscrowStatus::Pending {
        panic!("Invalid state");
    }
    if env.ledger().sequence() < escrow.release_ledger {
        panic!("Release ledger not reached");
    }

    // TODO(#amm-integration): Withdraw LP shares from pool and compute
    // actual principal + yield. Currently returns principal only.
    let principal = escrow.amount;
    let total = principal;
    let token_client = token::Client::new(env, &escrow.token_a);
    token_client.transfer(&env.current_contract_address(), &escrow.to, &total);

    escrow.status = YieldEscrowStatus::Claimed;
    env.storage().persistent().set(&escrow_key, &escrow);
    storage::bump(env, &escrow_key);

    env.events().publish(
        (Symbol::new(env, "yield_escrow_claim"), id),
        (escrow.to.clone(), total),
    );

    total
}

/// Cancel a pending yield escrow. Only the original funder may cancel.
/// Withdraws LP shares and refunds the funder with principal + yield.
pub fn cancel_yield_escrow(env: &Env, id: u64) -> i128 {
    let escrow_key = DataKey::YieldEscrow(id);
    let mut escrow: YieldEscrow = env
        .storage()
        .persistent()
        .get(&escrow_key)
        .unwrap_or_else(|| panic!("YieldEscrow not found"));

    if escrow.status != YieldEscrowStatus::Pending {
        panic!("Invalid state");
    }
    escrow.from.require_auth();

    // TODO(#amm-integration): Withdraw LP shares from pool and compute
    // actual principal + yield. Currently returns principal only.
    let principal = escrow.amount;
    let refund = principal;
    let token_client = token::Client::new(env, &escrow.token_a);
    token_client.transfer(&env.current_contract_address(), &escrow.from, &refund);

    escrow.status = YieldEscrowStatus::Cancelled;
    env.storage().persistent().set(&escrow_key, &escrow);
    storage::bump(env, &escrow_key);

    env.events().publish(
        (Symbol::new(env, "yield_escrow_cancelled"), id),
        (escrow.from.clone(), refund),
    );

    refund
}

/// Read a yield escrow by ID. Panics if not found.
pub fn get_yield_escrow(env: &Env, id: u64) -> YieldEscrow {
    let escrow_key = DataKey::YieldEscrow(id);
    env.storage()
        .persistent()
        .get(&escrow_key)
        .unwrap_or_else(|| panic!("YieldEscrow not found"))
}
