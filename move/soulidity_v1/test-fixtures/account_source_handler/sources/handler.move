/// Independent protected lifecycle source: no Application or Core dependency.
module account_source_handler::handler;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_custody::lifecycle::{Self,Handover};
public struct SourceWitness has drop {}
public struct State has key,store {id:UID,generation:u64}
public fun install(s:&mut Soul,ctx:&mut TxContext) {
    let value=State{id:object::new(ctx),generation:0};let hash=std::hash::sha3_256(std::bcs::to_bytes(&value));
    let rev=standard::revision(s);lifecycle::install_protected(s,SourceWitness{},b"independent",value,1,false,hash,rev)
}
public fun generation(s:&Soul):u64 { standard::borrow_module<SourceWitness,State>(s,b"independent").generation }
fun rotate(s:&mut standard::Creation) {
    if(standard::descriptor<SourceWitness>(standard::creation_ref(s),b"independent").is_some()) {
        let rev=standard::revision(standard::creation_ref(s));let(mut state,ticket)=standard::creation_begin_update<SourceWitness,State>(s,SourceWitness{},b"independent",rev);
        state.generation=state.generation+1;let hash=std::hash::sha3_256(std::bcs::to_bytes(&state));
        standard::creation_commit_update(s,ticket,SourceWitness{},state,1,hash)
    };
    let entries=standard::module_page(standard::creation_ref(s),0,64);
    entries.do_ref!(|d| { if(standard::namespace(d)==std::type_name::with_defining_ids<standard::NestedSoulWitness>()) {
        let name=standard::module_id(d);let rev=standard::revision(standard::creation_ref(s));
        let(mut child,ticket)=standard::creation_begin_nested_update(s,name,rev);rotate(&mut child);standard::creation_commit_nested_update(s,ticket,child)
    }})
}
public fun acknowledge(h:&mut Handover) {rotate(lifecycle::handover_mut(h));lifecycle::acknowledge_handover<SourceWitness,State>(h,SourceWitness{},b"independent",1)}
public fun attempt_foreign_withdraw(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,id:ID,ctx:&TxContext):ID {
    let mut h=soulidity_custody::account::begin_source_withdraw<SourceWitness,State>(SourceWitness{},k,a,id,ctx);
    acknowledge(soulidity_custody::account::handover_mut(&mut h));
    soulidity_custody::account::finish_source_withdraw<SourceWitness,State>(SourceWitness{},k,a,h,ctx)
}
