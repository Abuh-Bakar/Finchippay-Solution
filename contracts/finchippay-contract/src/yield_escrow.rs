use soroban_sdk::{contracttype, panic_with_error, Address, Env, Symbol, Vec};
use crate::storage::{self, StorageKey};
use crate::token;

const YIELD_ESCROW_BUMP_AMOUNT: u32 = 518_400;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct YieldEscrow {
    pub id: u64,
    pub token_a: Address,
    pub token_b: Address,
    pub pool_address: Address,
    pub from: Address,
    pub to: Address,
    pub amount: i128,
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
    let id = storage::next_id(env, &StorageKey::YieldEscrowCount);
    let pool_address = env.storage().instance().get(&StorageKey::PoolAddress).unwrap_or_else(|| {
        panic_with_error!(env, crate::ContractError::NotInitialized);
        Address::from_str(env, "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    });
    let token = token::Client::new(env, token_a);
    token.transfer(from, &env.current_contract_address(), &amount);
    let shares = token::Client::new(env, &pool_address).deposit(from, token_a, token_b, &amount, &0i128, &0i128, &(env.ledger().sequence() + 1000));
    let escrow = YieldEscrow { id, token_a: token_a.clone(), token_b: token_b.clone(), pool_address, from: from.clone(), to: to.clone(), amount, shares_received: shares, release_ledger, status: YieldEscrowStatus::Pending, memo: memo.clone() };
    env.storage().persistent().set(&StorageKey::YieldEscrow(id), &escrow);
    env.storage().persistent().bump(&StorageKey::YieldEscrow(id), YIELD_ESCROW_BUMP_AMOUNT);
    env.events().publish((Symbol::new(env, "yield_escrow_create"), id), (from.clone(), to.clone(), token_a.clone(), amount, shares));
    id
}

pub fn claim_yield_escrow(env: &Env, id: u64) -> i128 {
    let mut escrow = env.storage().persistent().get::<StorageKey, YieldEscrow>(&StorageKey::YieldEscrow(id)).unwrap_or_else(|| panic_with_error!(env, crate::ContractError::NotFound));
    if escrow.status != YieldEscrowStatus::Pending { panic_with_error!(env, crate::ContractError::InvalidState); }
    if env.ledger().sequence() < escrow.release_ledger { panic_with_error!(env, crate::ContractError::ReleaseLedgerNotReached); }
    let pool = token::Client::new(env, &escrow.pool_address);
    let withdrawn = pool.withdraw(&escrow.from, &escrow.token_a, &escrow.token_b, &escrow.shares_received, &0i128, &0i128);
    let principal = escrow.amount;
    let total = if withdrawn < principal { principal } else { withdrawn };
    let token = token::Client::new(env, &escrow.token_a);
    token.transfer(&env.current_contract_address(), &escrow.to, &total);
    escrow.status = YieldEscrowStatus::Claimed;
    env.storage().persistent().set(&StorageKey::YieldEscrow(id), &escrow);
    env.events().publish((Symbol::new(env, "yield_escrow_claim"), id), (escrow.to.clone(), total));
    total
}

pub fn cancel_yield_escrow(env: &Env, id: u64) -> i128 {
    let mut escrow = env.storage().persistent().get::<StorageKey, YieldEscrow>(&StorageKey::YieldEscrow(id)).unwrap_or_else(|| panic_with_error!(env, crate::ContractError::NotFound));
    if escrow.status != YieldEscrowStatus::Pending { panic_with_error!(env, crate::ContractError::InvalidState); }
    escrow.from.require_auth();
    let pool = token::Client::new(env, &escrow.pool_address);
    let withdrawn = pool.withdraw(&escrow.from, &escrow.token_a, &escrow.token_b, &escrow.shares_received, &0i128, &0i128);
    let principal = escrow.amount;
    let refund = if withdrawn < principal { principal } else { withdrawn };
    let token = token::Client::new(env, &escrow.token_a);
    token.transfer(&env.current_contract_address(), &escrow.from, &refund);
    escrow.status = YieldEscrowStatus::Cancelled;
    env.storage().persistent().set(&StorageKey::YieldEscrow(id), &escrow);
    env.events().publish((Symbol::new(env, "yield_escrow_cancelled"), id), (escrow.from.clone(), refund));
    refund
}

pub fn get_yield_escrow(env: &Env, id: u64) -> YieldEscrow {
    env.storage().persistent().get(&StorageKey::YieldEscrow(id)).unwrap_or_else(|| panic_with_error!(env, crate::ContractError::NotFound))
}
