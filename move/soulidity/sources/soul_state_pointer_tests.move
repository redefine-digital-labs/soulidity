#[test_only]
module soulidity::soul_state_pointer_tests;

use std::{bcs, string};
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soulidity::content;
use soulidity::kind_registry::{Self as kind_registry, KindRegistry};
use soulidity::market::{Self as market, MarketConfigV2, MarketAdminCapV2, KioskRegistry};
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock;
use sui::kiosk::{Self as sui_kiosk, Kiosk};
use sui::test_scenario as ts;
use sui::transfer_policy::TransferPolicy;
use walrus::{blob, encoding, system, test_utils};

const AUTHOR: address = @0xA11;
const RECIPIENT: address = @0xB22;

public struct JoinedItem has key, store { id: UID }

fun new_soul(ctx: &mut TxContext): Soul {
    soul::mint(string::utf8(b"pointer"), string::utf8(b"description"),
        string::utf8(b"https://example.com/image.png"), AUTHOR, 250,
        soul::provenance_native(), option::none(), ctx)
}

fun new_state(soul_id: ID, ctx: &mut TxContext): SoulState {
    soul::create_state(soul_id, AUTHOR, 250, AUTHOR,
        object::id_from_address(@0x123), ctx)
}

#[test]
fun binding_preserves_soul_and_state_bcs() {
    let mut scenario = ts::begin(AUTHOR);
    let mut item = new_soul(scenario.ctx());
    let state = new_state(object::id(&item), scenario.ctx());
    let original_soul = bcs::to_bytes(&item);
    let original_state = bcs::to_bytes(&state);
    soul::bind_state_pointer(&mut item, &state);
    assert!(soul::state_pointer_for_testing(&item) == object::id(&state), 99);
    assert!(bcs::to_bytes(&item) == original_soul
        && bcs::to_bytes(&state) == original_state, 99);
    transfer::public_transfer(item, AUTHOR);
    soul::destroy_state_for_testing(state);
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = sui::dynamic_field)]
fun duplicate_binding_is_not_an_update() {
    let mut scenario = ts::begin(AUTHOR);
    let mut item = new_soul(scenario.ctx());
    let first = new_state(object::id(&item), scenario.ctx());
    let second = new_state(object::id(&item), scenario.ctx());
    soul::bind_state_pointer(&mut item, &first);
    soul::bind_state_pointer(&mut item, &second);
    abort 99
}

#[test, expected_failure(abort_code = 14, location = soulidity::soul)]
fun wrong_soul_state_cannot_be_bound() {
    let mut scenario = ts::begin(AUTHOR);
    let mut item = new_soul(scenario.ctx());
    let other = new_soul(scenario.ctx());
    let state = new_state(object::id(&other), scenario.ctx());
    soul::bind_state_pointer(&mut item, &state);
    abort 99
}

#[test]
fun pointer_survives_kiosk_custody_and_address_transfer() {
    let mut scenario = ts::begin(AUTHOR);
    let mut item = new_soul(scenario.ctx());
    let state = new_state(object::id(&item), scenario.ctx());
    let state_id = object::id(&state);
    let item_id = object::id(&item);
    soul::bind_state_pointer(&mut item, &state);
    // This test isolates custody of the Soul and its immutable child, not a
    // Market sale or owner-epoch update. Actual mint custody is tested below.
    soul::destroy_state_for_testing(state);
    let (mut kiosk, cap) = sui_kiosk::new(scenario.ctx());
    sui_kiosk::place(&mut kiosk, &cap, item);
    transfer::public_share_object(kiosk);
    transfer::public_transfer(cap, AUTHOR);
    scenario.next_tx(AUTHOR);
    let mut kiosk = scenario.take_shared<Kiosk>();
    let cap = scenario.take_from_sender<sui_kiosk::KioskOwnerCap>();
    assert!(soul::state_pointer_for_testing(sui_kiosk::borrow<Soul>(&kiosk, &cap, item_id)) == state_id, 99);
    let item = sui_kiosk::take<Soul>(&mut kiosk, &cap, item_id);
    transfer::public_transfer(item, RECIPIENT);
    ts::return_shared(kiosk);
    scenario.return_to_sender(cap);
    scenario.next_tx(RECIPIENT);
    let item = scenario.take_from_sender<Soul>();
    assert!(object::id(&item) == item_id
        && soul::state_pointer_for_testing(&item) == state_id, 99);
    scenario.return_to_sender(item);
    scenario.end();
}

fun registered_blob(walrus: &mut system::System, root: u256, ctx: &mut TxContext): blob::Blob {
    let mut payment = test_utils::mint_frost(1_000_000_000, ctx);
    let size = 5_000_000;
    let encoded_size = encoding::encoded_blob_length(size, 1, walrus.n_shards());
    let storage = walrus.reserve_space(encoded_size, 3, &mut payment, ctx);
    let result = walrus.register_blob(storage, blob::derive_blob_id(root, 1, size),
        root, size, 1, false, &mut payment, ctx);
    payment.burn_for_testing();
    result
}

fun assert_fresh_mint_pointer(mode: u8) {
    let mut scenario = ts::begin(AUTHOR);
    let mut walrus = system::new_for_testing(scenario.ctx());
    transfer::public_transfer(registered_blob(&mut walrus, 123, scenario.ctx()), AUTHOR);
    transfer::public_transfer(registered_blob(&mut walrus, 456, scenario.ctx()), AUTHOR);
    std::unit_test::destroy(walrus);
    scenario.next_tx(AUTHOR);
    market::init_fresh_for_testing(AUTHOR, scenario.ctx());
    kind_registry::init_for_testing(scenario.ctx());
    scenario.next_tx(AUTHOR);
    let mut config = scenario.take_shared<MarketConfigV2>();
    let admin = scenario.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    let mut registry = scenario.take_shared<KioskRegistry>();
    let kiosk_id = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(registry);
    scenario.return_to_sender(admin);
    scenario.next_tx(AUTHOR);
    let config = scenario.take_shared<MarketConfigV2>();
    let mut registry = scenario.take_shared<KioskRegistry>();
    let kinds = scenario.take_shared<KindRegistry>();
    let policy = scenario.take_shared<TransferPolicy<Soul>>();
    let mut kiosk = scenario.take_shared_by_id<Kiosk>(kiosk_id);
    let cap = scenario.take_from_sender<PersonalKioskCap>();
    let doc = scenario.take_from_sender<blob::Blob>();
    let memory = scenario.take_from_sender<blob::Blob>();
    let entries = vector[
        market::new_initial_content_entry(kind_registry::kind_soul_doc(), content::soul_doc_name(),
            kind_registry::read_owner() | kind_registry::read_grant(), content::download_policy_public(), false, doc, 0, b"initial-envelope"),
        market::new_initial_content_entry(kind_registry::kind_memory(), content::memory_name(),
            kind_registry::read_owner() | kind_registry::read_grant(), content::download_policy_public(), false, memory, 0, b"initial-envelope"),
    ];
    let clock = clock::create_for_testing(scenario.ctx());
    let nonce = b"0123456789abcdef";
    let expected_content_id = market::derive_mint_content_id(&registry, AUTHOR, nonce);
    let state = if (mode == 0) {
        market::mint_native_in_personal_kiosk_v2(&config, &kinds, &mut registry, &policy, &mut kiosk, &cap,
            string::utf8(b"native"), string::utf8(b"description"), string::utf8(b"image"),
            entries, vector[], 250, nonce, expected_content_id, &clock, scenario.ctx())
    } else if (mode == 1) {
        market::mint_imported_in_personal_kiosk_v2(&config, &kinds, &mut registry, &policy, &mut kiosk, &cap,
            string::utf8(b"imported"), string::utf8(b"description"), string::utf8(b"image"),
            entries, vector[], string::utf8(b"unverified origin"), 250, nonce, expected_content_id, &clock, scenario.ctx())
    } else {
        let source = JoinedItem { id: object::new(scenario.ctx()) };
        let source_id = object::id(&source);
        sui_kiosk::place(&mut kiosk, personal_kiosk::borrow(&cap), source);
        market::mint_joined_in_personal_kiosk_v2<JoinedItem>(&config, &kinds, &mut registry, &policy,
            &mut kiosk, &cap, source_id, string::utf8(b"joined"), string::utf8(b"description"),
            string::utf8(b"image"), entries, vector[], string::utf8(b"unverified origin"),
            250, nonce, expected_content_id, &clock, scenario.ctx())
    };
    let state_id = object::id(&state);
    let soul_id = soul::soul_id(&state);
    assert!(soul::state_pointer_for_testing(sui_kiosk::borrow<Soul>(&kiosk,
        personal_kiosk::borrow(&cap), soul_id)) == state_id, 99);
    market::finalize_soul_state(state);
    clock::destroy_for_testing(clock);
    ts::return_shared(config); ts::return_shared(registry); ts::return_shared(kinds);
    ts::return_shared(policy); ts::return_shared(kiosk); scenario.return_to_sender(cap);
    scenario.next_tx(AUTHOR);
    let state = scenario.take_shared_by_id<SoulState>(state_id);
    let kiosk = scenario.take_shared_by_id<Kiosk>(kiosk_id);
    let cap = scenario.take_from_sender<PersonalKioskCap>();
    assert!(soul::soul_id(&state) == soul_id
        && soul::state_pointer_for_testing(sui_kiosk::borrow<Soul>(&kiosk,
            personal_kiosk::borrow(&cap), soul_id)) == object::id(&state), 99);
    ts::return_shared(state); ts::return_shared(kiosk); scenario.return_to_sender(cap);
    scenario.end();
}

#[test] fun actual_native_v2_mint_seeds_pointer() { assert_fresh_mint_pointer(0); }
#[test] fun actual_imported_v2_mint_seeds_pointer() { assert_fresh_mint_pointer(1); }
#[test] fun actual_joined_v2_mint_seeds_pointer() { assert_fresh_mint_pointer(2); }
