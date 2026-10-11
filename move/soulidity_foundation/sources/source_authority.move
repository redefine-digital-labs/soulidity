/// Typed source revision metadata. A detached value grants no authority:
/// the Config must keep its typed slot private and authorize every transition.
module soulidity_foundation::source_authority;
use std::type_name::{Self,TypeName};
use sui::package::{Self,Publisher,UpgradeCap};
const EType:u64=1;const EProof:u64=2;const ETransition:u64=3;
public struct Revision has copy,drop,store {original:ID,callable:ID,marker:TypeName,version:u64}
fun names<W,R,T>(){
    let w=type_name::with_original_ids<W>();let t=type_name::with_original_ids<T>();let r=type_name::with_defining_ids<R>();
    assert!(!w.is_primitive() && !t.is_primitive() && !r.is_primitive(),EType);
    assert!(w.address_string()==t.address_string() && w.module_string()==t.module_string()
        && *w.datatype_string().as_bytes()==b"SoulProducer" && w.module_string()==r.module_string(),EType);
    let name=r.datatype_string().into_bytes();let prefix=b"SourceRevision";assert!(name.length()>prefix.length(),EType);
    let mut i=0;while(i < prefix.length()){assert!(name[i]==prefix[i],EType);i=i+1};
    assert!(name[i]>=49 && name[i]<=57,EType);while(i < name.length()){assert!(name[i]>=48 && name[i]<=57,EType);i=i+1}
}
/// Both witnesses are real private values, not text or copyable metadata.
/// The package proof pins the actual latest callable and stable producer lineage.
public fun advance<W:drop,R:drop,T:key>(previous:Option<Revision>,_w:W,_r:R,p:&Publisher,cap:&UpgradeCap):Revision{
    names<W,R,T>();assert!(package::from_module<W>(p),EProof);
    let original=object::id_from_address(type_name::original_id<W>());let callable=object::id_from_address(type_name::defining_id<R>());
    let version=package::version(cap);let latest=package::upgrade_package(cap);
    assert!(version>0 && latest.to_address()!=@0x0 && latest==callable,EProof);
    assert!((if(version==1)latest else package::original_package_id(cap))==original,EProof);
    let marker=type_name::with_defining_ids<R>();
    if(previous.is_some()){
        let old=previous.destroy_some();assert!(old.original==original && version>old.version && callable!=old.callable && marker!=old.marker,ETransition)
    };
    Revision{original,callable,marker,version}
}
public fun assert_types<W,R,T>(r:&Revision){
    names<W,R,T>();assert!(r.original==object::id_from_address(type_name::original_id<W>())
        && r.callable==object::id_from_address(type_name::defining_id<R>()) && r.marker==type_name::with_defining_ids<R>(),EProof)
}
public fun original(r:&Revision):ID{r.original}
public fun callable(r:&Revision):ID{r.callable}
public fun marker(r:&Revision):TypeName{r.marker}
public fun version(r:&Revision):u64{r.version}
/// Unit-only type-domain model. Does not claim Publisher/Cap or chain upgrade proof.
#[test_only]
public fun model_for_testing<W,R,T>(version:u64):Revision{
    names<W,R,T>();assert!(version>0,ETransition);
    Revision{original:object::id_from_address(type_name::original_id<W>()),callable:object::id_from_address(type_name::defining_id<R>()),marker:type_name::with_defining_ids<R>(),version}
}
