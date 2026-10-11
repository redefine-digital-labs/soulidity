#[test_only]
module soulidity_v1::nested_vault_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_v1::standard_extension_fixture as producer;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_application::vault;
use soulidity_v1::storage_fixture;
use walrus::system::System;
fun bare(sc:&mut Scenario):Soul{let(seed,s)=producer::bare_soul(sc.ctx());transfer::public_transfer(seed,sc.sender());s}
fun attach_tool(sc:&mut Scenario,s:&mut Soul,n:u64){let r=standard::revision(s);vault::install(s,r,sc.ctx());let r=standard::revision(s);vault::deposit_coin(s,coin::mint_for_testing<USD>(n,sc.ctx()),fixtures::h((n as u8)),0,r,sc.ctx())}
#[test]
fun parent_without_tool_rotates_child_through_foreign_soul_preserving_assets(){
 let mut sc=test_scenario::begin(@0xb);let mut parent=bare(&mut sc);let mut branch=bare(&mut sc);let mut child=bare(&mut sc);attach_tool(&mut sc,&mut child,73);
 let child_id=object::id(&child);let branch_id=object::id(&branch);let root_id=object::id(&parent);let tool=object::id(vault::tool(&child));let origin=standard::origin(&child);let r=standard::revision(&branch);standard::nest(&mut branch,child,r);let r=standard::revision(&parent);standard::nest(&mut parent,branch,r);let before=standard::manifest_hash(&parent);
 vault::prepare_handover(&mut parent);assert!(standard::manifest_hash(&parent)!=before && !vault::installed(&parent),0);let c=standard::nested(standard::nested(&parent,branch_id),child_id);assert!(object::id(vault::tool(c))==tool && vault::privacy_generation(vault::tool(c))==1 && vault::coin_balance<USD>(c)==73 && standard::origin(c)==origin,1);
 transfer::public_transfer(parent,@0xc);sc.next_tx(@0xc);let mut parent:Soul=sc.take_from_sender_by_id(root_id);let r=standard::revision(&parent);let mut branch=standard::unnest(&mut parent,branch_id,r);let r=standard::revision(&branch);let mut child=standard::unnest(&mut branch,child_id,r);let r=standard::revision(&child);let out=vault::withdraw_coin<USD>(&mut child,73,fixtures::h(74),2,r,sc.ctx());assert!(coin::value(&out)==73 && object::id(&child)==child_id,2);transfer::public_transfer(out,@0xc);transfer::public_transfer(child,@0xc);transfer::public_transfer(branch,@0xc);sc.return_to_sender(parent);sc.end();
}
#[test]
fun siblings_and_root_each_rotate_once(){let mut sc=test_scenario::begin(@0xb);let mut parent=bare(&mut sc);attach_tool(&mut sc,&mut parent,71);let mut left=bare(&mut sc);attach_tool(&mut sc,&mut left,72);let mut right=bare(&mut sc);attach_tool(&mut sc,&mut right,73);let l=object::id(&left);let r=object::id(&right);let rev=standard::revision(&parent);standard::nest(&mut parent,left,rev);let rev=standard::revision(&parent);standard::nest(&mut parent,right,rev);vault::prepare_handover(&mut parent);assert!(vault::privacy_generation(vault::tool(&parent))==1 && vault::privacy_generation(vault::tool(standard::nested(&parent,l)))==1 && vault::privacy_generation(vault::tool(standard::nested(&parent,r)))==1,0);assert!(vault::coin_balance<USD>(&parent)==71 && vault::coin_balance<USD>(standard::nested(&parent,l))==72 && vault::coin_balance<USD>(standard::nested(&parent,r))==73,1);transfer::public_transfer(parent,@0xb);sc.end();}
#[test]
fun exact_depth_sixteen_rotates_deepest_tool(){let mut sc=test_scenario::begin(@0xb);let mut child=bare(&mut sc);attach_tool(&mut sc,&mut child,73);let id=object::id(&child);let mut path=vector[];let mut i=0;while(i < 16){let mut parent=bare(&mut sc);path.push_back(object::id(&child));standard::nest(&mut parent,child,0);child=parent;i=i+1};vault::prepare_handover(&mut child);let mut p=&child;let mut i=16;while(i > 0){i=i-1;p=standard::nested(p,path[i])};assert!(object::id(p)==id && vault::privacy_generation(vault::tool(p))==1 && vault::coin_balance<USD>(p)==73,0);transfer::public_transfer(child,@0xb);sc.end();}
#[test,expected_failure(abort_code=6,location=soulidity_application::vault)]
fun depth_seventeen_rejects_before_handover(){let mut sc=test_scenario::begin(@0xb);let mut child=bare(&mut sc);attach_tool(&mut sc,&mut child,73);let mut i=0;while(i < 17){let mut parent=bare(&mut sc);standard::nest(&mut parent,child,0);child=parent;i=i+1};vault::prepare_handover(&mut child);transfer::public_transfer(child,@0xb);sc.end();}
#[test]
fun nested_certified_private_receipt_survives_scope_rotation_without_head_revival(){
 let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xb);let mut sys:System=sc.take_shared();let mut parent=bare(&mut sc);let mut child=bare(&mut sc);attach_tool(&mut sc,&mut child,73);let blob=storage_fixture::blob(&mut sys,123,false,true,sc.ctx());let r=standard::revision(&child);vault::save_private(&mut child,blob,&sys,fixtures::h(123),fixtures::h(124),0,1,r,sc.ctx());assert!(vault::private_head(&child,@0xb).is_some(),0);let id=object::id(&child);let r=standard::revision(&parent);standard::nest(&mut parent,child,r);vault::prepare_handover(&mut parent);let child=standard::nested(&parent,id);assert!(vault::private_head(child,@0xb).is_none() && vault::private_receipt(child,@0xb,0,fixtures::h(124)).is_some() && vault::coin_balance<USD>(child)==73,1);vault::prepare_handover(&mut parent);assert!(vault::privacy_generation(vault::tool(standard::nested(&parent,id)))==2 && vault::private_head(standard::nested(&parent,id),@0xb).is_none(),2);transfer::public_transfer(parent,@0xb);test_scenario::return_shared(sys);sc.end();
}
