/// Business construction custody, independent of the Standard kernel.
/// Private producer witness + actual source + linear request jointly authorize
/// allocation. Soul never leaves by value until source completion is consumed.
module soulidity_custody::lifecycle;
use std::type_name::{Self,TypeName};
use soulidity_standard::soul::{Self as soul,Soul,Creation,Origin,Descriptor,ModuleVersion};
use soulidity_origin_protocol::producer_origin::{Self as origin,OriginRequest,Snapshot,CompletionAuthorization};
const EIdentity:u64=9;const EConstruction:u64=11;const EHandover:u64=12;
const EAuthority:u64=3;const EInput:u64=5;const ECapacity:u64=7;
const ELegacyExtensions:u64=13;const EKioskLayout:u64=14;
public struct Construction {root:Creation,root_id:ID,fixed_origin:Origin,request:Snapshot,actor:address,obligations:vector<Obligation>}
public struct ParentDelivery {root:Creation,root_id:ID,fixed_origin:Origin,actor:address,obligations:vector<Obligation>}
public struct Obligation has copy,drop {root:ID,origin:Origin,fresh:bool}
fun attested(s:&Soul,q:&Snapshot){let o=soul::origin(s);assert!(soul::producer(&o)==origin::producer(q) && soul::source_type(&o)==origin::source_type(q) && soul::source(&o)==origin::source(q) && soul::source_version(&o)==origin::version(q) && soul::source_hash(&o)==origin::policy(q) && soul::minted_by(&o)==origin::actor(q),EIdentity)}
public fun new<W:drop,P:key>(w:W,p:&P,request:OriginRequest,ctx:&mut TxContext):Construction{
 let request=origin::consume_request<Soul>(request,ctx);assert!(origin::operation(&request)==0,EConstruction);
 let root=soul::new(w,p,origin::version(&request),origin::policy(&request),origin::name(&request),ctx);attested(soul::creation_ref(&root),&request);
 let root_id=soul::creation_id(&root);let fixed_origin=soul::origin(soul::creation_ref(&root));Construction{root,root_id,fixed_origin,request,actor:ctx.sender(),obligations:vector[Obligation{root:root_id,origin:fixed_origin,fresh:true}]}
}
fun pinned(root:&Soul,id:ID,o:Origin){assert!(object::id(root)==id && soul::origin(root)==o,EIdentity)}
fun pinned_construction(c:&Construction){pinned(soul::creation_ref(&c.root),c.root_id,c.fixed_origin);attested(soul::creation_ref(&c.root),&c.request);assert!(c.actor==origin::actor(&c.request),EConstruction)}
fun pinned_parent(p:&ParentDelivery){pinned(soul::creation_ref(&p.root),p.root_id,p.fixed_origin)}
public fun construction_ref(c:&Construction):&Soul{pinned_construction(c);soul::creation_ref(&c.root)}
public fun construction_mut(c:&mut Construction):&mut Creation{pinned_construction(c);&mut c.root}
public fun construction_id(c:&Construction):ID{pinned_construction(c);c.root_id}
public fun construction_snapshot(c:&Construction):Snapshot{pinned_construction(c);c.request}
public fun borrow_construction(c:&Construction):&Soul{construction_ref(c)}
public fun borrow_construction_mut(c:&mut Construction):&mut Creation{construction_mut(c)}
fun reachable_origin(s:&Soul,id:ID):Option<Origin>{
 if(object::id(s)==id)return option::some(soul::origin(s));
 let ds=soul::module_page(s,0,64);let mut i=0;while(i < ds.length()){let d=&ds[i];if(soul::namespace(d)==type_name::with_defining_ids<soul::NestedSoulWitness>()){
 assert!(soul::value_type(d)==type_name::with_defining_ids<Soul>(),EIdentity);let child=soul::nested(s,soul::module_id(d));let found=reachable_origin(child,id);if(found.is_some())return found
 };i=i+1};option::none()
}
fun closure(s:&Soul,obligations:&vector<Obligation>){obligations.do_ref!(|o|{let found=reachable_origin(s,o.root);assert!(found.is_some() && found.destroy_some()==o.origin,EConstruction)})}
fun fresh(s:&Soul,obligations:&vector<Obligation>):bool{obligations.any!(|o|o.fresh && o.root==object::id(s) && o.origin==soul::origin(s))}
fun existing_protected(s:&Soul,obligations:&vector<Obligation>):bool{
 if(has_policy(s) && !fresh(s,obligations))return true;let ds=soul::module_page(s,0,64);let mut i=0;while(i < ds.length()){let d=&ds[i];if(soul::namespace(d)==type_name::with_defining_ids<soul::NestedSoulWitness>() && existing_protected(soul::nested(s,soul::module_id(d)),obligations))return true;i=i+1};false
}
fun merge(out:&mut vector<Obligation>,mut incoming:vector<Obligation>){while(!incoming.is_empty())out.push_back(incoming.pop_back());incoming.destroy_empty()}
public fun deliver(c:Construction,completion:CompletionAuthorization,recipient:address,ctx:&TxContext):ID{
 pinned_construction(&c);assert!(c.actor==ctx.sender(),EConstruction);closure(soul::creation_ref(&c.root),&c.obligations);assert!(recipient==c.actor || !existing_protected(soul::creation_ref(&c.root),&c.obligations),EHandover);origin::consume_delivery(completion,soul::creation_ref(&c.root),&c.request,ctx);
 let Construction{root,root_id,fixed_origin:_,request:_,actor:_,obligations:_}=c;soul::creation_deliver(root,recipient);root_id
}
public fun nest_construction(parent:&mut Construction,child:Construction,completion:CompletionAuthorization,expected:u64,ctx:&TxContext){
 pinned_construction(parent);pinned_construction(&child);assert!(parent.actor==ctx.sender() && child.actor==parent.actor,EConstruction);closure(soul::creation_ref(&child.root),&child.obligations);origin::consume_delivery(completion,soul::creation_ref(&child.root),&child.request,ctx);let Construction{root,root_id:_,fixed_origin:_,request:_,actor:_,obligations}=child;soul::creation_nest(&mut parent.root,root,expected);merge(&mut parent.obligations,obligations)
}
public fun nest_into_parent(mut parent:Soul,child:Construction,completion:CompletionAuthorization,expected:u64,ctx:&TxContext):ParentDelivery{
 pinned_construction(&child);assert!(child.actor==ctx.sender(),EConstruction);closure(soul::creation_ref(&child.root),&child.obligations);origin::consume_delivery(completion,soul::creation_ref(&child.root),&child.request,ctx);let root_id=object::id(&parent);let fixed_origin=soul::origin(&parent);let mut parent=soul::hold_owned(parent);let Construction{root,root_id:_,fixed_origin:_,request:_,actor:_,obligations}=child;soul::creation_nest(&mut parent,root,expected);let mut all=vector[Obligation{root:root_id,origin:fixed_origin,fresh:false}];merge(&mut all,obligations);ParentDelivery{root:parent,root_id,fixed_origin,actor:ctx.sender(),obligations:all}
}
public fun parent_ref(p:&ParentDelivery):&Soul{pinned_parent(p);soul::creation_ref(&p.root)}
public fun parent_mut(p:&mut ParentDelivery):&mut Creation{pinned_parent(p);&mut p.root}
public fun parent_id(p:&ParentDelivery):ID{pinned_parent(p);p.root_id}
public fun nest_into_delivery(parent:&mut ParentDelivery,child:Construction,completion:CompletionAuthorization,expected:u64,ctx:&TxContext){
 pinned_parent(parent);pinned_construction(&child);assert!(parent.actor==ctx.sender() && child.actor==parent.actor,EConstruction);closure(soul::creation_ref(&child.root),&child.obligations);origin::consume_delivery(completion,soul::creation_ref(&child.root),&child.request,ctx);let Construction{root,root_id:_,fixed_origin:_,request:_,actor:_,obligations}=child;soul::creation_nest(&mut parent.root,root,expected);merge(&mut parent.obligations,obligations)
}
public fun deliver_parent(p:ParentDelivery,recipient:address,ctx:&TxContext):ID{pinned_parent(&p);assert!(p.actor==ctx.sender(),EConstruction);closure(soul::creation_ref(&p.root),&p.obligations);assert!(recipient==p.actor || !existing_protected(soul::creation_ref(&p.root),&p.obligations),EHandover);let ParentDelivery{root,root_id,fixed_origin:_,actor:_,obligations:_}=p;soul::creation_deliver(root,recipient);root_id}
public fun nest_parent_delivery(parent:&mut Construction,child:ParentDelivery,expected:u64,ctx:&TxContext){pinned_construction(parent);pinned_parent(&child);assert!(parent.actor==ctx.sender() && child.actor==parent.actor,EConstruction);closure(soul::creation_ref(&child.root),&child.obligations);let ParentDelivery{root,root_id:_,fixed_origin:_,actor:_,obligations}=child;soul::creation_nest(&mut parent.root,root,expected);merge(&mut parent.obligations,obligations)}
/// Fresh native terminal uses only the sealed Standard authority. A raw cap
/// can be imported into Account, but is never returned after new issuance.
public fun deliver_locked_authority(c:Construction,completion:CompletionAuthorization,k:&mut sui::kiosk::Kiosk,a:&mut soulidity_standard::native_authority::Authority,p:&sui::transfer_policy::TransferPolicy<Soul>,ctx:&TxContext):ID {
 pinned_construction(&c);assert!(ctx.sender()==c.actor,EConstruction);
 closure(soul::creation_ref(&c.root),&c.obligations);
 assert!(!existing_protected(soul::creation_ref(&c.root),&c.obligations),EHandover);
 origin::consume_delivery(completion,soul::creation_ref(&c.root),&c.request,ctx);
 let Construction{root,root_id,fixed_origin:_,request:_,actor:_,obligations:_}=c;
 let id=soul::creation_lock(root,k,a,p,ctx);assert!(id==root_id,EIdentity);id
}
/// Source completion and all fresh descendant obligations remain mandatory.
/// Existing protected descendants use their controlled handover journey instead.
public fun nest_locked_authority(
 c:Construction,completion:CompletionAuthorization,k:&mut sui::kiosk::Kiosk,
 a:&mut soulidity_standard::native_authority::Authority,parent:ID,parent_origin:Origin,
 expected:u64,ctx:&TxContext,
):ID {
 pinned_construction(&c);assert!(c.actor==ctx.sender(),EConstruction);
 closure(soul::creation_ref(&c.root),&c.obligations);
 assert!(!existing_protected(soul::creation_ref(&c.root),&c.obligations),EHandover);
 origin::consume_delivery(completion,soul::creation_ref(&c.root),&c.request,ctx);
 let Construction{root,root_id,fixed_origin:_,request:_,actor:_,obligations:_}=c;
 let id=soul::creation_nest_locked(root,k,a,parent,parent_origin,expected,ctx);
 assert!(id==root_id,EIdentity);id
}
public fun assert_legacy_disabled(k:&sui::kiosk::Kiosk){let bytes=std::bcs::to_bytes(k);assert!(bytes.length()==77,EKioskLayout);let mut b=sui::bcs::new(bytes);let uid=b.peel_address();let profits=b.peel_u64();let owner=b.peel_address();let count=b.peel_u32();let flag=b.peel_u8();assert!(flag<=1 && b.into_remainder_bytes().is_empty(),EKioskLayout);assert!(uid==object::id(k).to_address() && profits==sui::kiosk::profits_amount(k) && owner==sui::kiosk::owner(k) && count==sui::kiosk::item_count(k),EKioskLayout);assert!(flag==0,ELegacyExtensions)}

/// Lifecycle-owned declaration, authenticated by the source namespace/type witness.
/// The kernel treats these bytes as opaque metadata. Permanent passive modules
/// remain outside the handover duty set; known source and topology history is required.
public struct Duty has copy,drop,store {namespace:TypeName,name:vector<u8>,value:TypeName,object:ID,schema:u16}
fun declaration(removable:bool):vector<u8>{let mut bytes=b"soulidity.lifecycle/handover:v1";bytes.push_back(if(removable)1 else 0);bytes}
fun declared(bytes:&vector<u8>):bool{let prefix=b"soulidity.lifecycle/handover:v1";if(bytes.length()!=prefix.length()+1 || bytes[prefix.length()]>1)return false;let mut i=0;while(i < prefix.length()){if(bytes[i]!=prefix[i])return false;i=i+1};true}
/// Original source intent is preserved independently of physical kernel removal.
/// A protected installation remains physically nonremovable to preserve its
/// original handover prohibition; callers needing the source flag use this getter.
public fun protected_removable_intent(s:&Soul,d:&Descriptor):Option<bool>{let a=soul::module_annotation(s,d);if(a.is_some() && declared(a.borrow())){let bytes=a.destroy_some();option::some(bytes[bytes.length()-1]==1)}else option::none()}
fun has_policy(s:&Soul):bool{soul::module_page(s,0,64).any!(|d|handover_required(s,d))}
fun same_module<W,T>(){let w=type_name::with_original_ids<W>();let t=type_name::with_original_ids<T>();assert!(!w.is_primitive() && !t.is_primitive() && w.address_string()==t.address_string() && w.module_string()==t.module_string(),EAuthority)}
fun duty(d:&Descriptor):Duty{Duty{namespace:soul::namespace(d),name:soul::module_name(d),value:soul::value_type(d),object:soul::module_id(d),schema:soul::module_schema(d)}}
public fun handover_required(s:&Soul,d:&Descriptor):bool{let a=soul::module_annotation(s,d);a.is_some() && declared(a.borrow())}
public fun install_protected<W:drop,T:key+store>(s:&mut Soul,w:W,name:vector<u8>,v:T,schema:u16,removable:bool,semantic:vector<u8>,expected:u64){soul::install_annotated(s,w,name,v,schema,false,semantic,expected,declaration(removable))}
public fun install_creation_protected<W:drop,T:key+store>(s:&mut Creation,w:W,name:vector<u8>,v:T,schema:u16,removable:bool,semantic:vector<u8>,expected:u64){soul::creation_install_annotated(s,w,name,v,schema,false,semantic,expected,declaration(removable))}
public struct Handover {root:Creation,nodes:vector<Node>,duties:vector<Required>}
public struct Node has copy,drop {soul:ID,origin:Origin,parent:Option<ID>,name:vector<u8>,topology:Option<u64>}
public struct Required has copy,drop {soul:ID,binding:Duty,acknowledged:Option<Descriptor>,version:Option<ModuleVersion>}
fun lookup(s:&Soul,d:&Duty):Descriptor{let ds=soul::module_page(s,0,64);let mut i=0;while(i < ds.length()){if(duty(&ds[i])==*d)return ds[i];i=i+1};abort EHandover}
fun collect(s:&Soul,parent:Option<ID>,name:vector<u8>,depth:u64,nodes:&mut vector<Node>,duties:&mut vector<Required>){assert!(depth <= 16 && nodes.length() < 256,ECapacity);assert!(soul::nesting_revision(s).is_some(),EHandover);nodes.push_back(Node{soul:object::id(s),origin:soul::origin(s),parent,name,topology:soul::nesting_revision(s)});soul::module_page(s,0,64).do_ref!(|d|{if(handover_required(s,d)){let v=soul::module_version(s,d);assert!(v.is_some() && soul::installed_revision(v.borrow())>0,EHandover);duties.push_back(Required{soul:object::id(s),binding:duty(d),acknowledged:option::none(),version:option::none()})}});soul::module_page(s,0,64).do_ref!(|d|{if(soul::namespace(d)==type_name::with_defining_ids<soul::NestedSoulWitness>()){assert!(soul::nesting_revision(s).is_some(),EHandover);collect(soul::nested(s,soul::module_id(d)),option::some(object::id(s)),soul::module_name(d),depth+1,nodes,duties)}})}
public fun begin_handover(root:Soul):Handover{begin_creation_handover(soul::hold_owned(root))}
fun begin_creation_handover(root:Creation):Handover{let mut nodes=vector[];let mut duties=vector[];collect(soul::creation_ref(&root),option::none(),vector[],0,&mut nodes,&mut duties);Handover{root,nodes,duties}}
public fun handover_ref(h:&Handover):&Soul{soul::creation_ref(&h.root)}
public fun handover_mut(h:&mut Handover):&mut Creation{&mut h.root}
public fun handover_id(h:&Handover):ID{object::id(soul::creation_ref(&h.root))}
fun current(h:&Handover):vector<Required>{let mut nodes=vector[];let mut duties=vector[];collect(soul::creation_ref(&h.root),option::none(),vector[],0,&mut nodes,&mut duties);assert!(nodes==h.nodes && duties.length()==h.duties.length(),EHandover);duties.do_ref!(|d|{assert!(h.duties.any!(|x|x.soul==d.soul && x.binding==d.binding),EHandover)});duties}
fun ack_tree<W,T:key+store>(s:&Soul,name:&vector<u8>,schema:u16,ds:&mut vector<Required>){let descriptor=soul::descriptor<W>(s,*name);if(descriptor.is_some()){let d=descriptor.destroy_some();assert!(soul::value_type(&d)==type_name::with_defining_ids<T>() && soul::module_schema(&d)==schema && handover_required(s,&d),EHandover);let v=soul::borrow_module<W,T>(s,*name);assert!(std::hash::sha3_256(std::bcs::to_bytes(v))==soul::body_hash(&d),EHandover);let mut i=0;while(i < ds.length()){if(ds[i].soul==object::id(s) && ds[i].binding==duty(&d)){let v=soul::module_version(s,&d);assert!(v.is_some() && soul::installed_revision(v.borrow())>0,EHandover);ds[i].acknowledged=option::some(d);ds[i].version=v};i=i+1}};soul::module_page(s,0,64).do_ref!(|d|{if(soul::namespace(d)==type_name::with_defining_ids<soul::NestedSoulWitness>())ack_tree<W,T>(soul::nested(s,soul::module_id(d)),name,schema,ds)})}
public fun acknowledge_handover<W:drop,T:key+store>(h:&mut Handover,w:W,name:vector<u8>,schema:u16){same_module<W,T>();let _=w;let _=current(h);ack_tree<W,T>(soul::creation_ref(&h.root),&name,schema,&mut h.duties)}
fun validate(h:&Handover){current(h).do_ref!(|d|{let mut i=0;let mut good=false;while(i < h.duties.length()){let a=&h.duties[i];if(a.soul==d.soul && a.binding==d.binding && a.acknowledged.is_some()){let actual=reachable_descriptor(soul::creation_ref(&h.root),d.soul,&d.binding).destroy_some();let v=reachable_version(soul::creation_ref(&h.root),d.soul,&d.binding);good=*a.acknowledged.borrow()==actual && a.version.is_some() && v.is_some() && *a.version.borrow()==*v.borrow()};i=i+1};assert!(good,EHandover)})}
fun reachable_descriptor(s:&Soul,id:ID,binding:&Duty):Option<Descriptor>{if(object::id(s)==id)return option::some(lookup(s,binding));let ds=soul::module_page(s,0,64);let mut i=0;while(i < ds.length()){if(soul::namespace(&ds[i])==type_name::with_defining_ids<soul::NestedSoulWitness>()){let found=reachable_descriptor(soul::nested(s,soul::module_id(&ds[i])),id,binding);if(found.is_some())return found};i=i+1};option::none()}
fun reachable_version(s:&Soul,id:ID,binding:&Duty):Option<ModuleVersion>{if(object::id(s)==id){let d=lookup(s,binding);return soul::module_version(s,&d)};let ds=soul::module_page(s,0,64);let mut i=0;while(i < ds.length()){if(soul::namespace(&ds[i])==type_name::with_defining_ids<soul::NestedSoulWitness>()){let found=reachable_version(soul::nested(s,soul::module_id(&ds[i])),id,binding);if(found.is_some())return found};i=i+1};option::none()}
public fun finish_handover(h:Handover,recipient:address):ID{assert!(recipient!=@0x0,EInput);validate(&h);let Handover{root,nodes:_,duties:_}=h;soul::creation_deliver(root,recipient)}
public fun finish_handover_place(h:Handover,k:&mut sui::kiosk::Kiosk,cap:&sui::kiosk::KioskOwnerCap):ID{validate(&h);let Handover{root,nodes:_,duties:_}=h;soul::creation_place_owned(root,k,cap)}
public fun begin_construction_handover(c:Construction,completion:CompletionAuthorization,ctx:&TxContext):Handover{pinned_construction(&c);assert!(c.actor==ctx.sender(),EConstruction);closure(soul::creation_ref(&c.root),&c.obligations);origin::consume_delivery(completion,soul::creation_ref(&c.root),&c.request,ctx);let Construction{root,root_id:_,fixed_origin:_,request:_,actor:_,obligations:_}=c;begin_creation_handover(root)}
public fun begin_parent_handover(p:ParentDelivery,ctx:&TxContext):Handover{pinned_parent(&p);assert!(p.actor==ctx.sender(),EConstruction);closure(soul::creation_ref(&p.root),&p.obligations);let ParentDelivery{root,root_id:_,fixed_origin:_,actor:_,obligations:_}=p;begin_creation_handover(root)}
#[test_only]
public fun swap_roots_for_testing(a:Construction,b:Construction):(Construction,Construction){let Construction{root:ar,root_id:ai,fixed_origin:ao,request:aq,actor:aa,obligations:az}=a;let Construction{root:br,root_id:bi,fixed_origin:bo,request:bq,actor:ba,obligations:bz}=b;(Construction{root:br,root_id:ai,fixed_origin:ao,request:aq,actor:aa,obligations:az},Construction{root:ar,root_id:bi,fixed_origin:bo,request:bq,actor:ba,obligations:bz})}

/// Test-only raw fixture, unavailable in production bytecode.
#[test_only]
public fun raw_from_request_for_testing<W:drop,P:key>(w:W,p:&P,request:OriginRequest,ctx:&mut TxContext):Soul{let Construction{root,root_id:_,fixed_origin:_,request:_,actor:_,obligations:_}=new(w,p,request,ctx);soul::creation_raw_for_testing(root)}

public fun finish_handover_place_authority(h:Handover,k:&mut sui::kiosk::Kiosk,a:&soulidity_standard::native_authority::Authority,ctx:&TxContext):ID {
 validate(&h);let Handover{root,nodes:_,duties:_}=h;soul::creation_place_owned_authority(root,k,a,ctx)
}

/// Original negative regression fixture bridges; never D26 acceptance paths.
#[test_only]
public fun construction_raw_mut_for_testing(c:&mut Construction):&mut Soul {soul::creation_raw_mut_for_testing(&mut c.root)}
#[test_only]
public fun handover_raw_mut_for_testing(h:&mut Handover):&mut Soul {soul::creation_raw_mut_for_testing(&mut h.root)}
#[test_only]
public fun parent_raw_mut_for_testing(p:&mut ParentDelivery):&mut Soul {soul::creation_raw_mut_for_testing(&mut p.root)}
