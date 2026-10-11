#[test_only]
module soulidity_v1::collection_metadata_tests;

use std::string::{Self, String};
use sui::clock;
use sui::kiosk::{Self, Kiosk};
use sui::test_scenario;
use sui::transfer_policy::TransferPolicy;
use soulidity_foundation::economics::Config;
use soulidity_collection::collection::{Collection,Factory,Right};
use soulidity_v1::collection;
use soulidity_custody::account::{Self as custody, Account};
use soulidity_v1::fixtures::{Self, USD};

fun repeat(bytes: vector<u8>, count: u64): String {
    let mut out = vector[];
    let mut i = 0;
    while (i < count) { out.append(bytes); i = i + 1 };
    string::utf8(out)
}

fun roundtrip(name: String, description: String, image: String) {
    let mut sc = fixtures::setup_collection(0, 0, 0, 0, 0, 0);
    collection::init_for_testing(sc.ctx());
    let kid = custody::create(sc.ctx());
    sc.next_tx(@0xb);
    let cfg: Config<USD> = sc.take_shared();
    let factory: Factory = sc.take_shared();
    let policy: TransferPolicy<Right> = sc.take_shared();
    let mut kiosk: Kiosk = sc.take_shared_by_id(kid);
    let mut account: Account = sc.take_from_sender();
    let clock = clock::create_for_testing(sc.ctx());
    let cid = collection::create(&factory, &policy, &cfg, &mut kiosk, &mut account,
        name, description, image, 123, true, option::some(2), option::some(0),
        0, 1000, &clock, sc.ctx());
    sc.next_tx(@0xb);
    let c: Collection = sc.take_shared_by_id(cid);
    let r = collection::right_for_testing(&cfg,&mut kiosk,&account,collection::right_id(&c),sc.ctx());
    assert!(collection::right_name(r) == name && collection::right_description(r) == description
        && collection::right_image(r) == image, 0);
    assert!(collection::protocol_version() == 1 && collection::version(&c) == 1
        && collection::right_version(r) == 1, 1);
    assert!(collection::creator(&c) == @0xb && collection::current_holder(&c) == @0xb
        && collection::current_kiosk(&c) == kid && collection::right_collection(r) == cid, 2);
    assert!(collection::extra_royalty(&c) == 123 && collection::tradeable(&c)
        && collection::max_supply(&c) == option::some(2) && collection::supply(&c) == 0
        && collection::floor_price(&c) == option::some(0), 3);
    assert!(kiosk::is_locked(&kiosk, collection::right_id(&c)), 4);
    test_scenario::return_shared(c);
    test_scenario::return_shared(kiosk);
    test_scenario::return_shared(cfg);
    test_scenario::return_shared(factory);
    test_scenario::return_shared(policy);
    sc.return_to_sender(account);
    clock::destroy_for_testing(clock);
    sc.end();
}

#[test]
fun original_empty_metadata_is_preserved() {
    roundtrip(string::utf8(b""), string::utf8(b""), string::utf8(b""))
}
#[test]
fun original_name_above_128_bytes_is_preserved() {
    roundtrip(repeat(b"N", 129), string::utf8(b""), string::utf8(b""))
}
#[test]
fun original_description_above_4096_bytes_is_preserved() {
    roundtrip(string::utf8(b"Name"), repeat(b"D", 4097), string::utf8(b""))
}
#[test]
fun original_image_above_2048_bytes_is_preserved() {
    roundtrip(string::utf8(b"Name"), string::utf8(b""), repeat(b"I", 2049))
}
#[test]
fun original_multibyte_name_is_preserved_exactly() {
    // 65 Unicode characters, 130 UTF-8 bytes; byte length is not character count.
    roundtrip(repeat(vector[0xc3, 0xa9], 65), string::utf8(b""), string::utf8(b""))
}
