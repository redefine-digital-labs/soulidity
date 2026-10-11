#[test_only]
module interop_tests::interop_tests;
use std::string;
use sui::test_scenario;
use soulidity_standard::soul::{Self, Soul};
use independent_maker::maker::{Self, Maker};
use independent_ability::ability;
use independent_container::container::{Self, Container};

#[test]
fun producer_extension_and_container_preserve_actual_objects_across_handover() {
    let mut sc = test_scenario::begin(@0xa);
    let mut m = maker::new(b"third-party-definition", 2, sc.ctx()); let source = object::id(&m);
    let mut s = maker::mint_owned_for_testing(&mut m, string::utf8(b"Independent OC"), &mut sc);
    let root = object::id(&s); let origin = soul::origin(&s);
    assert!(soul::source(&origin) == source && soul::source_hash(&origin) == maker::definition_hash(&m), 0);
    ability::install(&mut s, 7, false, 0, sc.ctx()); let d = ability::descriptor(&s); let child = soul::module_id(&d);
    let before = soul::manifest_hash(&s); let mut c = container::new(sc.ctx()); let box_id = object::id(&c);
    container::deposit(&mut c, s, 1, before);
    ability::update(container::borrow_mut(&mut c), 31, 1);
    assert!(soul::module_id(&ability::descriptor(container::borrow(&c))) == child, 1);
    let updated = soul::manifest_hash(container::borrow(&c)); assert!(updated != before, 2);
    transfer::public_transfer(m, @0xa); transfer::public_transfer(c, @0xb);
    sc.next_tx(@0xb); let mut c: Container = sc.take_from_sender();
    assert!(object::id(&c) == box_id && object::id(container::borrow(&c)) == root, 3);
    soul::assert_manifest(container::borrow(&c), 2, updated);
    let mut s = container::withdraw(&mut c); container::destroy_empty(c);
    let a = ability::remove(&mut s, 2);
    assert!(object::id(&a) == child && ability::score_of(&a) == 31 && ability::target(&a) == root, 4);
    assert!(soul::module_count(&s) == 0, 5);
    ability::reattach(&mut s, a, 3);
    assert!(soul::module_id(&ability::descriptor(&s)) == child, 6);
    transfer::public_transfer(s, @0xb); sc.next_tx(@0xa);
    let m: Maker = sc.take_from_sender(); assert!(maker::issued(&m) == 1, 7); sc.return_to_sender(m); sc.end();
}

#[test, expected_failure(abort_code=1, location=independent_maker::maker)]
fun producer_cannot_exceed_its_supply() {
    let mut sc = test_scenario::begin(@0xa); let mut m = maker::new(b"definition", 1, sc.ctx());
    let s = maker::mint_owned_for_testing(&mut m, string::utf8(b"first"), &mut sc); transfer::public_transfer(s, @0xa);
    let s = maker::mint_owned_for_testing(&mut m, string::utf8(b"second"), &mut sc);
    transfer::public_transfer(s, @0xa); transfer::public_transfer(m, @0xa); sc.end();
}

#[test, expected_failure(abort_code=5, location=soulidity_standard::soul)]
fun container_rejects_stale_manifest_even_at_same_revision() {
    let mut sc = test_scenario::begin(@0xa); let mut m = maker::new(b"definition", 2, sc.ctx());
    let mut s = maker::mint_owned_for_testing(&mut m, string::utf8(b"OC"), &mut sc); let mut c = container::new(sc.ctx());
    let old = soul::manifest_hash(&s); ability::install(&mut s, 1, false, 0, sc.ctx());
    container::deposit(&mut c, s, 1, old); transfer::public_transfer(c, @0xa); transfer::public_transfer(m, @0xa); sc.end();
}

#[test, expected_failure(abort_code=8, location=soulidity_standard::soul)]
fun container_ownership_does_not_override_permanent_module_policy() {
    let mut sc = test_scenario::begin(@0xa); let mut m = maker::new(b"definition", 2, sc.ctx());
    let mut s = maker::mint_owned_for_testing(&mut m, string::utf8(b"OC"), &mut sc); ability::install(&mut s, 1, true, 0, sc.ctx());
    let hash = soul::manifest_hash(&s); let mut c = container::new(sc.ctx()); container::deposit(&mut c, s, 1, hash);
    let a = ability::remove(container::borrow_mut(&mut c), 1); transfer::public_transfer(a, @0xa);
    transfer::public_transfer(c, @0xa); transfer::public_transfer(m, @0xa); sc.end();
}

#[test, expected_failure(abort_code=1, location=independent_ability::ability)]
fun removed_feedback_cannot_be_reattached_to_another_soul() {
    let mut sc = test_scenario::begin(@0xa); let mut m = maker::new(b"definition", 2, sc.ctx());
    let mut s = maker::mint_owned_for_testing(&mut m, string::utf8(b"one"), &mut sc); let mut other = maker::mint_owned_for_testing(&mut m, string::utf8(b"two"), &mut sc);
    ability::install(&mut s, 1, false, 0, sc.ctx()); let a = ability::remove(&mut s, 1); ability::reattach(&mut other, a, 0);
    transfer::public_transfer(s, @0xa); transfer::public_transfer(other, @0xa); transfer::public_transfer(m, @0xa); sc.end();
}

#[test, expected_failure(abort_code=2, location=independent_ability::ability)]
fun application_feedback_rules_still_apply_inside_container() {
    let mut sc = test_scenario::begin(@0xa); let mut m = maker::new(b"definition", 2, sc.ctx());
    let mut s = maker::mint_owned_for_testing(&mut m, string::utf8(b"OC"), &mut sc); ability::install(&mut s, 1, false, 0, sc.ctx());
    let hash = soul::manifest_hash(&s); let mut c = container::new(sc.ctx()); container::deposit(&mut c, s, 1, hash);
    ability::update(container::borrow_mut(&mut c), 101, 1);
    transfer::public_transfer(c, @0xa); transfer::public_transfer(m, @0xa); sc.end();
}
