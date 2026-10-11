#[test_only]
module vault_tool_probe::vault_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::vault;
use vault_tool_probe::producer;
use vault_tool_probe::storage_fixture;
use walrus::system::System;
public struct USD has drop {}
public struct EUR has drop {}
public struct Item has key,store {id:UID,score:u64}
public struct Other has key,store {id:UID}
fun h(n:u8):vector<u8>{vector::tabulate!(32,|_|n)}
fun setup():(Scenario,Soul){let mut sc=test_scenario::begin(@0xa);let mut s=producer::create_owned_for_testing(&mut sc);vault::install(&mut s,0,sc.ctx());(sc,s)}
fun finish(sc:Scenario,s:Soul){transfer::public_transfer(s,@0xa);sc.end();}
fun deposit(sc:&mut Scenario,s:&mut Soul,n:u64,request:u8){let t=vault::revision(vault::tool(s));let r=standard::revision(s);vault::deposit_coin(s,coin::mint_for_testing<USD>(n,sc.ctx()),h(request),t,r,sc.ctx())}
fun withdraw(sc:&mut Scenario,s:&mut Soul,n:u64,request:u8):sui::coin::Coin<USD>{let t=vault::revision(vault::tool(s));let r=standard::revision(s);vault::withdraw_coin(s,n,h(request),t,r,sc.ctx())}
#[test]
fun tool_is_child_of_same_standard_root_and_not_an_owner_cap(){let(sc,s)=setup();let d=standard::descriptor<vault::ContentOperator>(&s,b"vault").destroy_some();assert!(standard::module_id(&d)==object::id(vault::tool(&s)) && vault::root(vault::tool(&s))==object::id(&s) && !standard::removable(&d),0);assert!(standard::module_count(&s)==1 && standard::revision(&s)==1,1);finish(sc,s)}
#[test]
fun typed_coins_and_accounting_conserve_without_platform_or_maker(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,100,1);let r=standard::revision(&s);vault::deposit_coin(&mut s,coin::mint_for_testing<EUR>(20,sc.ctx()),h(2),1,r,sc.ctx());let c=withdraw(&mut sc,&mut s,40,3);assert!(coin::value(&c)==40 && vault::coin_balance<USD>(&s)==60 && vault::coin_balance<EUR>(&s)==20,0);let a=vault::coin_summary<USD>(&s).destroy_some();assert!(vault::deposited(&a)==100 && vault::withdrawn(&a)==40 && vault::summary_balance(&a)==60,1);coin::burn_for_testing(c);finish(sc,s)}
#[test]
fun whole_root_transfer_carries_funds_and_buyer_can_withdraw(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,100,1);let root=object::id(&s);let id=object::id(vault::tool(&s));let commitment=standard::manifest_hash(&s);transfer::public_transfer(s,@0xb);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);assert!(object::id(vault::tool(&s))==id && standard::manifest_hash(&s)==commitment,0);let c=withdraw(&mut sc,&mut s,100,2);assert!(coin::value(&c)==100 && vault::coin_balance<USD>(&s)==0,1);coin::burn_for_testing(c);sc.return_to_sender(s);sc.next_tx(@0xa);assert!(sc.ids_for_sender<Soul>().is_empty(),2);sc.end();}
#[test]
fun original_asset_id_survives_deposit_and_withdraw(){let(mut sc,mut s)=setup();let a=Item{id:object::new(sc.ctx()),score:7};let id=object::id(&a);let r=standard::revision(&s);vault::deposit_asset(&mut s,a,h(1),0,r,sc.ctx());assert!(vault::has_asset<Item>(&s,id) && vault::asset<Item>(&s,id).score==7,0);let r=standard::revision(&s);let a:Item=vault::withdraw_asset(&mut s,id,h(2),1,r,sc.ctx());assert!(object::id(&a)==id && !vault::has_asset<Item>(&s,id),1);transfer::public_transfer(a,@0xa);finish(sc,s)}
#[test]
fun coin_and_asset_mutations_change_standard_manifest(){let(mut sc,mut s)=setup();let before=standard::manifest_hash(&s);deposit(&mut sc,&mut s,9,1);let after=standard::manifest_hash(&s);assert!(before!=after,0);let c=withdraw(&mut sc,&mut s,9,2);assert!(after!=standard::manifest_hash(&s) && vault::action(&s,h(2)).is_some(),1);coin::burn_for_testing(c);finish(sc,s)}
#[test,expected_failure(abort_code=1,location=soulidity_application::vault)]
fun stale_standard_revision_rejects_deposit(){let(mut sc,mut s)=setup();vault::deposit_coin(&mut s,coin::mint_for_testing<USD>(10,sc.ctx()),h(1),0,0,sc.ctx());finish(sc,s)}
#[test,expected_failure(abort_code=1,location=soulidity_application::vault)]
fun stale_tool_revision_rejects_deposit(){let(mut sc,mut s)=setup();vault::deposit_coin(&mut s,coin::mint_for_testing<USD>(10,sc.ctx()),h(1),1,1,sc.ctx());finish(sc,s)}
#[test,expected_failure(abort_code=5,location=soulidity_application::vault)]
fun permanent_request_prevents_double_withdraw_after_new_revision(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,100,1);let c=withdraw(&mut sc,&mut s,10,2);coin::burn_for_testing(c);let c=withdraw(&mut sc,&mut s,10,2);coin::burn_for_testing(c);finish(sc,s)}
#[test,expected_failure(abort_code=3,location=soulidity_application::vault)]
fun insufficient_balance_rejects_withdraw(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,10,1);let c=withdraw(&mut sc,&mut s,11,2);coin::burn_for_testing(c);finish(sc,s)}
#[test,expected_failure(abort_code=3,location=soulidity_application::vault)]
fun zero_withdraw_is_rejected(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,10,1);let c=withdraw(&mut sc,&mut s,0,2);coin::burn_for_testing(c);finish(sc,s)}
#[test,expected_failure(abort_code=4,location=soulidity_application::vault)]
fun correct_coin_type_is_required(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,10,1);let r=standard::revision(&s);let c=vault::withdraw_coin<EUR>(&mut s,1,h(2),1,r,sc.ctx());coin::burn_for_testing(c);finish(sc,s)}
#[test,expected_failure(abort_code=4,location=soulidity_application::vault)]
fun original_id_does_not_allow_wrong_asset_type(){let(mut sc,mut s)=setup();let a=Item{id:object::new(sc.ctx()),score:7};let id=object::id(&a);let r=standard::revision(&s);vault::deposit_asset(&mut s,a,h(1),0,r,sc.ctx());let r=standard::revision(&s);let a:Other=vault::withdraw_asset(&mut s,id,h(2),1,r,sc.ctx());transfer::public_transfer(a,@0xa);finish(sc,s)}
#[test,expected_failure(abort_code=8,location=soulidity_standard::soul)]
fun whole_tool_cannot_be_uninstalled_to_escape_receipts(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,10,1);let r=standard::revision(&s);let v=standard::uninstall<vault::ContentOperator,vault::Vault>(&mut s,b"vault",r);transfer::public_transfer(v,@0xa);finish(sc,s)}
#[test]
fun privacy_rotation_never_spends_or_erases_funds(){let(mut sc,mut s)=setup();deposit(&mut sc,&mut s,100,1);let r=standard::revision(&s);vault::rotate_private_scope(&mut s,1,r);assert!(vault::privacy_generation(vault::tool(&s))==1 && vault::coin_balance<USD>(&s)==100 && vault::action(&s,h(1)).is_some(),0);let c=withdraw(&mut sc,&mut s,100,2);coin::burn_for_testing(c);finish(sc,s)}
fun private_setup():(Scenario,Soul,System){let mut sc=test_scenario::begin(@0xa);storage_fixture::initialize(&mut sc);let mut s=producer::create_owned_for_testing(&mut sc);vault::install(&mut s,0,sc.ctx());let sys=sc.take_shared();(sc,s,sys)}
#[test]
fun certified_encrypted_library_is_below_tool_without_funds_authority(){let(mut sc,mut s,mut sys)=private_setup();deposit(&mut sc,&mut s,100,1);let blob=storage_fixture::blob(&mut sys,33,false,true,sc.ctx());let r=standard::revision(&s);vault::save_private(&mut s,blob,&sys,h(31),h(32),0,1,r,sc.ctx());let id=vault::private_seal_id(&s,@0xa);vault::seal_approve_private_owner(id,&mut s,&sys,sc.ctx());assert!(vault::private_head(&s,@0xa).is_some() && vault::coin_balance<USD>(&s)==100,0);test_scenario::return_shared(sys);finish(sc,s)}
#[test]
fun private_rotation_invalidates_head_but_preserves_receipts_and_funds(){let(mut sc,mut s,mut sys)=private_setup();deposit(&mut sc,&mut s,50,1);let blob=storage_fixture::blob(&mut sys,34,false,true,sc.ctx());let r=standard::revision(&s);vault::save_private(&mut s,blob,&sys,h(31),h(32),0,1,r,sc.ctx());let receipt=vault::private_receipt(&s,@0xa,0,h(32));assert!(receipt.is_some(),1);let old=vault::private_seal_id(&s,@0xa);let r=standard::revision(&s);vault::rotate_private_scope(&mut s,2,r);assert!(vault::private_head(&s,@0xa).is_none() && old!=vault::private_seal_id(&s,@0xa) && vault::private_receipt(&s,@0xa,0,h(32))==receipt && vault::coin_balance<USD>(&s)==50,0);let blob=storage_fixture::blob(&mut sys,35,false,true,sc.ctx());let r=standard::revision(&s);vault::save_private(&mut s,blob,&sys,h(33),h(34),0,3,r,sc.ctx());vault::seal_approve_private_owner(vault::private_seal_id(&s,@0xa),&mut s,&sys,sc.ctx());test_scenario::return_shared(sys);finish(sc,s)}
#[test]
fun whole_root_transfer_carries_original_asset_and_buyer_exits_same_id(){let(mut sc,mut s)=setup();let a=Item{id:object::new(sc.ctx()),score:8};let id=object::id(&a);let root=object::id(&s);let r=standard::revision(&s);vault::deposit_asset(&mut s,a,h(1),0,r,sc.ctx());transfer::public_transfer(s,@0xb);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);let r=standard::revision(&s);let a:Item=vault::withdraw_asset(&mut s,id,h(2),1,r,sc.ctx());assert!(object::id(&a)==id && a.score==8 && !vault::has_asset<Item>(&s,id),0);transfer::public_transfer(a,@0xb);sc.return_to_sender(s);sc.next_tx(@0xa);assert!(sc.ids_for_sender<Soul>().is_empty() && sc.ids_for_sender<Item>().is_empty(),1);sc.end();}
