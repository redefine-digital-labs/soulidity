#[test_only]
module soul_object::seal_policy_tests;

use std::string;
use kiosk::personal_kiosk;
use soul_object::allowlist;
use soul_object::seal_policy;
use soul_object::soul;
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::test_scenario::{Self as ts};
use walrus::{blob, encoding, system, test_utils};

const BLOB_ROOT_HASH: u256 = 0xABC;
const BLOB_SIZE: u64 = 5_000_000;
const BLOB_ENCODING: u8 = 1;
const BLOB_EPOCHS_AHEAD: u32 = 3;
const PAYMENT_FROST: u64 = 1_000_000_000;

fun register_test_blob(ctx: &mut TxContext): (system::System, blob::Blob) {
    let mut walrus_system = system::new_for_testing(ctx);
    let mut payment = test_utils::mint_frost(PAYMENT_FROST, ctx);
    let storage_size = encoding::encoded_blob_length(
        BLOB_SIZE,
        BLOB_ENCODING,
        walrus_system.n_shards(),
    );
    let storage = walrus_system.reserve_space(
        storage_size,
        BLOB_EPOCHS_AHEAD,
        &mut payment,
        ctx,
    );
    let blob_id = blob::derive_blob_id(BLOB_ROOT_HASH, BLOB_ENCODING, BLOB_SIZE);
    let registered_blob = walrus_system.register_blob(
        storage,
        blob_id,
        BLOB_ROOT_HASH,
        BLOB_SIZE,
        BLOB_ENCODING,
        false,
        &mut payment,
        ctx,
    );
    payment.burn_for_testing();
    (walrus_system, registered_blob)
}

fun soul_document_id_with_version(soul_id: ID, version: u8): vector<u8> {
    let mut id = b"soul-seal:";
    let soul_id_bytes = soul_id.to_bytes();
    let mut soul_id_index: u64 = 0;
    id.push_back(version);
    while (soul_id_index < soul_id_bytes.length()) {
        id.push_back(soul_id_bytes[soul_id_index]);
        soul_id_index = soul_id_index + 1;
    };
    let mut i: u64 = 0;
    while (i < 16) {
        id.push_back(0x7A);
        i = i + 1;
    };
    id
}

fun soul_document_id(soul_id: ID): vector<u8> {
    soul_document_id_with_version(soul_id, 0x01)
}

fun new_personal_kiosk_with_soul(owner: address, ctx: &mut TxContext): (system::System, Kiosk, personal_kiosk::PersonalKioskCap, ID) {
    let (walrus_system, blob) = register_test_blob(ctx);
    let soul_obj = soul::mint_for_testing(
        owner,
        string::utf8(b"Genesis Soul"),
        string::utf8(b"Single-owner artifact"),
        string::utf8(b"https://example.com/soul.png"),
        option::none(),
        blob,
        ctx,
    );
    let soul_id = object::id(&soul_obj);
    let (mut kiosk_obj, kiosk_owner_cap) = kiosk::new(ctx);
    let personal_cap = personal_kiosk::new(&mut kiosk_obj, kiosk_owner_cap, ctx);
    kiosk::place(&mut kiosk_obj, personal_kiosk::borrow(&personal_cap), soul_obj);
    (walrus_system, kiosk_obj, personal_cap, soul_id)
}

#[test]
fun current_holder_can_approve_matching_document_id_from_personal_kiosk() {
    let holder = @0xBEEF;
    let mut scenario = ts::begin(@0x0);

    ts::next_tx(&mut scenario, holder);
    {
        let (walrus_system, mut kiosk_obj, personal_cap, soul_id) = new_personal_kiosk_with_soul(holder, ts::ctx(&mut scenario));
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_owner_for_testing(document_id, &mut kiosk_obj, &personal_cap, soul_id, ts::ctx(&mut scenario));
        transfer::public_transfer(kiosk_obj, holder);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EIdPrefixMismatch)]
fun wrong_document_prefix_is_rejected() {
    let holder = @0xBEEF;
    let mut scenario = ts::begin(@0x0);

    ts::next_tx(&mut scenario, holder);
    {
        let (walrus_system, mut kiosk_obj, personal_cap, soul_id) = new_personal_kiosk_with_soul(holder, ts::ctx(&mut scenario));
        let mut document_id = b"wrong-seal:";
        let soul_id_bytes = soul_id.to_bytes();
        let mut i: u64 = 0;
        document_id.push_back(0x01);
        while (i < soul_id_bytes.length()) {
            document_id.push_back(soul_id_bytes[i]);
            i = i + 1;
        };
        i = 0;
        while (i < 48) {
            document_id.push_back(0xAA);
            i = i + 1;
        };

        seal_policy::seal_approve_owner_for_testing(document_id, &mut kiosk_obj, &personal_cap, soul_id, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
        abort 9
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EIdPrefixMismatch)]
fun wrong_document_version_is_rejected() {
    let holder = @0xBEEF;
    let mut scenario = ts::begin(@0x0);

    ts::next_tx(&mut scenario, holder);
    {
        let (walrus_system, mut kiosk_obj, personal_cap, soul_id) = new_personal_kiosk_with_soul(holder, ts::ctx(&mut scenario));
        let document_id = soul_document_id_with_version(soul_id, 0x02);
        seal_policy::seal_approve_owner_for_testing(document_id, &mut kiosk_obj, &personal_cap, soul_id, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
        abort 10
    }
}

#[test]
fun allowlisted_address_can_approve_matching_document_id() {
    let owner = @0xBEEF;
    let allowlisted = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    ts::next_tx(&mut scenario, owner);
    {
        allowlist::init_for_testing(ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let (walrus_system, mut kiosk_obj, personal_cap, minted_soul_id) = new_personal_kiosk_with_soul(owner, ts::ctx(&mut scenario));
        soul_id = minted_soul_id;
        let access_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut kiosk_obj,
            &personal_cap,
            soul_id,
            allowlisted,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(access_cap, allowlisted);
        transfer::public_transfer(kiosk_obj, owner);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, allowlisted);
    {
        let registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let access_cap: allowlist::SoulAllowlistCap = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_allowlisted_for_testing(
            document_id,
            &registry,
            soul_id,
            &access_cap,
            ts::ctx(&mut scenario),
        );

        allowlist::destroy_for_testing(access_cap);
        ts::return_shared(registry);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EAllowlistVersionMismatch)]
fun cleared_allowlist_cap_cannot_approve_document_id() {
    let owner = @0xBEEF;
    let allowlisted = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    ts::next_tx(&mut scenario, owner);
    {
        allowlist::init_for_testing(ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let (walrus_system, mut kiosk_obj, personal_cap, minted_soul_id) = new_personal_kiosk_with_soul(owner, ts::ctx(&mut scenario));
        soul_id = minted_soul_id;
        let access_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut kiosk_obj,
            &personal_cap,
            soul_id,
            allowlisted,
            ts::ctx(&mut scenario),
        );
        allowlist::clear_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut kiosk_obj,
            &personal_cap,
            soul_id,
        );
        transfer::public_transfer(access_cap, allowlisted);
        transfer::public_transfer(kiosk_obj, owner);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, allowlisted);
    {
        let registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let access_cap: allowlist::SoulAllowlistCap = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_allowlisted_for_testing(
            document_id,
            &registry,
            soul_id,
            &access_cap,
            ts::ctx(&mut scenario),
        );
        abort 11
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EAllowlistVersionMismatch)]
fun replaced_allowlist_cap_cannot_approve_document_id() {
    let owner = @0xBEEF;
    let first_allowlisted = @0xCAFE;
    let second_allowlisted = @0xD00D;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    ts::next_tx(&mut scenario, owner);
    {
        allowlist::init_for_testing(ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let (walrus_system, mut kiosk_obj, personal_cap, minted_soul_id) = new_personal_kiosk_with_soul(owner, ts::ctx(&mut scenario));
        soul_id = minted_soul_id;
        let first_access_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut kiosk_obj,
            &personal_cap,
            soul_id,
            first_allowlisted,
            ts::ctx(&mut scenario),
        );
        let second_access_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut kiosk_obj,
            &personal_cap,
            soul_id,
            second_allowlisted,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(first_access_cap, first_allowlisted);
        allowlist::destroy_for_testing(second_access_cap);
        transfer::public_transfer(kiosk_obj, owner);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, first_allowlisted);
    {
        let registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let access_cap: allowlist::SoulAllowlistCap = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_allowlisted_for_testing(
            document_id,
            &registry,
            soul_id,
            &access_cap,
            ts::ctx(&mut scenario),
        );
        abort 12
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EAccessCapSoulMismatch)]
fun allowlist_cap_for_another_soul_is_rejected() {
    let owner = @0xBEEF;
    let allowlisted = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let other_soul_id: ID;

    ts::next_tx(&mut scenario, owner);
    {
        allowlist::init_for_testing(ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let (walrus_system_a, mut kiosk_a, personal_cap_a, approved_soul_id) = new_personal_kiosk_with_soul(owner, ts::ctx(&mut scenario));
        other_soul_id = object::id(&kiosk_a);
        let access_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut kiosk_a,
            &personal_cap_a,
            approved_soul_id,
            allowlisted,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(access_cap, allowlisted);
        transfer::public_transfer(kiosk_a, owner);
        personal_kiosk::transfer_to_sender(personal_cap_a, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system_a);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, allowlisted);
    {
        let registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let access_cap: allowlist::SoulAllowlistCap = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(other_soul_id);
        seal_policy::seal_approve_allowlisted_for_testing(
            document_id,
            &registry,
            other_soul_id,
            &access_cap,
            ts::ctx(&mut scenario),
        );
        allowlist::destroy_for_testing(access_cap);
        ts::return_shared(registry);
        abort 12
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EAccessCapAllowlistedMismatch)]
fun allowlist_cap_rejects_the_wrong_sender() {
    let owner = @0xBEEF;
    let allowlisted = @0xCAFE;
    let wrong_holder = @0xD00D;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    ts::next_tx(&mut scenario, owner);
    {
        allowlist::init_for_testing(ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let (walrus_system, mut kiosk_obj, personal_cap, minted_soul_id) = new_personal_kiosk_with_soul(owner, ts::ctx(&mut scenario));
        soul_id = minted_soul_id;
        let access_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut kiosk_obj,
            &personal_cap,
            soul_id,
            allowlisted,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(access_cap, wrong_holder);
        transfer::public_transfer(kiosk_obj, owner);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, wrong_holder);
    {
        let registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let access_cap: allowlist::SoulAllowlistCap = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_allowlisted_for_testing(
            document_id,
            &registry,
            soul_id,
            &access_cap,
            ts::ctx(&mut scenario),
        );
        allowlist::destroy_for_testing(access_cap);
        ts::return_shared(registry);
        abort 13
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::ESoulNotInKiosk)]
fun owner_approval_rejects_when_the_soul_is_missing_from_the_kiosk() {
    let holder = @0xBEEF;
    let mut scenario = ts::begin(@0x0);

    ts::next_tx(&mut scenario, holder);
    {
        let (walrus_system, mut kiosk_obj, personal_cap, soul_id) = new_personal_kiosk_with_soul(holder, ts::ctx(&mut scenario));
        let removed_soul = kiosk::take<soul::Soul>(&mut kiosk_obj, personal_kiosk::borrow(&personal_cap), soul_id);
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_owner_for_testing(document_id, &mut kiosk_obj, &personal_cap, soul_id, ts::ctx(&mut scenario));
        let blob = soul::destroy_for_testing(removed_soul);
        blob.burn();
        std::unit_test::destroy(walrus_system);
        abort 14
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EPersonalKioskOwnerMismatch)]
fun owner_approval_rejects_when_the_personal_kiosk_owner_does_not_match_sender() {
    let holder = @0xBEEF;
    let wrong_holder = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    ts::next_tx(&mut scenario, holder);
    {
        let (walrus_system, kiosk_obj, personal_cap, minted_soul_id) = new_personal_kiosk_with_soul(holder, ts::ctx(&mut scenario));
        soul_id = minted_soul_id;
        transfer::public_share_object(kiosk_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, wrong_holder);
    {
        let (mut wrong_kiosk, wrong_kiosk_owner_cap) = kiosk::new(ts::ctx(&mut scenario));
        let wrong_personal_cap = personal_kiosk::new(&mut wrong_kiosk, wrong_kiosk_owner_cap, ts::ctx(&mut scenario));
        transfer::public_transfer(wrong_kiosk, wrong_holder);
        personal_kiosk::transfer_to_sender(wrong_personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, wrong_holder);
    {
        let mut kiosk_obj: kiosk::Kiosk = ts::take_shared(&scenario);
        let personal_cap: personal_kiosk::PersonalKioskCap = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_owner_for_testing(document_id, &mut kiosk_obj, &personal_cap, soul_id, ts::ctx(&mut scenario));
        abort 15
    }
}
