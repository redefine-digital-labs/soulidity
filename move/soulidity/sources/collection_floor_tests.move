#[test_only]
module soulidity::collection_floor_tests;

use std::string;
use soulidity::collection;
use sui::test_scenario as ts;

fun roundtrip(floor: Option<u128>) {
    let mut scenario = ts::begin(@0xA);
    let (collection, right) = collection::create(string::utf8(b"Floor"), string::utf8(b"Policy"),
        string::utf8(b"https://example.com/image"), 250, true, option::none(), floor,
        @0xA, object::id_from_address(@0xB), scenario.ctx());
    assert!(collection::floor_price_atomic(&collection) == floor, 0);
    collection::destroy_right_for_testing(right);
    collection::share_collection(collection);
    scenario.next_tx(@0xA);
    let collection = ts::take_shared<collection::SoulCollection>(&scenario);
    assert!(collection::floor_price_atomic(&collection) == floor, 1);
    collection::destroy_collection_for_testing(collection);
    scenario.end();
}

#[test] fun none_policy_is_persisted() { roundtrip(option::none()); }
#[test] fun zero_policy_is_not_none() { roundtrip(option::some(0)); }
#[test] fun above_u64_is_not_truncated() { roundtrip(option::some(18_446_744_073_709_551_616)); }
#[test] fun maximum_policy_is_preserved() { roundtrip(option::some(99_999_999_999_999_999_999)); }
#[test]
#[expected_failure(abort_code = 7, location = soulidity::collection)]
fun over_maximum_is_rejected() { roundtrip(option::some(100_000_000_000_000_000_000)); }
