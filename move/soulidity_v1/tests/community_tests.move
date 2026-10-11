#[test_only]
module soulidity_v1::community_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use soulidity_v1::fixtures;
use soulidity_community::profile::{Self,ProfileRegistryV1};
use soulidity_community::social::{Self,SocialRegistryV1};
use soulidity_community::community_posts::{Self as posts,CommunityRegistryV1,PostV1,CommentV1};
use soulidity_community::community_votes::{Self as votes,VoteRegistryV1};
fun setup():(Scenario,ID,ID,ID) {
    let mut sc=test_scenario::begin(@0xa);profile::init_for_testing(sc.ctx());social::init_for_testing(sc.ctx());posts::init_for_testing(sc.ctx());votes::init_for_testing(sc.ctx());sc.next_tx(@0xa);
    let mut profiles:ProfileRegistryV1=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let alice=profile::create_profile(&mut profiles,string::utf8(b"alice"),object::id_from_address(@0x11),fixtures::h(1),fixtures::h(2),20,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(profiles);sc.next_tx(@0xb);
    let mut profiles:ProfileRegistryV1=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let bob=profile::create_profile(&mut profiles,string::utf8(b"bob"),object::id_from_address(@0x12),fixtures::h(3),fixtures::h(4),20,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(profiles);sc.next_tx(@0xa);
    let profiles:ProfileRegistryV1=sc.take_shared();let mut community:CommunityRegistryV1=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let post=posts::create_post(&mut community,&profiles,alice,1,1,object::id_from_address(@0x13),fixtures::h(5),fixtures::h(6),20,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(profiles);test_scenario::return_shared(community);sc.next_tx(@0xb);(sc,alice,bob,post)
}
#[test]
fun follow_cas_counts_and_tombstone(){
    let(mut sc,alice,bob,_post)=setup();let profiles:ProfileRegistryV1=sc.take_shared();let mut registry:SocialRegistryV1=sc.take_shared();
    assert!({let (x,y)=social::set_follow(&mut registry,&profiles,bob,alice,@0xa,0,true,sc.ctx());x==true && y==1},0);
    assert!({let (x,y)=social::counts(&registry,bob);x==0 && y==1} && {let (x,y)=social::counts(&registry,alice);x==1 && y==0},1);
    assert!({let (x,y)=social::set_follow(&mut registry,&profiles,bob,alice,@0xa,1,true,sc.ctx());x==true && y==1},2);
    assert!({let (x,y)=social::set_follow(&mut registry,&profiles,bob,alice,@0xa,1,false,sc.ctx());x==false && y==2},3);
    assert!({let (x,y)=social::counts(&registry,bob);x==0 && y==0} && {let (x,y)=social::counts(&registry,alice);x==0 && y==0} && {let (x,y)=social::edge(&registry,bob,alice);x==false && y==2},4);
    test_scenario::return_shared(registry);test_scenario::return_shared(profiles);sc.end();
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_community::social)]
fun old_follow_intent_rejected_after_round_trip(){
    let(mut sc,alice,bob,_post)=setup();let profiles:ProfileRegistryV1=sc.take_shared();let mut registry:SocialRegistryV1=sc.take_shared();social::set_follow(&mut registry,&profiles,bob,alice,@0xa,0,true,sc.ctx());social::set_follow(&mut registry,&profiles,bob,alice,@0xa,1,false,sc.ctx());social::set_follow(&mut registry,&profiles,bob,alice,@0xa,0,true,sc.ctx());test_scenario::return_shared(registry);test_scenario::return_shared(profiles);sc.end();
}
#[test]
fun votes_are_desired_states_preserve_post_time(){
    let(mut sc,_alice,bob,post_id)=setup();let profiles:ProfileRegistryV1=sc.take_shared();let community:CommunityRegistryV1=sc.take_shared();let post:PostV1=sc.take_shared_by_id(post_id);let mut registry:VoteRegistryV1=sc.take_shared();let before=posts::updated_at_ms(&post);
    assert!({let (x,y)=votes::set_vote(&mut registry,&community,&profiles,&post,bob,0,1,sc.ctx());x==1 && y==1},0);
    assert!({let (x,y)=votes::set_vote(&mut registry,&community,&profiles,&post,bob,1,2,sc.ctx());x==2 && y==2},1);
    assert!({let (x,y)=votes::counts(&registry,&community,&profiles,&post);x==0 && y==1},2);
    assert!({let (x,y)=votes::set_vote(&mut registry,&community,&profiles,&post,bob,2,2,sc.ctx());x==2 && y==2},3);
    assert!({let (x,y)=votes::set_vote(&mut registry,&community,&profiles,&post,bob,2,0,sc.ctx());x==0 && y==3},4);
    assert!({let (x,y)=votes::counts(&registry,&community,&profiles,&post);x==0 && y==0} && posts::updated_at_ms(&post)==before,5);
    test_scenario::return_shared(registry);test_scenario::return_shared(post);test_scenario::return_shared(community);test_scenario::return_shared(profiles);sc.end();
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_community::community_votes)]
fun forged_profile_cannot_vote(){
    let(mut sc,alice,_bob,post_id)=setup();let profiles:ProfileRegistryV1=sc.take_shared();let community:CommunityRegistryV1=sc.take_shared();let post:PostV1=sc.take_shared_by_id(post_id);let mut registry:VoteRegistryV1=sc.take_shared();votes::set_vote(&mut registry,&community,&profiles,&post,alice,0,1,sc.ctx());test_scenario::return_shared(registry);test_scenario::return_shared(post);test_scenario::return_shared(community);test_scenario::return_shared(profiles);sc.end();
}
#[test]
fun comment_and_answer_acceptance_use_stable_profile(){
    let(mut sc,alice,bob,post_id)=setup();let profiles:ProfileRegistryV1=sc.take_shared();let community:CommunityRegistryV1=sc.take_shared();let mut post:PostV1=sc.take_shared_by_id(post_id);let clock=clock::create_for_testing(sc.ctx());
    let comment_id=posts::create_comment(&community,&profiles,&mut post,bob,object::id_from_address(@0x14),fixtures::h(7),fixtures::h(8),20,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(post);test_scenario::return_shared(community);test_scenario::return_shared(profiles);sc.next_tx(@0xa);
    let profiles:ProfileRegistryV1=sc.take_shared();let community:CommunityRegistryV1=sc.take_shared();let mut post:PostV1=sc.take_shared_by_id(post_id);let comment:CommentV1=sc.take_immutable_by_id(comment_id);
    posts::accept_answer(&community,&profiles,&mut post,&comment,alice,0,sc.ctx());assert!(posts::accepted_comment_id(&post)==option::some(comment_id),0);
    test_scenario::return_immutable(comment);test_scenario::return_shared(post);test_scenario::return_shared(community);test_scenario::return_shared(profiles);sc.end();
}
