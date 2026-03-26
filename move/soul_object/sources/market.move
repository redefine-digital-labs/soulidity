module soul_object::market;

use sui::event;
use sui::kiosk::{Kiosk, KioskOwnerCap};
use sui::package::{Self, Publisher};
use sui::transfer_policy::{Self as transfer_policy, TransferPolicy, TransferPolicyCap};
use soul_object::platform_fee_rule;
use soul_object::royalty_rule;
use soul_object::soul::Soul;
use sui::coin::Coin;
use sui::sui::SUI;

const EInvalidRecipient: u64 = 1;
const EPolicyNotConfigured: u64 = 2;
const EInvalidPrice: u64 = 3;

public struct MARKET has drop {}

public struct MarketAdminCap has key, store {
    id: UID,
}

public struct MarketConfig has key {
    id: UID,
    fee_recipient: address,
    platform_fee_bps: u16,
    royalty_bps: u16,
}

public struct MarketInitialized has copy, drop {
    config_id: ID,
    policy_id: ID,
    admin: address,
}

public struct FeeRecipientUpdated has copy, drop {
    fee_recipient: address,
}

public struct PlatformFeeBpsUpdated has copy, drop {
    fee_bps: u16,
}

public struct RoyaltyBpsUpdated has copy, drop {
    royalty_bps: u16,
}

public struct SoulListed has copy, drop {
    soul_id: ID,
    kiosk_id: ID,
    seller: address,
    price: u64,
}

public struct SoulPurchased has copy, drop {
    soul_id: ID,
    seller_kiosk_id: ID,
    buyer: address,
    price: u64,
    platform_fee: u64,
    royalty_fee: u64,
}

fun init(otw: MARKET, ctx: &mut TxContext) {
    init_impl(package::claim(otw, ctx), ctx.sender(), ctx)
}

public fun fee_recipient(self: &MarketConfig): address {
    self.fee_recipient
}

public fun platform_fee_bps(self: &MarketConfig): u16 {
    self.platform_fee_bps
}

public fun royalty_bps(self: &MarketConfig): u16 {
    self.royalty_bps
}

public fun update_fee_recipient(
    config: &mut MarketConfig,
    _: &MarketAdminCap,
    fee_recipient: address,
) {
    assert!(fee_recipient != @0x0, EInvalidRecipient);
    config.fee_recipient = fee_recipient;
    event::emit(FeeRecipientUpdated { fee_recipient });
}

public fun update_platform_fee_bps(
    config: &mut MarketConfig,
    policy: &mut TransferPolicy<Soul>,
    policy_cap: &TransferPolicyCap<Soul>,
    _: &MarketAdminCap,
    fee_bps: u16,
) {
    platform_fee_rule::set(policy, policy_cap, fee_bps);
    config.platform_fee_bps = fee_bps;
    event::emit(PlatformFeeBpsUpdated { fee_bps });
}

public fun update_royalty_bps(
    config: &mut MarketConfig,
    policy: &mut TransferPolicy<Soul>,
    policy_cap: &TransferPolicyCap<Soul>,
    _: &MarketAdminCap,
    royalty_bps: u16,
) {
    royalty_rule::set(policy, policy_cap, royalty_bps);
    config.royalty_bps = royalty_bps;
    event::emit(RoyaltyBpsUpdated { royalty_bps });
}

public fun place_and_list(
    kiosk: &mut Kiosk,
    cap: &KioskOwnerCap,
    policy: &TransferPolicy<Soul>,
    mut soul: Soul,
    price: u64,
) {
    assert!(platform_fee_rule::is_enabled(policy), EPolicyNotConfigured);
    assert!(royalty_rule::is_enabled(policy), EPolicyNotConfigured);
    assert!(price > 0, EInvalidPrice);

    let seller = kiosk.owner();
    let kiosk_id = object::id(kiosk);
    let soul_id = object::id(&soul);
    soul.set_owner(seller);
    kiosk.place_and_list(cap, soul, price);

    event::emit(SoulListed {
        soul_id,
        kiosk_id,
        seller,
        price,
    });
}

public fun purchase(
    config: &MarketConfig,
    policy: &TransferPolicy<Soul>,
    seller_kiosk: &mut Kiosk,
    soul_id: ID,
    payment: Coin<SUI>,
    mut fee_coin: Coin<SUI>,
    ctx: &mut TxContext,
): (Soul, Coin<SUI>) {
    let (mut soul, mut request) = seller_kiosk.purchase<Soul>(soul_id, payment);
    let price = request.paid();
    let platform_fee = platform_fee_rule::fee_amount(policy, &request);
    let royalty_fee = royalty_rule::fee_amount(policy, &request);

    platform_fee_rule::pay(policy, &mut request, &mut fee_coin, config.fee_recipient, ctx);
    royalty_rule::pay(policy, &mut request, &mut fee_coin, soul.creator(), ctx);
    policy.confirm_request(request);

    let buyer = ctx.sender();
    let kiosk_id = object::id(seller_kiosk);
    soul.set_owner(buyer);

    event::emit(SoulPurchased {
        soul_id,
        seller_kiosk_id: kiosk_id,
        buyer,
        price,
        platform_fee,
        royalty_fee,
    });

    (soul, fee_coin)
}

#[allow(lint(share_owned))]
fun init_impl(publisher: Publisher, admin: address, ctx: &mut TxContext) {
    let (mut policy, policy_cap) = transfer_policy::new<Soul>(&publisher, ctx);
    let config = MarketConfig {
        id: object::new(ctx),
        fee_recipient: admin,
        platform_fee_bps: 0,
        royalty_bps: 0,
    };
    let config_id = object::id(&config);
    let policy_id = object::id(&policy);
    let admin_cap = MarketAdminCap { id: object::new(ctx) };

    platform_fee_rule::set(&mut policy, &policy_cap, 0);
    royalty_rule::set(&mut policy, &policy_cap, 0);

    transfer::share_object(config);
    transfer::public_share_object(policy);
    transfer::transfer(admin_cap, admin);
    transfer::public_transfer(policy_cap, admin);
    publisher.burn();

    event::emit(MarketInitialized {
        config_id,
        policy_id,
        admin,
    });
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    init_impl(package::claim(MARKET {}, ctx), recipient, ctx);
}
