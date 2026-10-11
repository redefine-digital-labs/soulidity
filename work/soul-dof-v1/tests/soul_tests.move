#[test_only]
module soul_dof_v1::soul_tests;

use std::string;
use soul_dof_v1::soul::{Self, Soul};
use soul_dof_v1::assets::{Self, Hat, Other, Namespace, Container};
use sui::coin::{Self, Coin};
use sui::kiosk::{Self, Kiosk};
use sui::sui::SUI;
use sui::test_scenario as ts;
use sui::transfer_policy;

const SELLER: address = @0xA;
const BUYER: address = @0xB;

fun mint(ctx: &mut TxContext): ID {
    soul::mint_to(string::utf8(b"DOF Soul"), vector::tabulate!(32, |_| 0),
        vector[soul::slot_definition<Hat, Namespace>(b"head"), soul::slot_definition<Hat, Namespace>(b"hand")], SELLER, ctx)
}

#[test]
fun withdraw_active_item_keeps_id_and_returns_wallet_custody() {
    let mut s = ts::begin(SELLER);
    let soul_id = mint(s.ctx());
    s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>();
    let hat = assets::hat(s.ctx()); let item_id = object::id(&hat);
    soul::deposit(&mut root, hat, 0);
    assert!(soul::active_item(&root, soul::slot_key<Namespace>(b"head")).is_none(), 100);
    soul::activate<Hat>(&mut root, item_id, soul::slot_key<Namespace>(b"head"), 1);
    let original = soul::withdraw<Hat>(&mut root, item_id, 2);
    assert!(object::id(&original) == item_id && object::id(&root) == soul_id, 101);
    assert!(soul::member_count(&root) == 0 && soul::revision(&root) == 3, 102);
    assert!(soul::active_item(&root, soul::slot_key<Namespace>(b"head")).is_none(), 103);
    transfer::public_transfer(original, SELLER); ts::return_to_sender(&s, root);
    s.next_tx(SELLER);
    let hat = s.take_from_sender<Hat>(); assert!(object::id(&hat) == item_id, 104);
    ts::return_to_sender(&s, hat); s.end();
}

#[test]
fun whole_transfer_preserves_composition_and_buyer_can_withdraw() {
    let mut s = ts::begin(SELLER); let soul_id = mint(s.ctx());
    s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>();
    let core_id = object::id(soul::core(&root));
    let hat = assets::hat(s.ctx()); let item_id = object::id(&hat);
    soul::deposit(&mut root, hat, 0);
    soul::activate<Hat>(&mut root, item_id, soul::slot_key<Namespace>(b"head"), 1);
    transfer::public_transfer(root, BUYER);
    s.next_tx(BUYER);
    let mut root = s.take_from_sender<Soul>();
    assert!(object::id(&root) == soul_id && object::id(soul::core(&root)) == core_id, 100);
    assert!(soul::active_item(&root, soul::slot_key<Namespace>(b"head")) == option::some(item_id), 101);
    assert!(object::id(soul::borrow_item<Hat>(&root, item_id)) == item_id, 102);
    transfer::public_transfer(soul::withdraw<Hat>(&mut root, item_id, 2), BUYER);
    ts::return_to_sender(&s, root); s.next_tx(BUYER);
    let hat = s.take_from_sender<Hat>(); assert!(object::id(&hat) == item_id, 103);
    ts::return_to_sender(&s, hat); s.end();
}

#[test]
fun nested_container_transfer_preserves_root_and_item() {
    let mut s = ts::begin(SELLER); let soul_id = mint(s.ctx());
    s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>(); let hat = assets::hat(s.ctx()); let item_id = object::id(&hat);
    soul::deposit(&mut root, hat, 0);
    transfer::public_transfer(assets::container(root, s.ctx()), BUYER);
    s.next_tx(BUYER);
    let mut c = s.take_from_sender<Container>(); let mut root = assets::take_soul(&mut c);
    assert!(object::id(&root) == soul_id && soul::member_count(&root) == 1, 100);
    transfer::public_transfer(soul::withdraw<Hat>(&mut root, item_id, 1), BUYER);
    transfer::public_transfer(root, BUYER); ts::return_to_sender(&s, c); s.end();
}

#[test]
fun replace_returns_old_item_and_changes_one_revision() {
    let mut s = ts::begin(SELLER); mint(s.ctx()); s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>();
    let old = assets::hat(s.ctx()); let old_id = object::id(&old);
    soul::deposit(&mut root, old, 0);
    soul::activate<Hat>(&mut root, old_id, soul::slot_key<Namespace>(b"head"), 1);
    let new = assets::hat(s.ctx()); let new_id = object::id(&new);
    let replaced = soul::replace(&mut root, soul::slot_key<Namespace>(b"head"), new, 2);
    let old = replaced.destroy_some(); assert!(object::id(&old) == old_id, 100);
    assert!(!soul::has_item(&root, old_id) && soul::has_item(&root, new_id), 101);
    assert!(soul::active_item(&root, soul::slot_key<Namespace>(b"head")) == option::some(new_id), 102);
    assert!(soul::revision(&root) == 3 && soul::member_count(&root) == 1, 103);
    transfer::public_transfer(old, SELLER); ts::return_to_sender(&s, root); s.end();
}

#[test]
fun deactivate_keeps_inventory_and_foreign_framework_object_is_supported() {
    let mut s = ts::begin(SELLER);
    soul::mint_to(string::utf8(b"Generic"), vector::tabulate!(32, |_| 0),
        vector[soul::slot_definition<Coin<SUI>, Namespace>(b"balance")], SELLER, s.ctx());
    s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>(); let coin = coin::mint_for_testing<SUI>(10, s.ctx()); let id = object::id(&coin);
    soul::deposit(&mut root, coin, 0);
    soul::activate<Coin<SUI>>(&mut root, id, soul::slot_key<Namespace>(b"balance"), 1);
    soul::deactivate(&mut root, id, 2);
    assert!(soul::has_item(&root, id) && soul::active_item(&root, soul::slot_key<Namespace>(b"balance")).is_none(), 100);
    let coin = soul::withdraw<Coin<SUI>>(&mut root, id, 3); assert!(coin.value() == 10, 101);
    transfer::public_transfer(coin, SELLER); ts::return_to_sender(&s, root); s.end();
}

#[test]
fun generic_kiosk_sale_transfers_root_and_equipped_child() {
    let mut s = ts::begin(SELLER); let soul_id = mint(s.ctx()); s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>(); let hat = assets::hat(s.ctx()); let id = object::id(&hat);
    soul::deposit(&mut root, hat, 0); soul::activate<Hat>(&mut root, id, soul::slot_key<Namespace>(b"head"), 1);
    let (mut shop, cap) = kiosk::new(s.ctx());
    let (policy, policy_cap) = transfer_policy::new_for_testing<Soul>(s.ctx());
    shop.place(&cap, root); shop.list<Soul>(&cap, soul_id, 100);
    transfer::public_share_object(shop); transfer::public_transfer(cap, SELLER);
    transfer::public_share_object(policy); transfer::public_transfer(policy_cap, SELLER);
    s.next_tx(BUYER);
    let mut shop = s.take_shared<Kiosk>(); let policy = s.take_shared<transfer_policy::TransferPolicy<Soul>>();
    let (mut root, request) = shop.purchase<Soul>(soul_id, coin::mint_for_testing<SUI>(100, s.ctx()));
    let (_, _, _) = policy.confirm_request(request);
    assert!(soul::active_item(&root, soul::slot_key<Namespace>(b"head")) == option::some(id), 100);
    transfer::public_transfer(soul::withdraw<Hat>(&mut root, id, 2), BUYER);
    transfer::public_transfer(root, BUYER); ts::return_shared(shop); ts::return_shared(policy); s.end();
}

#[test, expected_failure(abort_code = 0, location = soul_dof_v1::soul)]
fun stale_revision_is_rejected() {
    let mut s = ts::begin(SELLER); mint(s.ctx()); s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>(); soul::deposit(&mut root, assets::hat(s.ctx()), 1);
    ts::return_to_sender(&s, root); s.end();
}

#[test, expected_failure(abort_code = 4, location = soul_dof_v1::soul)]
fun incompatible_activation_is_rejected() {
    let mut s = ts::begin(SELLER); mint(s.ctx()); s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>(); let other = assets::other(s.ctx()); let id = object::id(&other);
    soul::deposit(&mut root, other, 0);
    soul::activate<Other>(&mut root, id, soul::slot_key<Namespace>(b"head"), 1);
    ts::return_to_sender(&s, root); s.end();
}

#[test, expected_failure(abort_code = 6, location = soul_dof_v1::soul)]
fun one_instance_cannot_activate_in_two_slots() {
    let mut s = ts::begin(SELLER); mint(s.ctx()); s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>(); let hat = assets::hat(s.ctx()); let id = object::id(&hat);
    soul::deposit(&mut root, hat, 0);
    soul::activate<Hat>(&mut root, id, soul::slot_key<Namespace>(b"head"), 1);
    soul::activate<Hat>(&mut root, id, soul::slot_key<Namespace>(b"hand"), 2);
    ts::return_to_sender(&s, root); s.end();
}

#[test, expected_failure(abort_code = 5, location = soul_dof_v1::soul)]
fun occupied_slot_is_rejected() {
    let mut s = ts::begin(SELLER); mint(s.ctx()); s.next_tx(SELLER);
    let mut root = s.take_from_sender<Soul>(); let one = assets::hat(s.ctx()); let id_one = object::id(&one);
    let two = assets::hat(s.ctx()); let id_two = object::id(&two);
    soul::deposit(&mut root, one, 0); soul::deposit(&mut root, two, 1);
    soul::activate<Hat>(&mut root, id_one, soul::slot_key<Namespace>(b"head"), 2);
    soul::activate<Hat>(&mut root, id_two, soul::slot_key<Namespace>(b"head"), 3);
    ts::return_to_sender(&s, root); s.end();
}
