#[test_only]
module soulidity_v1::release_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use sui::coin;
use walrus::system::System;
use walrus::blob::Blob;
use walrus::test_node::TestStorageNode;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::storage_fixture;
use soulidity_transport::storage_transport as storage;
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control,Version};
use soulidity_v1::catalog;
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_maker_manufacturing::maker_release::{Draft};
use soulidity_v1::release;
use soulidity_visual::visual;
use soulidity_model::policy;
use soulidity_application::publication_rules;
public struct PublishedShape has drop {product:ID,maker:Option<ID>,version:u64,policy_hash:vector<u8>}
public struct ExpectedShape has drop {asset:vector<u8>,bytes:u64}
#[test]
fun publication_single_serialization_preserves_hash_size_and_event(){
    let mut f=setup();let version=v(&f,false,0);let returned=catalog::publish(&mut f.p,&mut f.cap,0,version);
    let actual=catalog::published(&f.p,1);let preimage=catalog::publication_preimage_for_testing(*actual);let hash=policy::hash_bytes(preimage);
    assert!(returned==hash && catalog::policy_hash(actual)==hash && std::bcs::to_bytes(actual).length()==preimage.length()+32,500);
    let events=sui::event::events_by_type<soulidity_maker_manufacturing::maker_catalog::Published>();assert!(events.length()==1,501);
    assert!(std::bcs::to_bytes(&events[0])==std::bcs::to_bytes(&PublishedShape{product:object::id(&f.p),maker:option::none(),version:1,policy_hash:hash}),502);end(f)
}
fun prefix_digest(i:u64):vector<u8>{let mut digest=vector::tabulate!(32,|_|170u8);*digest.borrow_mut(30)=(i/256) as u8;*digest.borrow_mut(31)=(i%256) as u8;digest}
fun projection_definition(start:u64,end:u64,reverse:bool):policy::Definition{
    let mut fragments=vector[];let mut i=start;
    while(i < end){fragments.push_back(visual::fragment(std::bcs::to_bytes(&i),prefix_digest(i),b"image/png",1024,1,1,0,0,1,1,0,0,b"main",i,b"root",visual::transform(visual::signed(false,0),visual::signed(false,0),1000000,visual::signed(false,0)),1000000,0,option::none(),option::none(),option::none(),vector[]));i=i+1};
    if(reverse)fragments.reverse();policy::definition(b"free",b"projection",std::bcs::to_bytes(&start),0,fixtures::h(11),fixtures::h(12),visual::representation(&fixtures::scene(),1024,1024,fragments,vector[]),10,fixtures::layout(),policy::bounds(0,0,1000000,1000000,0,vector[]),vector[],vector[],true)
}
#[test]
fun digest_directory_handles_five_hundred_shared_prefixes_in_reverse_order(){
    let defs=vector[projection_definition(250,500,true),projection_definition(0,250,true)];let (rows,invalid)=publication_rules::expected_assets(&defs);assert!(invalid==0 && rows.length()==500,510);
    let mut i=0;while(i < 500){let digest=prefix_digest(i);assert!(publication_rules::expected_digest(&rows[i])==digest && publication_rules::expected_size(&rows[i])==1024 && publication_rules::expected_lookup(&rows,digest)==option::some(1024),511);i=i+1};
    assert!(publication_rules::expected_lookup(&rows,prefix_digest(500)).is_none(),512);
    assert!(std::bcs::to_bytes(&rows[0])==std::bcs::to_bytes(&ExpectedShape{asset:prefix_digest(0),bytes:1024}),513)
}
#[test]
fun digest_directory_deduplicates_consistent_lengths_without_mutating_source(){
    let defs=vector[projection_definition(0,250,true),projection_definition(0,250,false)];let original=std::bcs::to_bytes(&defs);let (rows,invalid)=publication_rules::expected_assets(&defs);
    assert!(invalid==0 && rows.length()==250 && std::bcs::to_bytes(&defs)==original,520)
}
#[test]
fun digest_directory_refuses_over_five_hundred_unique_assets(){
    let (rows,invalid)=publication_rules::expected_assets(&vector[projection_definition(0,250,false),projection_definition(250,500,false),projection_definition(500,501,false)]);
    assert!(invalid==6 && rows.is_empty(),530)
}
public struct F {out:soulidity_maker_publication::output_data::Policy,sc:Scenario,cfg:Config<USD>,p:Product<USD>,cap:Control,sys:System,nodes:vector<TestStorageNode>,clock:Clock}
fun setup():F{
    let mut sc=test_scenario::begin(@0xa);let(nodes,clock)=storage_fixture::bootstrap(&mut sc);economics::init_for_testing(sc.ctx());kind_registry::init_for_testing(sc.ctx());sc.next_tx(@0xa);
    let auth:Authority=sc.take_from_sender();soulidity_v1::native_binding::create_enabled_for_testing<USD>(&auth,1000,500,0,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xa);
    let mut cfg:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let sys:System=sc.take_shared();let h=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut a,0,h,false);let h=economics::commitment(&cfg);release::install(&mut cfg,&mut a,&sys,fixtures::h(80),fixtures::h(81),1,h,sc.ctx());let h=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut a,2,h,true);catalog::create_maker(&cfg,0,sc.ctx());test_scenario::return_shared(cfg);test_scenario::return_shared(sys);sc.return_to_sender(a);sc.next_tx(@0xa);
    let registry:KindRegistry=sc.take_shared();let out=fixtures::default_output(&registry,false,true,vector[]);test_scenario::return_shared(registry);
    F{out,cfg:sc.take_shared(),p:sc.take_shared(),cap:sc.take_from_sender(),sys:sc.take_shared(),sc,nodes,clock}
}
fun v(f:&F,extra:bool,price:u64):Version{
    let mut defs=vector[fixtures::def(b"free",2,10)];let mut parts=vector[b"free"];
    if(extra){let fragment=visual::fragment(b"image",fixtures::h(13),b"image/png",1024,1024,1024,0,0,1024,1024,512000,512000,b"main",0,b"root",visual::transform(visual::signed(false,0),visual::signed(false,0),1000000,visual::signed(false,0)),1000000,0,option::none(),option::none(),option::none(),vector[]);let r=visual::representation(&fixtures::scene(),1024,1024,vector[fragment],vector[]);defs.push_back(policy::definition(b"ref",b"other",b"style",0,fixtures::h(13),fixtures::h(12),r,10,fixtures::layout(),policy::bounds(0,0,1000000,1000000,0,vector[]),vector[],vector[],true));parts.push_back(b"ref")};
    let output=f.out;
    catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),if(price>0)1 else 0,price,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),parts,vector[],defs,vector[],fixtures::scene()),vector[output])
}
fun invalid_financial_domain_at_begin(field:u8){
    let mut f=setup();let mut version=v(&f,false,0);catalog::invalid_financial_domain_for_testing(&mut version,field);
    let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());
    let d={let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::begin(p,cap,cfg,0,version,release::author(b"Creator",vector[],vector[],b"license",fixtures::h(3)),living,manifest,sys,sc.ctx())};release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)
}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_access_price(){invalid_financial_domain_at_begin(0)}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_complete_price(){invalid_financial_domain_at_begin(1)}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_quota(){invalid_financial_domain_at_begin(2)}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_cap(){invalid_financial_domain_at_begin(3)}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_royalty_bound(){invalid_financial_domain_at_begin(4)}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_royalty_step(){invalid_financial_domain_at_begin(5)}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_oc_step(){invalid_financial_domain_at_begin(6)}
#[test,expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun financial_domain_begin_maker_step(){invalid_financial_domain_at_begin(7)}
fun begin(f:&mut F,extra:bool,price:u64):Draft{
    let v=v(f,extra,price);let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());let version=catalog::current_version(&f.p);
    release::begin(&f.p,&mut f.cap,&f.cfg,version,v,release::author(b"Creator",b"Info",b"https://example.test",b"Creator license",fixtures::h(3)),living,manifest,&f.sys,f.sc.ctx())
}
fun append(f:&mut F,d:&mut Draft,asset:u8,protected:bool,revision:u64):ID{
    let blob=storage_fixture::blob(&mut f.sys,(200+asset) as u256,false,true,f.sc.ctx());let id=object::id(&blob);release::append(d,&f.p,&mut f.cap,&f.cfg,fixtures::h(asset),protected,fixtures::h(if(protected)30 else asset),blob,&f.sys,revision,f.sc.ctx());id
}
fun finish(f:&mut F,d:Draft):ID{let rev=release::revision(&d);release::finish(d,&mut f.p,&mut f.cap,&f.cfg,&f.sys,rev,f.sc.ctx())}
fun end(f:F){let F{out:_,sc,cfg,p,cap,sys,nodes,clock}=f;test_scenario::return_shared(cfg);test_scenario::return_shared(p);test_scenario::return_shared(sys);sc.return_to_sender(cap);nodes.do!(|n|n.destroy());clock::destroy_for_testing(clock);sc.end();}
fun advance(f:F):F{let F{out,mut sc,cfg,p,cap,sys,nodes,clock}=f;test_scenario::return_shared(cfg);test_scenario::return_shared(p);test_scenario::return_shared(sys);sc.return_to_sender(cap);sc.next_tx(@0xa);let cfg:Config<USD> = sc.take_shared();let p:Product<USD> = sc.take_shared();let sys:System=sc.take_shared();let cap:Control=sc.take_from_sender();F{out,sc,cfg,p,sys,cap,nodes,clock}}
fun large_asset(index:u64):vector<u8>{policy::hash_bytes(std::bcs::to_bytes(&index))}
fun large_begin(f:&mut F):Draft{
    let scene=fixtures::scene();let mut definitions=vector[];let mut start=0u64;while(start < 500){let mut fragments=vector[];let mut i=start;while(i < start+250){fragments.push_back(visual::fragment(std::bcs::to_bytes(&i),large_asset(i),b"image/png",1024,1,1,0,0,1,1,0,0,b"main",i,b"root",visual::transform(visual::signed(false,0),visual::signed(false,0),1000000,visual::signed(false,0)),1000000,0,option::none(),option::none(),option::none(),vector[]));i=i+1};let representation=visual::representation(&scene,1024,1024,fragments,vector[]);definitions.push_back(policy::definition(b"free",b"many",std::bcs::to_bytes(&start),2,fixtures::h(11),fixtures::h(12),representation,10,fixtures::layout(),policy::bounds(0,0,1000000,1000000,0,vector[]),vector[],vector[],true));start=start+250};
    let version=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[],definitions,vector[],scene),vector[f.out]);let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());release::begin(&f.p,&mut f.cap,&f.cfg,0,version,release::author(b"Creator",vector[],vector[],b"license",fixtures::h(3)),living,manifest,&f.sys,f.sc.ctx())
}
#[test]
fun five_hundred_real_assets_publish_in_chunks_with_constant_finish_custody(){
    let mut f=setup();let d=large_begin(&mut f);let draft=object::id(&d);assert!(release::expected_count(&d)==500,0);release::deliver(d,f.sc.ctx());let mut next=0u64;let mut original_ids=vector[];
    while(next < 500){f=advance(f);let mut d:Draft=f.sc.take_from_sender_by_id(draft);let first=next;let end=if(next+32>500)500 else next+32;let mut assets=vector[];let mut protected=vector[];let mut hashes=vector[];let mut blobs=vector[];while(next < end){let asset=large_asset(next);let blob=storage_fixture::blob(&mut f.sys,(1000+next) as u256,false,true,f.sc.ctx());original_ids.push_back(object::id(&blob));assets.push_back(asset);protected.push_back(false);hashes.push_back(asset);blobs.push_back(blob);next=next+1};{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,p,cap,cfg,assets,protected,hashes,blobs,sys,first,sc.ctx())};release::deliver(d,f.sc.ctx())};
    f=advance(f);let d:Draft=f.sc.take_from_sender_by_id(draft);finish(&mut f,d);let c=release::certificate(&f.p,1);assert!(release::certificate_rows(c)==500,1);let mut i=0;while(i < 500){assert!(storage::object_id(release::asset_reference(release::certificate_asset(c,i)))==original_ids[i],2);i=i+1};release::assert_current(&f.p,&f.cfg,1,&f.sys);end(f)
}
#[test]
fun five_hundred_asset_preflight_keeps_sorted_unique_digest_directory(){
    let mut f=setup();let d=large_begin(&mut f);assert!(release::expected_count(&d)==500,0);
    let mut i=0u64;while(i < 500){
        assert!(release::expected_bytes(&d,large_asset(i))==1024,1);
        if(i>0){let a=release::expected_asset(&d,i-1);let b=release::expected_asset(&d,i);let mut j=0;while(j < 32 && a[j]==b[j])j=j+1;assert!(j < 32 && a[j] < b[j],2)};
        i=i+1
    };
    let blobs=release::cancel(d,f.sc.ctx());assert!(blobs.length()==2 && catalog::current_version(&f.p)==0,3);blobs.do!(|b|transfer::public_transfer(b,@0xa));end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_release)]
fun shared_digest_with_conflicting_declared_byte_lengths_is_rejected(){
    let mut f=setup();let scene=fixtures::scene();
    let fragment=visual::fragment(b"second",fixtures::h(11),b"image/png",512,1,1,0,0,1,1,0,0,b"main",0,b"root",visual::transform(visual::signed(false,0),visual::signed(false,0),1000000,visual::signed(false,0)),1000000,0,option::none(),option::none(),option::none(),vector[]);
    let r=visual::representation(&scene,1024,1024,vector[fragment],vector[]);
    let second=policy::definition(b"free",b"second",b"style",0,fixtures::h(11),fixtures::h(12),r,10,fixtures::layout(),policy::bounds(0,0,1000000,1000000,0,vector[]),vector[],vector[],true);
    let version=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[],vector[fixtures::def(b"free",2,10),second],vector[],scene),vector[f.out]);
    let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());
    let d={let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::begin(p,cap,cfg,0,version,release::author(b"Creator",vector[],vector[],b"license",fixtures::h(3)),living,manifest,sys,sc.ctx())};
    release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)
}
#[test,expected_failure(abort_code=5,location=soulidity_maker_manufacturing::maker_release)]
fun partially_returned_draft_cannot_publish(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,true,0);let blobs=release::cancel_chunk(&mut d,1,1,f.sc.ctx());blobs.do!(|b|transfer::public_transfer(b,@0xa));finish(&mut f,d);end(f)}
#[test]
fun cancellation_chunks_return_original_assets_and_clean_remaining_custody(){
    let mut f=setup();let mut d=large_begin(&mut f);let draft=object::id(&d);let mut ids=vector[];let mut i=0u64;while(i < 33){let asset=large_asset(i);let blob=storage_fixture::blob(&mut f.sys,(1000+i) as u256,false,true,f.sc.ctx());ids.push_back(object::id(&blob));{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append(&mut d,p,cap,cfg,asset,false,large_asset(i),blob,sys,i,sc.ctx())};i=i+1};
    let returned=release::cancel_chunk(&mut d,32,33,f.sc.ctx());assert!(returned.length()==32,0);returned.do!(|b|transfer::public_transfer(b,@0xa));release::deliver(d,f.sc.ctx());f=advance(f);let d:Draft=f.sc.take_from_sender_by_id(draft);let rest=release::cancel(d,f.sc.ctx());assert!(rest.length()==3 && rest.any!(|b|object::id(b)==ids[32]),1);rest.do!(|b|transfer::public_transfer(b,@0xa));f=advance(f);let held=f.sc.ids_for_sender<Blob>();assert!(held.length()==35 && ids.all!(|id|held.contains(id)) && catalog::current_version(&f.p)==0,2);end(f)
}
#[test]
fun actual_chunked_draft_certifies_assets_and_preserves_exact_blob_ids(){
    let mut f=setup();let mut d=begin(&mut f,true,0);let draft=object::id(&d);let one=append(&mut f,&mut d,11,false,0);assert!(release::expected_count(&d)==2 && release::asset_count(&d)==1,0);release::deliver(d,f.sc.ctx());
    let F{out,mut sc,cfg,p,cap,sys,nodes,clock}=f;test_scenario::return_shared(cfg);test_scenario::return_shared(p);test_scenario::return_shared(sys);sc.return_to_sender(cap);sc.next_tx(@0xa);let cfg:Config<USD> = sc.take_shared();let p:Product<USD> = sc.take_shared();let sys:System=sc.take_shared();let cap:Control=sc.take_from_sender();let mut f=F{out,sc,cfg,p,sys,cap,nodes,clock};
    let mut d:Draft=f.sc.take_from_sender_by_id(draft);let two=append(&mut f,&mut d,13,true,1);let certificate=finish(&mut f,d);let c=release::certificate(&f.p,1);assert!(certificate==object::id(c) && certificate!=draft && release::certificate_rows(c)==2 && storage::object_id(release::asset_reference(release::certificate_asset(c,0)))==one && storage::object_id(release::asset_reference(release::certificate_asset(c,1)))==two,1);assert!(release::author_name(release::certificate_author(c))==b"Creator",2);release::assert_current(&f.p,&f.cfg,1,&f.sys);
    let scope=release::asset_scope(release::certificate_asset(c,1));release::seal_approve(scope,&f.p,&f.cfg,1,&f.sys,&f.clock,f.sc.ctx());end(f)
}
#[test]
fun canceled_chunked_draft_returns_all_original_blobs_and_keeps_product_draft(){let mut f=setup();let mut d=begin(&mut f,false,0);let asset=append(&mut f,&mut d,11,false,0);let blobs=release::cancel(d,f.sc.ctx());assert!(blobs.length()==3 && blobs.any!(|b|object::id(b)==asset) && catalog::current_version(&f.p)==0,0);blobs.do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=5,location=soulidity_maker_manufacturing::maker_release)]
fun incomplete_asset_manifest_cannot_publish(){let mut f=setup();let d=begin(&mut f,false,0);finish(&mut f,d);end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_release)]
fun plaintext_blob_must_match_declared_asset_digest(){let mut f=setup();let mut d=begin(&mut f,false,0);let blob=storage_fixture::blob(&mut f.sys,200,false,true,f.sc.ctx());{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append(&mut d,p,cap,cfg,fixtures::h(11),false,fixtures::h(99),blob,sys,0,sc.ctx())};release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun uncertified_actual_asset_cannot_append(){let mut f=setup();let mut d=begin(&mut f,false,0);let blob=storage_fixture::blob(&mut f.sys,200,false,false,f.sc.ctx());{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append(&mut d,p,cap,cfg,fixtures::h(11),false,fixtures::h(11),blob,sys,0,sc.ctx())};release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun deletable_actual_asset_cannot_append(){let mut f=setup();let mut d=begin(&mut f,false,0);let blob=storage_fixture::blob(&mut f.sys,200,true,true,f.sc.ctx());{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append(&mut d,p,cap,cfg,fixtures::h(11),false,fixtures::h(11),blob,sys,0,sc.ctx())};release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_release)]
fun duplicate_actual_asset_cannot_append_twice(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,false,0);append(&mut f,&mut d,11,false,1);release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_release)]
fun stale_chunk_revision_cannot_append(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,false,1);release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_release)]
fun competing_draft_cannot_replay_after_other_actual_publication(){let mut f=setup();let mut first=begin(&mut f,false,0);let mut second=begin(&mut f,false,0);append(&mut f,&mut first,11,false,0);append(&mut f,&mut second,11,false,0);finish(&mut f,first);finish(&mut f,second);end(f)}
#[test,expected_failure(abort_code=7,location=soulidity_maker_manufacturing::maker_release)]
fun seal_scope_rejects_wrong_asset(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,true,0);finish(&mut f,d);release::seal_approve(release::seal_scope(object::id(&f.cfg),object::id(&f.p),1,fixtures::h(99)),&f.p,&f.cfg,1,&f.sys,&f.clock,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=7,location=soulidity_maker_manufacturing::maker_release)]
fun plaintext_asset_has_no_seal_decryption_scope(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,false,0);finish(&mut f,d);release::seal_approve(release::seal_scope(object::id(&f.cfg),object::id(&f.p),1,fixtures::h(11)),&f.p,&f.cfg,1,&f.sys,&f.clock,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun paid_content_approval_requires_actual_actor_entitlement(){let mut f=setup();let mut d=begin(&mut f,false,15);append(&mut f,&mut d,11,true,0);finish(&mut f,d);release::seal_approve(release::seal_scope(object::id(&f.cfg),object::id(&f.p),1,fixtures::h(11)),&f.p,&f.cfg,1,&f.sys,&f.clock,f.sc.ctx());end(f)}
#[test]
fun actual_paid_access_settles_before_seal_approval(){let mut f=setup();let mut d=begin(&mut f,false,15);append(&mut f,&mut d,11,true,0);finish(&mut f,d);let hash=catalog::policy_hash(catalog::published(&f.p,1));let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let payment=coin::mint_for_testing<USD>(15,f.sc.ctx());{let F{out:_,sc,p,cfg,clock,cap:_,sys:_,nodes:_}=&mut f;catalog::buy_access_for_testing(p,cfg,1,hash,rev,expiry,fixtures::h(90),payment,clock,sc.ctx())};release::seal_approve(release::seal_scope(object::id(&f.cfg),object::id(&f.p),1,fixtures::h(11)),&f.p,&f.cfg,1,&f.sys,&f.clock,f.sc.ctx());assert!(soulidity_foundation::revenue::balance(catalog::income(&f.p))==14 && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==1,0);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun finished_certificate_does_not_hide_real_walrus_expiry(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,true,0);finish(&mut f,d);let mut n=0u64;while(n < 3){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1};release::assert_current(&f.p,&f.cfg,1,&f.sys);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun enabled_protocol_cannot_replace_publication_catalog(){let mut f=setup();let mut admin:Admin=f.sc.take_from_sender();let rev=economics::revision(&f.cfg);let hash=economics::commitment(&f.cfg);{let F{out:_,sc,cfg,sys,p:_,cap:_,nodes:_,clock:_}=&mut f;release::install(cfg,&mut admin,sys,fixtures::h(82),fixtures::h(83),rev,hash,sc.ctx())};f.sc.return_to_sender(admin);end(f)}
#[test]
fun disabled_catalog_replacement_preserves_old_certificate_and_real_funds(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,true,0);let cert=finish(&mut f,d);economics::deposit_income(&mut f.cfg,coin::mint_for_testing<USD>(7,f.sc.ctx()));let old=object::id(release::current(&f.cfg));let oldhash=release::catalog_hash(release::current(&f.cfg));let mut admin:Admin=f.sc.take_from_sender();let rev=economics::revision(&f.cfg);let hash=economics::commitment(&f.cfg);economics::set_enabled(&mut f.cfg,&mut admin,rev,hash,false);let rev=economics::revision(&f.cfg);let hash=economics::commitment(&f.cfg);let new={let F{out:_,sc,cfg,sys,p:_,cap:_,nodes:_,clock:_}=&mut f;release::install(cfg,&mut admin,sys,fixtures::h(82),fixtures::h(83),rev,hash,sc.ctx())};assert!(new!=old && object::id(release::historical(&f.cfg,0))==old && release::catalog_hash(release::historical(&f.cfg,0))==oldhash && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==7,0);let rev=economics::revision(&f.cfg);let hash=economics::commitment(&f.cfg);economics::set_enabled(&mut f.cfg,&mut admin,rev,hash,true);release::assert_current(&f.p,&f.cfg,1,&f.sys);assert!(object::id(release::certificate(&f.p,1))==cert,1);f.sc.return_to_sender(admin);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_maker_manufacturing::maker_release)]
fun changed_protocol_snapshot_invalidates_pending_draft(){let mut f=setup();let mut d=begin(&mut f,false,0);let mut admin:Admin=f.sc.take_from_sender();let rev=economics::revision(&f.cfg);economics::configure(&mut f.cfg,&mut admin,rev,500,500,0,@0xf,false);f.sc.return_to_sender(admin);append(&mut f,&mut d,11,false,0);release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_maker_manufacturing::maker_catalog)]
fun different_actual_control_cannot_publish_pending_draft(){let mut f=setup();let mut d=begin(&mut f,false,0);catalog::create_maker(&f.cfg,0,f.sc.ctx());let F{out,mut sc,cfg,p,cap,sys,nodes,clock}=f;let original=object::id(&p);let cap_id=object::id(&cap);test_scenario::return_shared(p);test_scenario::return_shared(cfg);test_scenario::return_shared(sys);sc.return_to_sender(cap);sc.next_tx(@0xa);let p:Product<USD> = sc.take_shared_by_id(original);let other=sc.ids_for_sender<Control>().filter!(|id|*id!=cap_id)[0];let cfg:Config<USD> = sc.take_shared();let sys:System=sc.take_shared();let cap:Control=sc.take_from_sender_by_id(other);let mut f=F{out,sc,cfg,p,cap,sys,nodes,clock};append(&mut f,&mut d,11,false,0);release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test]
fun same_asset_across_styles_has_one_actual_certified_row(){let mut f=setup();let base=v(&f,false,0);let out=f.out;let version=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free",b"ref"],vector[],vector[fixtures::def(b"free",2,10),fixtures::def(b"ref",0,10)],vector[],*catalog::scene(&base)),vector[out]);let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());let mut d={let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::begin(p,cap,cfg,0,version,release::author(b"Creator",vector[],vector[],b"license",fixtures::h(3)),living,manifest,sys,sc.ctx())};assert!(release::expected_count(&d)==1,0);append(&mut f,&mut d,11,false,0);finish(&mut f,d);assert!(catalog::definitions(catalog::published(&f.p,1)).length()==2 && release::certificate_rows(release::certificate(&f.p,1))==1,1);end(f)}
#[test]
fun renewal_preserves_original_blob_and_certificate_commitments(){let mut f=setup();let mut d=begin(&mut f,false,0);let blob_id=append(&mut f,&mut d,11,true,0);finish(&mut f,d);let cert=release::certificate(&f.p,1);let before=release::certificate_hash(cert);let mut payment=coin::mint_for_testing<wal::wal::WAL>(1000000000,f.sc.ctx());let amount=walrus::encoding::encoded_blob_length(1024,1,walrus::system::n_shards(&f.sys));let extension=walrus::system::reserve_space_for_epochs(&mut f.sys,amount,4,6,&mut payment,f.sc.ctx());coin::burn_for_testing(payment);{let F{out:_,cfg,p,cap,sys,sc:_,nodes:_,clock:_}=&mut f;release::extend_blob(p,cap,cfg,1,2,0,extension,sys)};let cert=release::certificate(&f.p,1);assert!(storage::object_id(release::asset_reference(release::certificate_asset(cert,0)))==blob_id && release::certificate_hash(cert)==before && storage::original_end_epoch(release::asset_reference(release::certificate_asset(cert,0)))==4,0);release::assert_current(&f.p,&f.cfg,1,&f.sys);end(f)}

fun lease_epochs(f:&mut F,n:u64){let mut i=0;while(i < n){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);i=i+1}}
fun lease_publish(f:&mut F):ID{let mut d=begin(f,false,0);let image=append(f,&mut d,11,true,0);finish(f,d);image}
fun lease_renew(f:&mut F,kind:u8,start:u32,until:u32){
    let mut payment=coin::mint_for_testing<wal::wal::WAL>(1000000000,f.sc.ctx());
    let amount=walrus::encoding::encoded_blob_length(1024,1,walrus::system::n_shards(&f.sys));
    let extension=walrus::system::reserve_space_for_epochs(&mut f.sys,amount,start,until,&mut payment,f.sc.ctx());coin::burn_for_testing(payment);
    let F{out:_,cfg,p,cap,sys,sc:_,nodes:_,clock:_}=f;release::extend_blob(p,cap,cfg,1,kind,0,extension,sys)
}
fun lease_renew_all(f:&mut F){lease_renew(f,0,4,6);lease_renew(f,1,4,6);lease_renew(f,2,4,6)}
#[test,expected_failure(abort_code=2,location=walrus::blob)]
fun lease_renewal_at_exclusive_end_epoch_is_rejected(){let mut f=setup();lease_publish(&mut f);lease_epochs(&mut f,3);assert!(walrus::system::epoch(&f.sys)==4,0);lease_renew(&mut f,2,4,6);end(f)}
#[test,expected_failure(abort_code=2,location=walrus::blob)]
fun lease_renewal_after_exclusive_end_epoch_is_rejected(){let mut f=setup();lease_publish(&mut f);lease_epochs(&mut f,4);assert!(walrus::system::epoch(&f.sys)==5,0);lease_renew(&mut f,2,4,6);end(f)}
#[test]
fun lease_all_live_blobs_renewed_before_end_remain_valid_after_snapshot_end(){
    let mut f=setup();let image=lease_publish(&mut f);let hash=release::certificate_hash(release::certificate(&f.p,1));let policy=catalog::policy_hash(catalog::published(&f.p,1));
    lease_epochs(&mut f,2);assert!(walrus::system::epoch(&f.sys)==3,0);lease_renew_all(&mut f);lease_epochs(&mut f,1);release::assert_current(&f.p,&f.cfg,1,&f.sys);
    let cert=release::certificate(&f.p,1);let reference=release::asset_reference(release::certificate_asset(cert,0));assert!(storage::object_id(reference)==image && storage::original_end_epoch(reference)==4 && release::certificate_hash(cert)==hash && catalog::policy_hash(catalog::published(&f.p,1))==policy,1);end(f)
}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun lease_renewed_certificate_expires_at_new_end(){let mut f=setup();lease_publish(&mut f);lease_renew_all(&mut f);lease_epochs(&mut f,5);assert!(walrus::system::epoch(&f.sys)==6,0);release::assert_current(&f.p,&f.cfg,1,&f.sys);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun lease_renewing_image_alone_cannot_hide_expired_documents(){let mut f=setup();lease_publish(&mut f);lease_renew(&mut f,2,4,6);lease_epochs(&mut f,3);release::assert_current(&f.p,&f.cfg,1,&f.sys);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun lease_renewing_documents_alone_cannot_hide_expired_image(){let mut f=setup();lease_publish(&mut f);lease_renew(&mut f,0,4,6);lease_renew(&mut f,1,4,6);lease_epochs(&mut f,3);release::assert_current(&f.p,&f.cfg,1,&f.sys);end(f)}
#[test]
fun lease_expired_draft_cancel_keeps_original_asset_ids(){let mut f=setup();let mut d=begin(&mut f,false,0);let image=append(&mut f,&mut d,11,true,0);lease_epochs(&mut f,3);let returned=release::cancel(d,f.sc.ctx());assert!(returned.length()==3 && returned.any!(|b|object::id(b)==image) && catalog::current_version(&f.p)==0,0);returned.do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun lease_expired_draft_cannot_finish(){let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,true,0);lease_epochs(&mut f,3);finish(&mut f,d);end(f)}
#[test]
fun actual_pack_publication_and_free_scope_use_same_parent_authority(){
    let mut f=setup();let mut d=begin(&mut f,false,0);append(&mut f,&mut d,11,true,0);finish(&mut f,d);let maker=object::id(&f.p);let pack={let F{out:_,p,cap,cfg,sc,sys:_,nodes:_,clock:_}=&mut f;catalog::create_pack_for_testing(p,1,cap,cfg,0,sc.ctx())};
    let F{out:_,mut sc,cfg,p,cap,sys,nodes,clock}=f;test_scenario::return_shared(cfg);test_scenario::return_shared(p);test_scenario::return_shared(sys);sc.return_to_sender(cap);sc.next_tx(@0xa);let cfg:Config<USD> = sc.take_shared();let mut sys:System=sc.take_shared();let maker:Product<USD> = sc.take_shared_by_id(maker);let mut pack:Product<USD> = sc.take_shared_by_id(pack);let mut cap=soulidity_v1::pack_publication_tests::control(&sc,object::id(&pack));
    let v=catalog::with_pack_key(catalog::version(fixtures::h(5),fixtures::h(6),0,0,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[],vector[fixtures::pack_def(b"free",1,10)],vector[],fixtures::scene()),b"pack");let living=storage_fixture::blob(&mut sys,500,false,true,sc.ctx());let manifest=storage_fixture::blob(&mut sys,501,false,true,sc.ctx());let mut d=release::begin(&pack,&mut cap,&cfg,0,v,release::author(b"Pack author",vector[],vector[],b"Pack license",fixtures::h(7)),living,manifest,&sys,sc.ctx());let blob=storage_fixture::blob(&mut sys,502,false,true,sc.ctx());release::append(&mut d,&pack,&mut cap,&cfg,fixtures::h(11),true,fixtures::h(30),blob,&sys,0,sc.ctx());release::finish(d,&mut pack,&mut cap,&cfg,&sys,1,sc.ctx());release::seal_approve_pack(release::seal_scope(object::id(&cfg),object::id(&pack),1,fixtures::h(11)),&pack,&maker,&cfg,1,&sys,&clock,sc.ctx());assert!(catalog::publication_parent(&catalog::publication(catalog::published(&pack,1)).destroy_some())==option::some(object::id(&maker)),0);test_scenario::return_shared(cfg);test_scenario::return_shared(maker);test_scenario::return_shared(pack);test_scenario::return_shared(sys);sc.return_to_sender(cap);nodes.do!(|n|n.destroy());clock::destroy_for_testing(clock);sc.end();
}

// The large aggregate test simulates 500 actual Blobs across many next_tx calls.
// Sui shares one computation meter across those calls. Run with the documented
// aggregate ceiling; production per-PTB budgets require separate acceptance.
fun batch_vectors(f:&mut F,n:u64):(vector<vector<u8>>,vector<bool>,vector<vector<u8>>,vector<Blob>,vector<ID>){let mut assets=vector[];let mut protected=vector[];let mut hashes=vector[];let mut blobs=vector[];let mut ids=vector[];let mut i=0;while(i < n){let asset=large_asset(i);let blob=storage_fixture::blob(&mut f.sys,(1000+i) as u256,false,true,f.sc.ctx());ids.push_back(object::id(&blob));assets.push_back(asset);protected.push_back(false);hashes.push_back(asset);blobs.push_back(blob);i=i+1};(assets,protected,hashes,blobs,ids)}
#[test]
fun thirty_two_actual_blobs_batch_preserves_order_and_returns_every_original(){let mut f=setup();let mut d=large_begin(&mut f);let(a,p,h,b,ids)=batch_vectors(&mut f,32);{let F{out:_,sc,p:product,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,product,cap,cfg,a,p,h,b,sys,0,sc.ctx())};assert!(release::revision(&d)==32 && release::asset_count(&d)==32,0);let returned=release::cancel_chunk(&mut d,32,32,f.sc.ctx());assert!(returned.length()==32,1);let mut i=0;while(i < 32){assert!(object::id(&returned[i])==ids[i],2);i=i+1};returned.do!(|b|transfer::public_transfer(b,@0xa));let docs=release::cancel(d,f.sc.ctx());assert!(docs.length()==2,3);docs.do!(|b|transfer::public_transfer(b,@0xa));f=advance(f);assert!(f.sc.ids_for_sender<Blob>().length()==34,4);end(f)}
#[test,expected_failure(abort_code=6,location=soulidity_maker_manufacturing::maker_release)]
fun batch_over_thirty_two_is_rejected(){let mut f=setup();let mut d=large_begin(&mut f);let(a,p,h,b,_)=batch_vectors(&mut f,33);{let F{out:_,sc,p:product,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,product,cap,cfg,a,p,h,b,sys,0,sc.ctx())};finish(&mut f,d);end(f)}
#[test,expected_failure(abort_code=6,location=soulidity_maker_manufacturing::maker_release)]
fun batch_mismatched_metadata_is_rejected(){let mut f=setup();let mut d=large_begin(&mut f);let(a,_,h,b,_)=batch_vectors(&mut f,1);{let F{out:_,sc,p:product,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,product,cap,cfg,a,vector[],h,b,sys,0,sc.ctx())};finish(&mut f,d);end(f)}
#[test,expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_release)]
fun batch_stale_cas_is_rejected(){let mut f=setup();let mut d=large_begin(&mut f);let(a,p,h,b,_)=batch_vectors(&mut f,1);{let F{out:_,sc,p:product,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,product,cap,cfg,a,p,h,b,sys,1,sc.ctx())};finish(&mut f,d);end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_release)]
fun batch_duplicate_actual_asset_is_rejected(){let mut f=setup();let mut d=begin(&mut f,false,0);let b1=storage_fixture::blob(&mut f.sys,900,false,true,f.sc.ctx());let b2=storage_fixture::blob(&mut f.sys,901,false,true,f.sc.ctx());{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,p,cap,cfg,vector[fixtures::h(11),fixtures::h(11)],vector[false,false],vector[fixtures::h(11),fixtures::h(11)],vector[b1,b2],sys,0,sc.ctx())};finish(&mut f,d);end(f)}

fun runtime_ready(f:&mut F,price:u64){let mut d=begin(f,false,price);append(f,&mut d,11,true,0);finish(f,d);}
fun runtime_player(f:&mut F):ID{let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let F{out:_,sc,cfg,p,sys,clock,cap:_,nodes:_}=f;soulidity_v1::runtime::create_player(p,cfg,1,rev,expiry,fixtures::h(92),clock,sys,sc.ctx())}
fun runtime_finish(f:&mut F,mut b:soulidity_v1::runtime::Build):ID{let registry:KindRegistry=f.sc.take_shared();let rules=soulidity_application::output::initials(soulidity_v1::runtime::output_policy(&b));rules.do_ref!(|r|{let kind=soulidity_application::output::rule_kind(r);let blob=storage_fixture::blob(&mut f.sys,(3000+kind) as u256,false,true,f.sc.ctx());soulidity_v1::runtime::append_initial_content(&mut b,&registry,kind,soulidity_application::output::rule_name(r),blob,&f.sys,fixtures::h((50+kind) as u8),b"encrypted-envelope",&f.clock,f.sc.ctx());});test_scenario::return_shared(registry);let render=storage_fixture::blob(&mut f.sys,4000,false,true,f.sc.ctx());soulidity_v1::runtime::finish(b,render,&f.sys,fixtures::h(60),vector[],f.sc.ctx())}
fun runtime_complete(f:&mut F,p:&soulidity_maker_manufacturing::maker_player::Player):ID{let intent=fixtures::default_intent(&f.p,93,soulidity_v1::player::semantic_recipe_hash(p),f.sc.sender());let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let payment=coin::zero<USD>(f.sc.ctx());let mut b={let F{out:_,sc,cfg,p:maker,sys,clock,cap:_,nodes:_}=f;soulidity_v1::runtime::begin(maker,cfg,intent,b"default",rev,expiry,payment,clock,sys,sc.ctx())};{let F{out:_,sc,cfg,p:maker,sys,clock:_,cap:_,nodes:_}=f;soulidity_v1::runtime::select_player(&mut b,maker,p,b"free",soulidity_v1::player::revision(p),cfg,sys,sc.ctx())};runtime_finish(f,b)}
fun runtime_choose(f:&mut F,p:&mut soulidity_maker_manufacturing::maker_player::Player){let expiry=clock::timestamp_ms(&f.clock)+1000;soulidity_v1::runtime::set_base(p,&f.p,&f.cfg,policy::definition_hash(&fixtures::def(b"free",2,10)),fixtures::layout(),0,economics::revision(&f.cfg),expiry,&f.clock,&f.sys,f.sc.ctx())}
#[test]
fun runtime_actual_certified_player_complete_preserves_fixed_style_and_free_object(){let mut f=setup();runtime_ready(&mut f,0);f=advance(f);let player_id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(player_id);runtime_choose(&mut f,&mut p);let selected=soulidity_v1::player::selection(&p,b"free").destroy_some();let id=runtime_complete(&mut f,&p);soulidity_v1::player::close(p,1,f.sc.ctx());f=advance(f);let s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(id);let binding=soulidity_application::character::binding(&s,b"free").destroy_some();assert!(soulidity_application::character::binding_source(&binding)==soulidity_v1::player::source(&selected) && soulidity_application::character::free_id(&binding).is_some(),0);transfer::public_transfer(s,@0xa);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun runtime_expired_actual_maker_cannot_create_player(){let mut f=setup();runtime_ready(&mut f,0);let mut n=0;while(n < 3){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1};runtime_player(&mut f);end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun runtime_paid_player_without_entitlement_is_rejected(){let mut f=setup();runtime_ready(&mut f,15);runtime_player(&mut f);end(f)}
#[test]
fun runtime_actual_access_payment_and_player_uses_same_certificate(){let mut f=setup();runtime_ready(&mut f,15);let hash=catalog::policy_hash(catalog::published(&f.p,1));let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let payment=coin::mint_for_testing<USD>(15,f.sc.ctx());{let F{out:_,sc,p,cfg,clock,cap:_,sys,nodes:_}=&mut f;soulidity_v1::runtime::buy_access(p,cfg,1,hash,rev,expiry,fixtures::h(94),payment,clock,sys,sc.ctx())};runtime_player(&mut f);assert!(soulidity_foundation::revenue::balance(catalog::income(&f.p))==14 && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==1,0);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun runtime_expired_actual_certificate_cannot_collect_access_payment(){let mut f=setup();runtime_ready(&mut f,15);let mut n=0;while(n < 3){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1};let hash=catalog::policy_hash(catalog::published(&f.p,1));let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let payment=coin::mint_for_testing<USD>(15,f.sc.ctx());{let F{out:_,sc,p,cfg,clock,cap:_,sys,nodes:_}=&mut f;soulidity_v1::runtime::buy_access(p,cfg,1,hash,rev,expiry,fixtures::h(94),payment,clock,sys,sc.ctx())};end(f)}
#[test]
fun runtime_already_owned_free_item_can_exit_after_maker_expiry(){let mut f=setup();runtime_ready(&mut f,0);f=advance(f);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);runtime_choose(&mut f,&mut p);let soul=runtime_complete(&mut f,&p);soulidity_v1::player::close(p,1,f.sc.ctx());f=advance(f);let mut s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(soul);let before=soulidity_application::character::free_id(&soulidity_application::character::binding(&s,b"free").destroy_some()).destroy_some();transfer::public_transfer(s,@0xa);let mut n=0;while(n < 3){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1};f=advance(f);let mut s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(soul);let rev=soulidity_application::character::revision(&s);let item=soulidity_application::character::detach(&mut s,b"free",rev);assert!(object::id(&item)==before,0);transfer::public_transfer(item,@0xb);transfer::public_transfer(s,@0xa);end(f)}

fun runtime_pack(f:F,mode:u8,access_price:u64,contribution:u64):(F,Product<USD>,Control){
    let mut f=f;let id={let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;soulidity_v1::runtime::create_pack(p,1,cap,cfg,0,sys,sc.ctx())};
    f=advance(f);let mut pack:Product<USD> =f.sc.take_shared_by_id(id);let mut found=option::none();let held=object::id(&f.cap);f.sc.ids_for_sender<Control>().do_ref!(|oid|{if(*oid!=held){let c:Control=f.sc.take_from_sender_by_id(*oid);if(catalog::control_product(&c)==id)found.fill(c) else f.sc.return_to_sender(c)}});let mut cap=found.destroy_some();
    let version=catalog::with_pack_key(catalog::version(fixtures::h(5),fixtures::h(6),mode,access_price,if(contribution>0)1 else 0,contribution,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[],vector[fixtures::pack_def(b"free",1,10)],vector[],fixtures::scene()),b"pack");
    let living=storage_fixture::blob(&mut f.sys,500,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,501,false,true,f.sc.ctx());
    let mut d=release::begin(&pack,&mut cap,&f.cfg,0,version,release::author(b"Pack author",vector[],vector[],b"license",fixtures::h(7)),living,manifest,&f.sys,f.sc.ctx());let blob=storage_fixture::blob(&mut f.sys,502,false,true,f.sc.ctx());
    release::append(&mut d,&pack,&mut cap,&f.cfg,fixtures::h(11),true,fixtures::h(30),blob,&f.sys,0,f.sc.ctx());release::finish(d,&mut pack,&mut cap,&f.cfg,&f.sys,1,f.sc.ctx());(f,pack,cap)
}
fun runtime_pack_choice(f:&mut F,pack:&Product<USD>,p:&mut soulidity_maker_manufacturing::maker_player::Player){let expected=soulidity_v1::player::revision(p);let expiry=clock::timestamp_ms(&f.clock)+1000;soulidity_v1::runtime::set_pack(p,&f.p,pack,&f.cfg,1,policy::definition_hash(&fixtures::pack_def(b"free",1,10)),fixtures::layout(),expected,economics::revision(&f.cfg),expiry,&f.clock,&f.sys,f.sc.ctx())}
fun runtime_pack_complete(f:&mut F,pack:&mut Product<USD>,p:&soulidity_maker_manufacturing::maker_player::Player,contribution:u64):ID{
    let intent=fixtures::default_intent(&f.p,93,soulidity_v1::player::semantic_recipe_hash(p),f.sc.sender());let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let payment=coin::zero<USD>(f.sc.ctx());
    let mut b={let F{out:_,sc,p:maker,cfg,sys,clock,cap:_,nodes:_}=f;soulidity_v1::runtime::begin(maker,cfg,intent,b"default",rev,expiry,payment,clock,sys,sc.ctx())};
    let hash=catalog::policy_hash(catalog::published(pack,1));let pay=coin::mint_for_testing<USD>(contribution,f.sc.ctx());{let F{out:_,sc,p:maker,cfg,sys,clock,cap:_,nodes:_}=f;soulidity_v1::runtime::include_pack(&mut b,pack,maker,cfg,1,hash,rev,expiry,pay,clock,sys,sc.ctx())};
    soulidity_v1::runtime::select_player(&mut b,pack,p,b"free",soulidity_v1::player::revision(p),&f.cfg,&f.sys,f.sc.ctx());runtime_finish(f,b)
}
#[test]
fun runtime_paid_pack_complete_keeps_bound_component_and_separate_revenue(){
    let mut f=setup();runtime_ready(&mut f,0);let(mut f,mut pack,cap)=runtime_pack(f,1,15,19);let hash=catalog::policy_hash(catalog::published(&pack,1));let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let pay=coin::mint_for_testing<USD>(15,f.sc.ctx());{let F{out:_,sc,cfg,clock,sys,p:_,cap:_,nodes:_}=&mut f;soulidity_v1::runtime::buy_access(&mut pack,cfg,1,hash,rev,expiry,fixtures::h(95),pay,clock,sys,sc.ctx())};
    let pid=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(pid);runtime_pack_choice(&mut f,&pack,&mut p);let id=runtime_pack_complete(&mut f,&mut pack,&p,19);soulidity_v1::player::close(p,1,f.sc.ctx());
    assert!(soulidity_foundation::revenue::balance(catalog::income(&pack))==32 && soulidity_foundation::revenue::balance(catalog::income(&f.p))==0 && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==2,0);
    test_scenario::return_shared(pack);f.sc.return_to_sender(cap);f=advance(f);let s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(id);let binding=soulidity_application::character::binding(&s,b"free").destroy_some();assert!(policy::rights(soulidity_application::character::binding_source(&binding))==1 && soulidity_application::character::free_id(&binding).is_none() && soulidity_application::output::total_paid(soulidity_application::output::artifact_receipt(soulidity_application::character::original_output(&s)))==19,1);transfer::public_transfer(s,@0xa);end(f)
}
#[test]
fun runtime_included_pack_uses_paid_parent_entitlement_without_pack_access_payment(){
    let mut f=setup();runtime_ready(&mut f,15);let(mut f,mut pack,cap)=runtime_pack(f,2,0,19);let hash=catalog::policy_hash(catalog::published(&f.p,1));let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let pay=coin::mint_for_testing<USD>(15,f.sc.ctx());{let F{out:_,sc,p,cfg,clock,sys,cap:_,nodes:_}=&mut f;soulidity_v1::runtime::buy_access(p,cfg,1,hash,rev,expiry,fixtures::h(95),pay,clock,sys,sc.ctx())};
    let pid=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(pid);runtime_pack_choice(&mut f,&pack,&mut p);let id=runtime_pack_complete(&mut f,&mut pack,&p,19);soulidity_v1::player::close(p,1,f.sc.ctx());assert!(!catalog::access_held(&pack,1,@0xa) && soulidity_foundation::revenue::balance(catalog::income(&pack))==18 && soulidity_foundation::revenue::balance(catalog::income(&f.p))==14 && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==2,0);test_scenario::return_shared(pack);f.sc.return_to_sender(cap);f=advance(f);let s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(id);assert!(soulidity_application::character::bound_count(&s)==1,1);transfer::public_transfer(s,@0xa);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun runtime_paid_pack_selection_without_entitlement_rejected(){let mut f=setup();runtime_ready(&mut f,0);let(mut f,pack,cap)=runtime_pack(f,1,15,0);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);runtime_pack_choice(&mut f,&pack,&mut p);f.sc.return_to_sender(p);test_scenario::return_shared(pack);f.sc.return_to_sender(cap);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun runtime_pack_seal_rejects_expired_parent_even_with_live_pack(){let mut f=setup();runtime_ready(&mut f,0);let mut n=0;while(n < 2){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1};let(mut f,pack,cap)=runtime_pack(f,0,0,0);storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);release::assert_current(&pack,&f.cfg,1,&f.sys);release::seal_approve_pack(release::seal_scope(object::id(&f.cfg),object::id(&pack),1,fixtures::h(11)),&pack,&f.p,&f.cfg,1,&f.sys,&f.clock,f.sc.ctx());test_scenario::return_shared(pack);f.sc.return_to_sender(cap);end(f)}

fun runtime_physical_ready(f:&mut F,mode:u8,price:u64):ID{
    runtime_physical_ready_extra(f,mode,price,false)
}
fun runtime_physical_ready_extra(f:&mut F,mode:u8,price:u64,extra:bool):ID{
    let terms=soulidity_model::material_policy::terms(policy::definition_hash(&fixtures::def(b"free",2,10)),fixtures::h(90),mode,if(mode==2)2 else 0,price,3,true);let version=catalog::with_physical(v(f,extra,0),vector[terms]);let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());
    let d=release::begin(&f.p,&mut f.cap,&f.cfg,0,version,release::author(b"Creator",vector[],vector[],b"license",fixtures::h(3)),living,manifest,&f.sys,f.sc.ctx());let mut d=d;append(f,&mut d,11,true,0);if(extra){append(f,&mut d,13,false,1);};finish(f,d);let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=f;soulidity_v1::runtime::physical_create_registry(p,cap,1,cfg,sys,sc.ctx())
}
fun runtime_physical_issue(f:&mut F,r:&mut soulidity_v1::physical::Registry<USD>,p:&soulidity_maker_manufacturing::maker_player::Player,price:u64):soulidity_v1::physical::Asset{
    let source=*soulidity_v1::player::source(&soulidity_v1::player::selection(p,b"free").destroy_some());let key=policy::source_hash(&source);let expiry=clock::timestamp_ms(&f.clock)+1000;let quote=soulidity_v1::physical::quote(r,key,&f.cfg,f.sc.sender(),expiry);let issued=soulidity_v1::physical::issued(soulidity_v1::physical::rule(r,key));let rev=soulidity_v1::physical::revision(r);let prev=soulidity_v1::player::revision(p);let fee=economics::revision(&f.cfg);
    if(price==0)soulidity_v1::runtime::physical_claim(r,&f.p,&f.p,p,b"free",&f.cfg,prev,rev,issued,fee,expiry,quote,fixtures::h(96),&f.clock,&f.sys,f.sc.ctx())
    else{let pay=coin::mint_for_testing<USD>(price,f.sc.ctx());let F{out:_,sc,p:maker,cfg,sys,clock,cap:_,nodes:_}=f;soulidity_v1::runtime::physical_purchase(r,maker,p,b"free",cfg,pay,prev,rev,issued,fee,expiry,quote,fixtures::h(96),clock,sys,sc.ctx())}
}
#[test]
fun runtime_actual_certified_physical_claim_preserves_player_and_capture(){let mut f=setup();let rid=runtime_physical_ready(&mut f,0,0);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);runtime_choose(&mut f,&mut p);let selected=*soulidity_v1::player::source(&soulidity_v1::player::selection(&p,b"free").destroy_some());let a=runtime_physical_issue(&mut f,&mut r,&p,0);assert!(*soulidity_v1::physical::asset_source(&a)==selected && soulidity_v1::physical::asset_serial(&a)==1 && soulidity_v1::player::revision(&p)==1,0);soulidity_v1::physical::asset_visual(&a);soulidity_v1::physical::deliver(a);test_scenario::return_shared(r);f.sc.return_to_sender(p);end(f)}
#[test]
fun runtime_actual_certified_physical_purchase_conserves_payment(){let mut f=setup();let rid=runtime_physical_ready(&mut f,1,37);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);runtime_choose(&mut f,&mut p);let a=runtime_physical_issue(&mut f,&mut r,&p,37);assert!(soulidity_foundation::revenue::balance(catalog::income(&f.p))==34 && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==3 && soulidity_v1::physical::gross(&soulidity_v1::physical::stats(&r))==37,0);soulidity_v1::physical::deliver(a);test_scenario::return_shared(r);f.sc.return_to_sender(p);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun runtime_expired_creator_cannot_issue_physical_from_old_player(){let mut f=setup();let rid=runtime_physical_ready(&mut f,0,0);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);runtime_choose(&mut f,&mut p);let mut n=0;while(n < 3){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1};soulidity_v1::physical::deliver(runtime_physical_issue(&mut f,&mut r,&p,0));test_scenario::return_shared(r);f.sc.return_to_sender(p);end(f)}

#[test]
fun runtime_actual_certified_physical_materialization_binds_original_soul_artifact(){
    let mut f=setup();let rid=runtime_physical_ready(&mut f,2,0);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);runtime_choose(&mut f,&mut p);let sid=runtime_complete(&mut f,&p);soulidity_v1::player::close(p,1,f.sc.ctx());f=advance(f);let mut s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(sid);let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);
    let artifact=object::id(soulidity_application::character::original_output(&s));let source=*soulidity_application::character::binding_source(&soulidity_application::character::binding(&s,b"free").destroy_some());let key=policy::source_hash(&source);let expiry=clock::timestamp_ms(&f.clock)+1000;let quote=soulidity_v1::physical::quote(&r,key,&f.cfg,f.sc.sender(),expiry);let sr=soulidity_application::character::revision(&s);let rr=soulidity_v1::physical::revision(&r);let fee=economics::revision(&f.cfg);
    let a=soulidity_v1::runtime::physical_materialize(&mut r,&f.p,&f.p,&mut s,b"free",b"print-1",&f.cfg,sr,rr,0,fee,expiry,quote,fixtures::h(96),&f.clock,&f.sys,f.sc.ctx());let proof=soulidity_v1::physical::asset_proof(&a).destroy_some();assert!(soulidity_maker_terms::maker_physical_metadata::proof_soul(&proof)==sid && soulidity_maker_terms::maker_physical_metadata::proof_artifact(&proof)==artifact && soulidity_maker_terms::maker_physical_metadata::proof_source(&proof)==key,0);soulidity_v1::physical::deliver(a);transfer::public_transfer(s,@0xa);test_scenario::return_shared(r);end(f)
}
// Test-only scenario epoch transition; production Build cannot persist across PTBs.
#[test,expected_failure(abort_code=1,location=soulidity_v1::runtime)]
fun runtime_nonstorable_complete_ticket_rejects_changed_actual_epoch(){
    let mut f=setup();runtime_ready(&mut f,0);f=advance(f);let pid=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(pid);runtime_choose(&mut f,&mut p);let intent=fixtures::default_intent(&f.p,93,soulidity_v1::player::semantic_recipe_hash(&p),f.sc.sender());let rev=economics::revision(&f.cfg);let expiry=clock::timestamp_ms(&f.clock)+1000;let pay=coin::zero<USD>(f.sc.ctx());let mut b={let F{out:_,sc,p:maker,cfg,sys,clock,cap:_,nodes:_}=&mut f;soulidity_v1::runtime::begin(maker,cfg,intent,b"default",rev,expiry,pay,clock,sys,sc.ctx())};{let F{out:_,sc,p:maker,cfg,sys,clock:_,cap:_,nodes:_}=&mut f;soulidity_v1::runtime::select_player(&mut b,maker,&p,b"free",1,cfg,sys,sc.ctx())};f.sc.return_to_sender(p);storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);runtime_finish(&mut f,b);end(f)
}

fun runtime_soul_with_tool_materialization(expired:bool){
    let mut f=setup();let rid=runtime_physical_ready(&mut f,2,0);let pid=runtime_player(&mut f);
    f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(pid);
    runtime_choose(&mut f,&mut p);let sid=runtime_complete(&mut f,&p);soulidity_v1::player::close(p,1,f.sc.ctx());f=advance(f);
    let mut s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(sid);
    let artifact=object::id(soulidity_application::character::original_output(&s));
    let source=*soulidity_application::character::binding_source(&soulidity_application::character::binding(&s,b"free").destroy_some());let key=policy::source_hash(&source);
    let root_revision=soulidity_standard::soul::revision(&s);let tool=soulidity_application::vault::install(&mut s,root_revision,f.sc.ctx());
    let before=soulidity_application::vault::snapshot(&s);f.sc.return_to_sender(s);f=advance(f);
    let mut s:soulidity_standard::soul::Soul=f.sc.take_from_sender_by_id(sid);
    let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);
    if(expired){let mut n=0;while(n < 3){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1}};
    let expiry=clock::timestamp_ms(&f.clock)+1000;let quote=soulidity_v1::physical::quote(&r,key,&f.cfg,f.sc.sender(),expiry);
    let sr=soulidity_application::character::revision(&s);let rr=soulidity_v1::physical::revision(&r);let fee=economics::revision(&f.cfg);
    let asset=soulidity_v1::runtime::physical_materialize(&mut r,&f.p,&f.p,&mut s,b"free",b"print-tool",&f.cfg,sr,rr,0,fee,expiry,quote,fixtures::h(96),&f.clock,&f.sys,f.sc.ctx());
    assert!(object::id(&s)==sid && object::id(soulidity_application::vault::tool(&s))==tool && soulidity_application::vault::snapshot(&s)==before,0);
    let proof=soulidity_v1::physical::asset_proof(&asset).destroy_some();
    assert!(soulidity_maker_terms::maker_physical_metadata::proof_soul(&proof)==sid && soulidity_maker_terms::maker_physical_metadata::proof_artifact(&proof)==artifact,1);
    soulidity_v1::physical::deliver(asset);test_scenario::return_shared(r);f.sc.return_to_sender(s);end(f)
}
#[test]
fun runtime_certified_soul_with_vault_tool_keeps_original_proof(){runtime_soul_with_tool_materialization(false)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun runtime_tool_cannot_bypass_expired_creator_for_physical(){runtime_soul_with_tool_materialization(true)}

fun metadata_seed(f:&F):Version{catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[],vector[],vector[],fixtures::scene()),vector[f.out])}
fun metadata_start(f:&mut F):soulidity_maker_manufacturing::maker_metadata::Metadata{let seed=metadata_seed(f);let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=f;soulidity_v1::metadata::start(p,cap,cfg,0,seed,sys,sc.ctx())}
fun metadata_append(f:&mut F,m:&mut soulidity_maker_manufacturing::maker_metadata::Metadata,defs:vector<policy::Definition>,revision:u64){let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=f;soulidity_v1::metadata::append_definitions(m,p,cap,cfg,defs,sys,revision,sc.ctx())}
fun metadata_fragments(start:u64,end:u64):vector<visual::Fragment>{vector::tabulate!(end-start,|j|{let i=start+j;visual::fragment(std::bcs::to_bytes(&i),large_asset(i),b"image/png",1024,1,1,0,0,1,1,0,0,b"main",i,b"root",visual::transform(visual::signed(false,0),visual::signed(false,0),1000000,visual::signed(false,0)),1000000,0,option::none(),option::none(),option::none(),vector[])})}
fun metadata_def(start:u64,end:u64):policy::Definition{let scene=fixtures::scene();let representation=visual::representation(&scene,1024,1024,metadata_fragments(start,end),vector[]);policy::definition(b"free",b"many",std::bcs::to_bytes(&start),2,fixtures::h(11),fixtures::h(12),representation,10,fixtures::layout(),policy::bounds(0,0,1000000,1000000,0,vector[]),vector[],vector[],true)}
fun metadata_full(f:&F):Version{let mut v=metadata_seed(f);catalog::append_definitions(&mut v,vector[metadata_def(0,250),metadata_def(250,500)]);catalog::finalize_metadata(&v)}
fun metadata_enter(f:&mut F,m:soulidity_maker_manufacturing::maker_metadata::Metadata,hash:vector<u8>):Draft{let rev=soulidity_v1::metadata::revision(&m);let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=f;soulidity_v1::metadata::begin_publication(m,p,cap,cfg,rev,hash,release::author(b"Creator",vector[],vector[],b"license",fixtures::h(3)),living,manifest,sys,sc.ctx())}
#[test]
fun metadata_multitx_matches_canonical_version_and_real_publication(){let mut f=setup();let m=metadata_start(&mut f);let id=object::id(&m);soulidity_v1::metadata::deliver(m,f.sc.ctx());f=advance(f);let mut m:soulidity_maker_manufacturing::maker_metadata::Metadata=f.sc.take_from_sender_by_id(id);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],0);let golden=v(&f,false,0);assert!(soulidity_v1::metadata::policy_hash(&m)==catalog::policy_hash(&golden) && catalog::finalize_metadata(soulidity_v1::metadata::version(&m))==golden,0);let mut d=metadata_enter(&mut f,m,catalog::policy_hash(&golden));append(&mut f,&mut d,11,true,0);finish(&mut f,d);runtime_player(&mut f);end(f)}
#[test]
fun metadata_five_hundred_fragments_stream_in_bounded_chunks_with_exact_hash(){
    let mut f=setup();let golden=metadata_full(&f);let serialized=std::bcs::to_bytes(&golden).length();assert!(serialized>16384 && serialized<=196608,0);let m=metadata_start(&mut f);let id=object::id(&m);soulidity_v1::metadata::deliver(m,f.sc.ctx());let mut group=0u64;
    while(group < 2){f=advance(f);let mut m:soulidity_maker_manufacturing::maker_metadata::Metadata=f.sc.take_from_sender_by_id(id);let rev=soulidity_v1::metadata::revision(&m);let start=group*250;metadata_append(&mut f,&mut m,vector[metadata_def(start,start+1)],rev);soulidity_v1::metadata::deliver(m,f.sc.ctx());let mut i=start+1;while(i < start+250){f=advance(f);let mut m:soulidity_maker_manufacturing::maker_metadata::Metadata=f.sc.take_from_sender_by_id(id);let next=if(i+32>start+250)start+250 else i+32;let fragments=metadata_fragments(i,next);assert!(fragments.length()<=32 && std::bcs::to_bytes(&fragments).length()<=8192,1);let rev=soulidity_v1::metadata::revision(&m);{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;soulidity_v1::metadata::extend_definition(&mut m,p,cap,cfg,group,fragments,sys,rev,sc.ctx())};soulidity_v1::metadata::deliver(m,f.sc.ctx());i=next};group=group+1};f=advance(f);let m:soulidity_maker_manufacturing::maker_metadata::Metadata=f.sc.take_from_sender_by_id(id);assert!(soulidity_v1::metadata::revision(&m)==18 && catalog::finalize_metadata(soulidity_v1::metadata::version(&m))==golden && soulidity_v1::metadata::byte_bound(&m)>=serialized && soulidity_v1::metadata::byte_bound(&m)<=196608,2);let d=metadata_enter(&mut f,m,catalog::policy_hash(&golden));assert!(release::expected_count(&d)==500,3);release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_metadata)]
fun metadata_whole_oversize_seed_is_rejected(){let mut f=setup();let full=metadata_full(&f);let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;let m=soulidity_v1::metadata::start(p,cap,cfg,0,full,sys,sc.ctx());soulidity_v1::metadata::cancel(m,sc.ctx());end(f)}
#[test,expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_metadata)]
fun metadata_stale_revision_cannot_append(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],1);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=5,location=soulidity_maker_manufacturing::maker_catalog)]
fun metadata_duplicate_fixed_style_cannot_append(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],0);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],1);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_metadata)]
fun metadata_more_than_thirty_two_fragments_rejected(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[metadata_def(0,1)],0);let extra=metadata_fragments(1,34);{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;soulidity_v1::metadata::extend_definition(&mut m,p,cap,cfg,0,extra,sys,1,sc.ctx())};soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=5,location=soulidity_maker_manufacturing::maker_metadata)]
fun metadata_wrong_final_hash_cannot_enter_publication(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],0);let d=metadata_enter(&mut f,m,fixtures::h(99));release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_maker_manufacturing::maker_metadata)]
fun metadata_other_actor_cannot_modify_creator_draft(){let mut f=setup();let mut m=metadata_start(&mut f);f.sc.next_tx(@0xb);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],0);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test]
fun metadata_original_author_can_cancel_after_config_drift(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],0);let mut admin:Admin=f.sc.take_from_sender();let rev=economics::revision(&f.cfg);economics::configure(&mut f.cfg,&mut admin,rev,500,500,0,@0xf,true);f.sc.return_to_sender(admin);soulidity_v1::metadata::cancel(m,f.sc.ctx());assert!(catalog::current_version(&f.p)==0,0);end(f)}
#[test,expected_failure(abort_code=2,location=soulidity_maker_manufacturing::maker_metadata)]
fun metadata_changed_config_snapshot_cannot_append(){let mut f=setup();let mut m=metadata_start(&mut f);let mut admin:Admin=f.sc.take_from_sender();let rev=economics::revision(&f.cfg);economics::configure(&mut f.cfg,&mut admin,rev,500,500,0,@0xf,false);f.sc.return_to_sender(admin);metadata_append(&mut f,&mut m,vector[fixtures::def(b"free",2,10)],0);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}

fun metadata_masked(i:u64,mask:u64):visual::Fragment{visual::fragment(std::bcs::to_bytes(&i),large_asset(i),b"image/png",1024,1,1,0,0,1,1,0,0,b"main",i,b"root",visual::transform(visual::signed(false,0),visual::signed(false,0),1000000,visual::signed(false,0)),1000000,0,option::none(),option::none(),option::some(mask),vector[])}
fun metadata_extend(f:&mut F,m:&mut soulidity_maker_manufacturing::maker_metadata::Metadata,extra:vector<visual::Fragment>,rev:u64){let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=f;soulidity_v1::metadata::extend_definition(m,p,cap,cfg,0,extra,sys,rev,sc.ctx())}
#[test]
fun metadata_cross_chunk_mask_retains_global_order_and_canonical_representation(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[metadata_def(0,1)],0);let previous=soulidity_v1::metadata::stream_commitment(&m);metadata_extend(&mut f,&mut m,vector[metadata_masked(1,0)],1);let mut fragments=metadata_fragments(0,1);fragments.push_back(metadata_masked(1,0));let expected=visual::representation(&fixtures::scene(),1024,1024,fragments,vector[]);let definition=&catalog::definitions_ref(soulidity_v1::metadata::version(&m))[0];assert!(*policy::representation(definition)==expected && soulidity_v1::metadata::stream_commitment(&m)!=previous && soulidity_v1::metadata::revision(&m)==2,0);let final_v=catalog::finalize_metadata(soulidity_v1::metadata::version(&m));assert!(catalog::policy_hash(&final_v)==soulidity_v1::metadata::policy_hash(&m) && std::bcs::to_bytes(&final_v).length()<=soulidity_v1::metadata::byte_bound(&m),1);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun metadata_new_mask_cannot_reference_future_fragment(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[metadata_def(0,1)],0);metadata_extend(&mut f,&mut m,vector[metadata_masked(1,2)],1);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=3,location=soulidity_visual::visual)]
fun metadata_new_fragment_cannot_duplicate_prior_chunk_key(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[metadata_def(0,1)],0);metadata_extend(&mut f,&mut m,metadata_fragments(0,1),1);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=2,location=soulidity_visual::visual)]
fun metadata_cross_chunk_mask_depth_nine_rejected(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[metadata_def(0,1)],0);let rows=vector::tabulate!(8,|j|metadata_masked(j+1,j));metadata_extend(&mut f,&mut m,rows,1);metadata_extend(&mut f,&mut m,vector[metadata_masked(9,8)],2);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=5,location=soulidity_maker_manufacturing::maker_catalog)]
fun metadata_definition_cannot_change_after_physical_terms_pin_its_hash(){let mut f=setup();let mut m=metadata_start(&mut f);metadata_append(&mut f,&mut m,vector[metadata_def(0,1)],0);let def=catalog::definitions_ref(soulidity_v1::metadata::version(&m))[0];let terms=soulidity_model::material_policy::terms(policy::definition_hash(&def),fixtures::h(90),0,0,0,3,true);{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;soulidity_v1::metadata::append_physical(&mut m,p,cap,cfg,vector[terms],sys,1,sc.ctx())};metadata_extend(&mut f,&mut m,metadata_fragments(1,2),2);soulidity_v1::metadata::cancel(m,f.sc.ctx());end(f)}

#[test]
fun paged_cancellation_one_then_thirty_one_preserves_original_ids_and_tail(){
    let mut f=setup();let mut d=large_begin(&mut f);let(a,p,h,b,mut ids)=batch_vectors(&mut f,32);
    {let F{out:_,sc,p:product,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,product,cap,cfg,a,p,h,b,sys,0,sc.ctx())};
    let blob=storage_fixture::blob(&mut f.sys,1032,false,true,f.sc.ctx());ids.push_back(object::id(&blob));
    {let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append(&mut d,p,cap,cfg,large_asset(32),false,large_asset(32),blob,sys,32,sc.ctx())};
    let first=release::cancel_chunk(&mut d,1,33,f.sc.ctx());assert!(first.length()==1 && object::id(&first[0])==ids[0],0);first.do!(|b|transfer::public_transfer(b,@0xa));
    let rest=release::cancel_chunk(&mut d,31,34,f.sc.ctx());assert!(rest.length()==31,1);let mut i=0u64;while(i < 31){assert!(object::id(&rest[i])==ids[i+1],2);i=i+1};rest.do!(|b|transfer::public_transfer(b,@0xa));
    let tail=release::cancel(d,f.sc.ctx());assert!(tail.length()==3 && tail.any!(|b|object::id(b)==ids[32]),3);tail.do!(|b|transfer::public_transfer(b,@0xa));
    f=advance(f);let held=f.sc.ids_for_sender<Blob>();assert!(held.length()==35 && ids.all!(|id|held.contains(id)) && catalog::current_version(&f.p)==0,4);end(f)
}

// Original transport commitments are readable without granting plaintext access.
#[test]
fun physical_material_protected_metadata_survives_archive_expiry_and_transfer(){
    let mut f=setup();let rid=runtime_physical_ready(&mut f,0,0);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);runtime_choose(&mut f,&mut p);let a=runtime_physical_issue(&mut f,&mut r,&p,0);let aid=object::id(&a);
    let m=soulidity_v1::runtime::physical_material(&a,&f.p,fixtures::h(11));let ref=*release::asset_reference(&m);let scope=release::asset_scope(&m);let registration=soulidity_v1::physical::asset_registration(&a);let provenance=soulidity_v1::physical::asset_provenance(&a);
    assert!(release::asset_hash(&m)==fixtures::h(11) && release::asset_plain_bytes(&m)==1024 && release::asset_protected(&m),0);
    assert!(storage::hash(&ref)==fixtures::h(30) && storage::hash(&ref)!=release::asset_hash(&m) && storage::bytes(&ref)==1024,1);
    assert!(scope==release::seal_scope(object::id(&f.cfg),object::id(&f.p),1,fixtures::h(11)),2);
    release::archive(&mut f.p,&mut f.cap,1);let mut n=0;while(n < 3){storage_fixture::next_epoch(&mut f.sc,&mut f.sys,&mut f.nodes,&mut f.clock);n=n+1};
    soulidity_v1::physical::transfer_asset(a,@0xb,0,f.sc.ctx());f.sc.next_tx(@0xb);let a:soulidity_v1::physical::Asset=f.sc.take_from_sender_by_id(aid);let m=soulidity_v1::runtime::physical_material(&a,&f.p,fixtures::h(11));
    assert!(*release::asset_reference(&m)==ref && release::asset_scope(&m)==scope && soulidity_v1::physical::asset_registration(&a)==registration && soulidity_v1::physical::asset_provenance(&a)==provenance,3);
    assert!(soulidity_v1::physical::asset_holder(&a)==@0xb && soulidity_v1::physical::asset_epoch(&a)==1,4);
    soulidity_v1::physical::deliver(a);f.sc.next_tx(@0xa);test_scenario::return_shared(r);f.sc.return_to_sender(p);end(f)
}
#[test,expected_failure(abort_code=2,location=soulidity_v1::runtime)]
fun physical_material_rejects_other_actual_product(){
    let mut f=setup();let rid=runtime_physical_ready(&mut f,0,0);let(mut f,pack,cap)=runtime_pack(f,0,0,0);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);runtime_choose(&mut f,&mut p);let a=runtime_physical_issue(&mut f,&mut r,&p,0);
    soulidity_v1::runtime::physical_material(&a,&pack,fixtures::h(11));soulidity_v1::physical::deliver(a);test_scenario::return_shared(pack);f.sc.return_to_sender(cap);test_scenario::return_shared(r);f.sc.return_to_sender(p);end(f)
}
#[test,expected_failure(abort_code=2,location=soulidity_v1::runtime)]
fun physical_material_rejects_other_style_in_same_actual_certificate(){
    let mut f=setup();let rid=runtime_physical_ready_extra(&mut f,0,0,true);let id=runtime_player(&mut f);f=advance(f);let mut p:soulidity_maker_manufacturing::maker_player::Player=f.sc.take_from_sender_by_id(id);let mut r:soulidity_v1::physical::Registry<USD> =f.sc.take_shared_by_id(rid);runtime_choose(&mut f,&mut p);let a=runtime_physical_issue(&mut f,&mut r,&p,0);
    assert!(release::asset_hash(release::certificate_asset_by_hash(release::certificate(&f.p,1),fixtures::h(13)))==fixtures::h(13),0);
    soulidity_v1::runtime::physical_material(&a,&f.p,fixtures::h(13));soulidity_v1::physical::deliver(a);test_scenario::return_shared(r);f.sc.return_to_sender(p);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_release)]
fun certificate_hash_lookup_rejects_missing_commitment(){let mut f=setup();runtime_physical_ready(&mut f,0,0);release::certificate_asset_by_hash(release::certificate(&f.p,1),fixtures::h(99));end(f)}

#[test]
fun fixed_blob_page_layout_bound_preserves_maximum_certified_blob_bytes(){
    let mut f=setup();let mut blobs=vector[];let mut i=0u64;
    while(i < 32){let blob=storage_fixture::blob(&mut f.sys,(9000+i) as u256,i % 2 == 0,true,f.sc.ctx());assert!(std::bcs::to_bytes(&blob).length()==131,0);blobs.push_back(blob);i=i+1};
    assert!(32+std::bcs::to_bytes(&blobs).length()==4225 && 4225 <245760,1);
    blobs.do!(|b|transfer::public_transfer(b,@0xa));end(f)
}


fun directory_begin(f:&mut F):Draft{
    let version=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[],vector[projection_definition(0,33,true)],vector[],fixtures::scene()),vector[f.out]);
    let living=storage_fixture::blob(&mut f.sys,100,false,true,f.sc.ctx());let manifest=storage_fixture::blob(&mut f.sys,101,false,true,f.sc.ctx());
    release::begin(&f.p,&mut f.cap,&f.cfg,0,version,release::author(b"Creator",vector[],vector[],b"license",fixtures::h(3)),living,manifest,&f.sys,f.sc.ctx())
}
#[test]
fun directory_index_preserves_reverse_upload_order_and_exact_hash_lookup(){
    let mut f=setup();let mut d=directory_begin(&mut f);let mut ids=vector[];let mut remaining=33u64;
    while(remaining>0){remaining=remaining-1;let asset=prefix_digest(remaining);let blob=storage_fixture::blob(&mut f.sys,(1000+remaining) as u256,false,true,f.sc.ctx());ids.push_back(object::id(&blob));let rev=release::revision(&d);{let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append(&mut d,p,cap,cfg,asset,false,asset,blob,sys,rev,sc.ctx())}};
    finish(&mut f,d);let c=release::certificate(&f.p,1);assert!(release::certificate_rows(c)==33,540);let mut row=0u64;
    while(row < 33){let a=release::certificate_asset(c,row);let by_hash=release::certificate_asset_by_hash(c,prefix_digest(32-row));assert!(release::asset_hash(a)==prefix_digest(32-row) && *a==*by_hash && storage::object_id(release::asset_reference(a))==ids[row],541);row=row+1};
    release::assert_current(&f.p,&f.cfg,1,&f.sys);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_release)]
fun directory_index_rejects_duplicate_digest_inside_same_batch(){
    let mut f=setup();let mut d=directory_begin(&mut f);let digest=prefix_digest(32);let one=storage_fixture::blob(&mut f.sys,9000,false,true,f.sc.ctx());let two=storage_fixture::blob(&mut f.sys,9001,false,true,f.sc.ctx());
    {let F{out:_,sc,p,cap,cfg,sys,nodes:_,clock:_}=&mut f;release::append_batch(&mut d,p,cap,cfg,vector[digest,digest],vector[false,false],vector[digest,digest],vector[one,two],sys,0,sc.ctx())};release::cancel(d,f.sc.ctx()).do!(|b|transfer::public_transfer(b,@0xa));end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_release)]
fun directory_index_rejects_malformed_certificate_digest(){let mut f=setup();runtime_physical_ready(&mut f,0,0);release::certificate_asset_by_hash(release::certificate(&f.p,1),vector[11]);end(f)}
#[test]
fun directory_index_empty_metadata_lookup_has_no_position(){assert!(publication_rules::expected_index(&vector[],prefix_digest(0)).is_none() && publication_rules::expected_lookup(&vector[],prefix_digest(0)).is_none(),550)}
public struct CustodyOwner has key {id:UID}
#[test]
fun custody_owner_can_recover_original_document_and_partial_page(){
    let mut f=setup();let mut owner=CustodyOwner{id:object::new(f.sc.ctx())};let document=storage_fixture::blob(&mut f.sys,8000,false,true,f.sc.ctx());let item=storage_fixture::blob(&mut f.sys,8001,false,true,f.sc.ctx());let doc_id=object::id(&document);let item_id=object::id(&item);
    soulidity_transport::blob_transport::add_document(&mut owner.id,0,document);soulidity_transport::blob_transport::append(&mut owner.id,0,item,f.sc.ctx());
    let item=soulidity_transport::blob_transport::take(&mut owner.id,0);let document=soulidity_transport::blob_transport::take_document(&mut owner.id,0);assert!(object::id(&item)==item_id && object::id(&document)==doc_id,560);transfer::public_transfer(item,@0xa);transfer::public_transfer(document,@0xa);let CustodyOwner{id}=owner;id.delete();end(f)
}
#[test,expected_failure(abort_code=2,location=soulidity_transport::blob_transport)]
fun custody_rejects_gap_in_existing_page(){let mut f=setup();let mut owner=CustodyOwner{id:object::new(f.sc.ctx())};let one=storage_fixture::blob(&mut f.sys,8000,false,true,f.sc.ctx());let two=storage_fixture::blob(&mut f.sys,8001,false,true,f.sc.ctx());soulidity_transport::blob_transport::append(&mut owner.id,0,one,f.sc.ctx());soulidity_transport::blob_transport::append(&mut owner.id,2,two,f.sc.ctx());transfer::transfer(owner,@0xa);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::blob_transport)]
fun custody_rejects_asset_beyond_five_hundred(){let mut f=setup();let mut owner=CustodyOwner{id:object::new(f.sc.ctx())};let one=storage_fixture::blob(&mut f.sys,8000,false,true,f.sc.ctx());soulidity_transport::blob_transport::append(&mut owner.id,500,one,f.sc.ctx());transfer::transfer(owner,@0xa);end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::blob_transport)]
fun custody_rejects_document_kind_collision_with_asset_pages(){let mut f=setup();let mut owner=CustodyOwner{id:object::new(f.sc.ctx())};let one=storage_fixture::blob(&mut f.sys,8000,false,true,f.sc.ctx());soulidity_transport::blob_transport::add_document(&mut owner.id,2,one);transfer::transfer(owner,@0xa);end(f)}

#[test]
fun directory_index_exact_positions_for_five_hundred_shared_prefixes(){
    let (rows,invalid)=publication_rules::expected_assets(&vector[projection_definition(250,500,true),projection_definition(0,250,true)]);assert!(invalid==0 && rows.length()==500,570);
    let mut i=0u64;while(i < 500){assert!(publication_rules::expected_index(&rows,prefix_digest(i))==option::some(i),571);i=i+1};assert!(publication_rules::expected_index(&rows,prefix_digest(500)).is_none(),572)
}
