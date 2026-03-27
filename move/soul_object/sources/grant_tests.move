#[test_only]
module soul_object::grant_tests;

use std::string;
use soul_object::grant;
use soul_object::soul;
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

#[test]
fun current_holder_can_set_and_revoke_agent_grant() {
    let holder = @0xBEEF;
    let agent = @0xCAFE;
    let mut scenario = ts::begin(holder);

    {
        let ctx = ts::ctx(&mut scenario);
        let (walrus_system, blob) = register_test_blob(ctx);
        let soul_obj = soul::mint_for_testing(
            holder,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        transfer::public_transfer(soul_obj, holder);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, holder);
    {
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let access_cap = grant::set_agent_grant(&mut soul_obj, agent, ts::ctx(&mut scenario));
        let agent_grant = soul::agent_grant(&soul_obj);
        assert!(agent_grant.is_some(), 0);
        assert!(*agent_grant.borrow() == agent, 1);
        assert!(soul::grant_version(&soul_obj) == 1, 2);
        assert!(grant::agent(&access_cap) == agent, 3);
        assert!(grant::soul_id(&access_cap) == object::id(&soul_obj), 4);
        assert!(grant::grant_version(&access_cap) == soul::grant_version(&soul_obj), 5);

        grant::revoke_agent_grant(&mut soul_obj, ts::ctx(&mut scenario));
        assert!(soul::agent_grant(&soul_obj).is_none(), 6);
        assert!(soul::grant_version(&soul_obj) == 2, 7);

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
        grant::destroy_for_testing(access_cap);
    };

    ts::end(scenario);
}

#[test]
fun direct_transfer_recipient_can_replace_existing_agent_grant() {
    let creator = @0xBEEF;
    let recipient = @0xBAD;
    let first_agent = @0xCAFE;
    let second_agent = @0xD00D;
    let mut scenario = ts::begin(creator);

    {
        let ctx = ts::ctx(&mut scenario);
        let (walrus_system, blob) = register_test_blob(ctx);
        let mut soul_obj = soul::mint_for_testing(
            creator,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        let access_cap = grant::set_agent_grant(&mut soul_obj, first_agent, ctx);
        transfer::public_transfer(soul_obj, creator);
        transfer::public_transfer(access_cap, creator);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        transfer::public_transfer(soul_obj, recipient);
    };

    ts::next_tx(&mut scenario, recipient);
    {
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let first_access_cap: grant::SoulAccessCap = ts::take_from_address(&scenario, creator);
        assert!(soul::agent_grant(&soul_obj).contains(&first_agent), 3);
        assert!(grant::grant_version(&first_access_cap) == 1, 4);

        let second_access_cap = grant::set_agent_grant(&mut soul_obj, second_agent, ts::ctx(&mut scenario));
        assert!(soul::agent_grant(&soul_obj).contains(&second_agent), 5);
        assert!(soul::grant_version(&soul_obj) == 2, 6);
        assert!(grant::grant_version(&second_access_cap) == 2, 7);

        grant::revoke_agent_grant(&mut soul_obj, ts::ctx(&mut scenario));
        assert!(soul::agent_grant(&soul_obj).is_none(), 8);
        assert!(soul::grant_version(&soul_obj) == 3, 9);

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
        grant::destroy_for_testing(first_access_cap);
        grant::destroy_for_testing(second_access_cap);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soul_object::grant::EInvalidAgent)]
fun zero_address_cannot_be_granted() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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
        transfer::public_transfer(soul_obj, owner);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let access_cap = grant::set_agent_grant(&mut soul_obj, @0x0, ts::ctx(&mut scenario));
        grant::destroy_for_testing(access_cap);
        abort 8
    }
}

#[test]
#[expected_failure(abort_code = soul_object::grant::ESelfGrant)]
fun current_holder_cannot_grant_self() {
    let holder = @0xBEEF;
    let mut scenario = ts::begin(holder);

    {
        let ctx = ts::ctx(&mut scenario);
        let (walrus_system, blob) = register_test_blob(ctx);
        let soul_obj = soul::mint_for_testing(
            holder,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        transfer::public_transfer(soul_obj, holder);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, holder);
    {
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let access_cap = grant::set_agent_grant(&mut soul_obj, holder, ts::ctx(&mut scenario));
        grant::destroy_for_testing(access_cap);
        abort 7
    }
}

#[test]
#[expected_failure(abort_code = soul_object::grant::ENoAgentGrant)]
fun revoke_requires_existing_agent_grant() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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
        transfer::public_transfer(soul_obj, owner);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        grant::revoke_agent_grant(&mut soul_obj, ts::ctx(&mut scenario));
        abort 6
    }
}
