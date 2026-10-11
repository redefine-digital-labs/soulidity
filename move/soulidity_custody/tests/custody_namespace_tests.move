#[test_only]
module soulidity_custody::custody_namespace_tests;
use sui::test_scenario as ts;
use sui::kiosk_extension as ext;
use soulidity_custody::account as custody;
public struct ActualNamespace has drop{}
public struct FakeNamespace has drop{}
#[test]
fun default_zero_permissions_and_fake_namespace_isolation(){
    let mut sc=ts::begin(@0xb);let(mut k,a)=custody::new(sc.ctx());
    custody::add_extension(ActualNamespace{},&mut k,&a,sc.ctx());
    custody::add_extension(FakeNamespace{},&mut k,&a,sc.ctx());
    assert!(ext::is_enabled<ActualNamespace>(&k) && ext::is_enabled<FakeNamespace>(&k),0);
    assert!(!ext::can_place<ActualNamespace>(&k) && !ext::can_lock<ActualNamespace>(&k) && !ext::can_place<FakeNamespace>(&k) && !ext::can_lock<FakeNamespace>(&k),1);
    custody::disable_extension(FakeNamespace{},&mut k,&a,sc.ctx());
    assert!(ext::is_enabled<ActualNamespace>(&k) && !ext::is_enabled<FakeNamespace>(&k),2);
    custody::enable_extension(FakeNamespace{},&mut k,&a,sc.ctx());
    custody::remove_extension(FakeNamespace{},&mut k,&a,sc.ctx());
    assert!(ext::is_enabled<ActualNamespace>(&k) && !ext::is_installed<FakeNamespace>(&k),3);
    custody::disable_extension(ActualNamespace{},&mut k,&a,sc.ctx());custody::remove_extension(ActualNamespace{},&mut k,&a,sc.ctx());
    custody::finalize(k,a,sc.ctx());sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun extension_control_rejects_crossed_genuine_account(){
    let mut sc=ts::begin(@0xb);let(mut k,a)=custody::new(sc.ctx());let(other,wrong)=custody::new(sc.ctx());
    custody::add_extension(ActualNamespace{},&mut k,&wrong,sc.ctx());custody::finalize(k,a,sc.ctx());custody::finalize(other,wrong,sc.ctx());sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_custody::account)]
fun extension_control_rejects_changed_sender(){
    let mut sc=ts::begin(@0xb);let(mut k,a)=custody::new(sc.ctx());sc.next_tx(@0xc);
    custody::add_extension(ActualNamespace{},&mut k,&a,sc.ctx());custody::finalize(k,a,sc.ctx());sc.end();
}
