module soulidity::animacraft_provenance;

use animacraft::animacraft::{
    Self as animacraft,
    LicensePolicy,
    MakerTreasury,
    OCMaker,
    RecipeSlot,
    RoyaltyPolicySnapshot,
};
use soulidity::soul::{Self as soul, SoulState};
use std::string::String;
use sui::event;

const VERSION: u64 = 1;

const ESoulMismatch: u64 = 0;
const EMakerMismatch: u64 = 1;
const ETreasuryMismatch: u64 = 2;

/// Immutable proof created only from a consumed Animacraft authorization.
/// Soulidity freezes this object before the returned SoulState can be shared.
public struct AnimacraftProvenance has key {
    id: UID,
    version: u64,
    soul_id: ID,
    animacraft_version: u64,
    maker_id: ID,
    maker_treasury_id: ID,
    maker_creator: address,
    payer: address,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    recipe_hash: vector<u8>,
    license_snapshot: LicensePolicy,
    royalty_policy: RoyaltyPolicySnapshot,
    mint_payment_coin_type: String,
    mint_price_atomic: u64,
    protocol_fee_config_id: ID,
    protocol_treasury_id: ID,
    primary_protocol_fee_bps: u16,
    primary_protocol_fee_atomic: u64,
    recipe: vector<RecipeSlot>,
    authorized_at_ms: u64,
}

public struct AnimacraftProvenanceCreated has copy, drop {
    provenance_id: ID,
    soul_id: ID,
    state_id: ID,
    maker_id: ID,
    maker_treasury_id: ID,
    payer: address,
    royalty_bps: u16,
    protocol_fee_config_id: ID,
    protocol_treasury_id: ID,
    primary_protocol_fee_bps: u16,
    primary_protocol_fee_atomic: u64,
}

public(package) fun new(
    soul_id: ID,
    animacraft_version: u64,
    maker_id: ID,
    maker_treasury_id: ID,
    maker_creator: address,
    payer: address,
    profile_json_blob_id: String,
    image_blob_id: String,
    image_url: String,
    recipe_hash: vector<u8>,
    license_snapshot: LicensePolicy,
    royalty_policy: RoyaltyPolicySnapshot,
    mint_payment_coin_type: String,
    mint_price_atomic: u64,
    protocol_fee_config_id: ID,
    protocol_treasury_id: ID,
    primary_protocol_fee_bps: u16,
    primary_protocol_fee_atomic: u64,
    recipe: vector<RecipeSlot>,
    authorized_at_ms: u64,
    ctx: &mut TxContext,
): AnimacraftProvenance {
    AnimacraftProvenance {
        id: object::new(ctx),
        version: VERSION,
        soul_id,
        animacraft_version,
        maker_id,
        maker_treasury_id,
        maker_creator,
        payer,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        license_snapshot,
        royalty_policy,
        mint_payment_coin_type,
        mint_price_atomic,
        protocol_fee_config_id,
        protocol_treasury_id,
        primary_protocol_fee_bps,
        primary_protocol_fee_atomic,
        recipe,
        authorized_at_ms,
    }
}

public(package) fun bind_and_freeze(
    state: &mut SoulState,
    provenance: AnimacraftProvenance,
) {
    assert!(soul::soul_id(state) == provenance.soul_id, ESoulMismatch);
    let provenance_id = object::id(&provenance);
    soul::bind_animacraft_provenance(state, provenance_id);
    event::emit(AnimacraftProvenanceCreated {
        provenance_id,
        soul_id: provenance.soul_id,
        state_id: object::id(state),
        maker_id: provenance.maker_id,
        maker_treasury_id: provenance.maker_treasury_id,
        payer: provenance.payer,
        royalty_bps: animacraft::royalty_policy_bps(&provenance.royalty_policy),
        protocol_fee_config_id: provenance.protocol_fee_config_id,
        protocol_treasury_id: provenance.protocol_treasury_id,
        primary_protocol_fee_bps: provenance.primary_protocol_fee_bps,
        primary_protocol_fee_atomic: provenance.primary_protocol_fee_atomic,
    });
    transfer::freeze_object(provenance);
}

public(package) fun assert_matches_soul(
    self: &AnimacraftProvenance,
    state: &SoulState,
) {
    assert!(self.soul_id == soul::soul_id(state), ESoulMismatch);
    assert!(object::id(self) == soul::animacraft_provenance_id(state), ESoulMismatch);
}

public(package) fun assert_matches_maker<PaymentCoin>(
    self: &AnimacraftProvenance,
    maker: &OCMaker,
    treasury: &MakerTreasury<PaymentCoin>,
) {
    assert!(self.maker_id == animacraft::maker_id(maker), EMakerMismatch);
    assert!(self.maker_treasury_id == animacraft::treasury_id(treasury), ETreasuryMismatch);
    assert!(animacraft::treasury_maker_id(treasury) == self.maker_id, ETreasuryMismatch);
    assert!(animacraft::royalty_policy_maker_id(&self.royalty_policy) == self.maker_id, EMakerMismatch);
    assert!(
        animacraft::royalty_policy_treasury_id(&self.royalty_policy) == self.maker_treasury_id,
        ETreasuryMismatch,
    );
}

public fun provenance_id(self: &AnimacraftProvenance): ID {
    object::id(self)
}

public fun version(self: &AnimacraftProvenance): u64 {
    self.version
}

public fun soul_id(self: &AnimacraftProvenance): ID {
    self.soul_id
}

public fun animacraft_version(self: &AnimacraftProvenance): u64 {
    self.animacraft_version
}

public fun maker_id(self: &AnimacraftProvenance): ID {
    self.maker_id
}

public fun maker_treasury_id(self: &AnimacraftProvenance): ID {
    self.maker_treasury_id
}

public fun maker_creator(self: &AnimacraftProvenance): address {
    self.maker_creator
}

public fun payer(self: &AnimacraftProvenance): address {
    self.payer
}

public fun profile_json_blob_id(self: &AnimacraftProvenance): &String {
    &self.profile_json_blob_id
}

public fun image_blob_id(self: &AnimacraftProvenance): &String {
    &self.image_blob_id
}

public fun image_url(self: &AnimacraftProvenance): &String {
    &self.image_url
}

public fun recipe_hash(self: &AnimacraftProvenance): &vector<u8> {
    &self.recipe_hash
}

public fun license_snapshot(self: &AnimacraftProvenance): &LicensePolicy {
    &self.license_snapshot
}

public fun royalty_policy(self: &AnimacraftProvenance): &RoyaltyPolicySnapshot {
    &self.royalty_policy
}

public fun royalty_bps(self: &AnimacraftProvenance): u16 {
    animacraft::royalty_policy_bps(&self.royalty_policy)
}

public fun mint_payment_coin_type(self: &AnimacraftProvenance): &String {
    &self.mint_payment_coin_type
}

public fun mint_price_atomic(self: &AnimacraftProvenance): u64 {
    self.mint_price_atomic
}

public fun protocol_fee_config_id(self: &AnimacraftProvenance): ID {
    self.protocol_fee_config_id
}

public fun protocol_treasury_id(self: &AnimacraftProvenance): ID {
    self.protocol_treasury_id
}

public fun primary_protocol_fee_bps(self: &AnimacraftProvenance): u16 {
    self.primary_protocol_fee_bps
}

public fun primary_protocol_fee_atomic(self: &AnimacraftProvenance): u64 {
    self.primary_protocol_fee_atomic
}

public fun recipe(self: &AnimacraftProvenance): &vector<RecipeSlot> {
    &self.recipe
}

public fun authorized_at_ms(self: &AnimacraftProvenance): u64 {
    self.authorized_at_ms
}
