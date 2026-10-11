#[test_only]
module soulidity::kiosk_custody_vm_tests;

use std::string;
use sui::{kiosk::{Self as kiosk, Kiosk, KioskOwnerCap},
    test_scenario::{Self as ts, Scenario}, transfer_policy};
use soulidity::{collection, soul};

const OWNER: address = @0xA11;

// mode: 0 = place, 1 = place+list, 2 = lock, 3 = lock+list.
fun exercise<T: key + store>(mut s: Scenario, mut shop: Kiosk, cap: KioskOwnerCap, item: T, mode: u8) {
    let item_id = object::id(&item);
    let initially_listed = mode % 2 == 1;
    let locked = mode >= 2;
    if (locked) {
        let (policy, policy_cap) = transfer_policy::new_for_testing<T>(s.ctx());
        shop.lock(&cap, &policy, item);
        transfer::public_share_object(policy);
        transfer::public_transfer(policy_cap, OWNER);
    } else {
        shop.place(&cap, item);
    };
    if (initially_listed) shop.list<T>(&cap, item_id, 100);
    assert!(shop.is_listed(item_id) == initially_listed, 0);
    assert!(shop.is_locked(item_id) == locked, 1);
    transfer::public_share_object(shop);
    transfer::public_transfer(cap, OWNER);
    s.next_tx(OWNER);

    // Move test_scenario effects intentionally omit dynamic children. Assert
    // actual native-backed retrieval after a transaction boundary instead.
    let mut shop = s.take_shared<Kiosk>();
    let cap = s.take_from_sender<KioskOwnerCap>();
    assert!(object::id(shop.borrow<T>(&cap, item_id)) == item_id, 6);
    if (initially_listed) shop.delist<T>(&cap, item_id)
    else shop.list<T>(&cap, item_id, 200);
    assert!(shop.is_listed(item_id) != initially_listed, 7);
    assert!(shop.is_locked(item_id) == locked, 8);
    assert!(object::id(shop.borrow<T>(&cap, item_id)) == item_id, 9);
    ts::return_shared(shop);
    ts::return_to_sender(&s, cap);
    s.end();
}

fun soul_case(mode: u8) {
    let mut s = ts::begin(OWNER);
    let (shop, cap) = kiosk::new(s.ctx());
    let item = soul::mint(string::utf8(b"Soul"), string::utf8(b""), string::utf8(b""),
        OWNER, 0, 0, option::none(), s.ctx());
    exercise(s, shop, cap, item, mode);
}

fun collection_right_case(mode: u8) {
    let mut s = ts::begin(OWNER);
    let (shop, cap) = kiosk::new(s.ctx());
    let (collection, item) = collection::create(string::utf8(b"Collection"),
        string::utf8(b""), string::utf8(b""), 0, true, option::none(), option::none(),
        OWNER, object::id(&shop), s.ctx());
    collection::share_collection(collection);
    exercise(s, shop, cap, item, mode);
}

#[test] fun soul_placed_custody_survives_listing() { soul_case(0); }
#[test] fun soul_listed_custody_survives_delisting() { soul_case(1); }
#[test] fun soul_locked_custody_survives_listing() { soul_case(2); }
#[test] fun soul_locked_listed_custody_survives_delisting() { soul_case(3); }
#[test] fun collection_right_placed_custody_survives_listing() { collection_right_case(0); }
#[test] fun collection_right_listed_custody_survives_delisting() { collection_right_case(1); }
#[test] fun collection_right_locked_custody_survives_listing() { collection_right_case(2); }
#[test] fun collection_right_locked_listed_custody_survives_delisting() { collection_right_case(3); }
