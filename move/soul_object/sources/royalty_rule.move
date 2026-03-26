module soul_object::royalty_rule;

use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::transfer_policy::{Self as policy, TransferPolicy, TransferPolicyCap, TransferRequest};

const ERoyaltyTooHigh: u64 = 0;
const EInsufficientPayment: u64 = 1;
const MAX_BPS: u16 = 10_000;

public struct Rule has drop {}

public struct Config has drop, store {
    bps: u16,
}

public fun set<T: key + store>(
    policy: &mut TransferPolicy<T>,
    cap: &TransferPolicyCap<T>,
    bps: u16,
) {
    assert!(bps <= MAX_BPS, ERoyaltyTooHigh);
    if (policy::has_rule<T, Rule>(policy)) {
        policy::remove_rule<T, Rule, Config>(policy, cap);
    };
    policy::add_rule(Rule {}, policy, cap, Config { bps });
}

public fun bps<T: key + store>(policy: &TransferPolicy<T>): u16 {
    let config: &Config = policy::get_rule(Rule {}, policy);
    config.bps
}

public fun is_enabled<T: key + store>(policy: &TransferPolicy<T>): bool {
    policy::has_rule<T, Rule>(policy)
}

public fun fee_amount<T: key + store>(policy: &TransferPolicy<T>, request: &TransferRequest<T>): u64 {
    ((request.paid() as u128) * (bps(policy) as u128) / 10_000) as u64
}

public fun pay<T: key + store>(
    policy: &TransferPolicy<T>,
    request: &mut TransferRequest<T>,
    fees: &mut Coin<SUI>,
    recipient: address,
    ctx: &mut TxContext,
) {
    let amount = fee_amount(policy, request);
    if (amount == 0) {
        policy::add_receipt(Rule {}, request);
        return
    };

    assert!(fees.value() >= amount, EInsufficientPayment);
    let fee = coin::split(fees, amount, ctx);
    transfer::public_transfer(fee, recipient);
    policy::add_receipt(Rule {}, request);
}
