/// Embedded configuration value, not a separate administrator or global registry.
/// The owning Config must keep its mutable State private and authorize every edit.
module soulidity_foundation::package_roles;
use std::type_name::{Self,TypeName};
use sui::package::{Self,Publisher,UpgradeCap};
const ERole:u64=1;
const EProof:u64=2;
const ETransition:u64=3;
public struct Role has copy,drop,store {
    original:ID,callable:ID,marker:Option<TypeName>,version:u64,pinned:bool,frozen:bool,
}
public struct State has copy,drop,store {roles:vector<Role>}
/// Frozen release metadata. Possession is not Config administration, package
/// upgrade authority or a business witness. Only this module packs the fields.
public struct RoleCertificate<phantom W,phantom R> has key,store {
    id:UID,kind:u8,role:Role,
}
/// The private Config constructor supplies its real initial deployment identity.
/// Creating a detached State confers no authority over any existing Config.
public fun initial(original:ID,callable:ID):State {
    let r=Role{original,callable,marker:option::none(),version:1,pinned:false,frozen:false};
    State{roles:vector[r,r,r,r,r,r]}
}
fun names<W,R>(kind:u8) {
    assert!(kind < 6,ERole);let w=type_name::with_original_ids<W>();let r=type_name::with_defining_ids<R>();
    assert!(!w.is_primitive() && !r.is_primitive(),ERole);
    let role_module=if(kind==0)b"native_binding" else if(kind==1)b"maker_release" else if(kind==2)b"maker_catalog" else if(kind==3)b"market" else if(kind==4)b"collection" else b"paid_access";
    let installer=if(kind==0)b"NativeInstaller1" else if(kind==1)b"ReleaseInstaller1" else if(kind==2)b"CreatorAuthority1" else if(kind==3)b"MarketAuthority1" else if(kind==4)b"CollectionAuthority1" else b"PaidAuthority1";
    let prefix=if(kind==0)b"NativeRevision" else if(kind==1)b"ReleaseRevision" else if(kind==2)b"CreatorRevision" else if(kind==3)b"MarketRevision" else if(kind==4)b"CollectionRevision" else b"PaidRevision";
    assert!(*w.module_string().as_bytes()==role_module && *w.datatype_string().as_bytes()==installer
        && *r.module_string().as_bytes()==role_module,ERole);
    let name=r.datatype_string().into_bytes();assert!(name.length()>prefix.length(),ERole);
    let mut i=0;while(i < prefix.length()){assert!(name[i]==prefix[i],ERole);i=i+1};
    assert!(name[i]>=49 && name[i]<=57,ERole);
    while(i < name.length()){assert!(name[i]>=48 && name[i]<=57,ERole);i=i+1}
}
public fun role(s:&State,kind:u8):Role {assert!(kind < 6,ERole);s.roles[kind as u64]}
public fun original(r:&Role):ID {r.original}
public fun callable(r:&Role):ID {r.callable}
public fun marker(r:&Role):Option<TypeName> {r.marker}
public fun version(r:&Role):u64 {r.version}
public fun pinned(r:&Role):bool {r.pinned}
public fun frozen(r:&Role):bool {r.frozen}
/// Publisher proves the stable installer module. UpgradeCap proves the actual
/// lineage and latest package; a freshly introduced revision type proves that
/// callable package. New types introduced by upgrades have new type origins.
public fun register<W:drop,R:drop>(s:&mut State,kind:u8,_installer:W,_revision:R,p:&Publisher,cap:&UpgradeCap) {
    let certified=proved_role<W,R>(kind,p,cap);
    select_role(s,kind,certified)
}
fun proved_role<W,R>(kind:u8,p:&Publisher,cap:&UpgradeCap):Role {
    names<W,R>(kind);assert!(package::from_module<W>(p),EProof);
    let original=object::id_from_address(type_name::original_id<W>());
    let callable=object::id_from_address(type_name::defining_id<R>());
    let latest=package::upgrade_package(cap);let version=package::version(cap);
    assert!(latest.to_address()!=@0x0 && version>0 && latest==callable,EProof);
    let root=if(version==1)latest else package::original_package_id(cap);
    assert!(root==original,EProof);
    Role{original,callable,marker:option::some(type_name::with_defining_ids<R>()),version,pinned:true,frozen:false}
}
fun select_role(s:&mut State,kind:u8,next:Role) {
    let old=role(s,kind);assert!(!old.frozen,ETransition);
    if(old.pinned)assert!(next.original==old.original && next.version>old.version
        && next.callable!=old.callable && next.marker!=old.marker,ETransition);
    *s.roles.borrow_mut(kind as u64)=next
}
/// The actual installer module injects both private values. Publisher and latest
/// UpgradeCap are borrowed only while attesting this release; never stored.
public fun attest_role<W:drop,R:drop>(kind:u8,_installer:W,_revision:R,p:&Publisher,cap:&UpgradeCap,ctx:&mut TxContext):ID {
    let role=proved_role<W,R>(kind,p,cap);
    let certificate=RoleCertificate<W,R>{id:object::new(ctx),kind,role};
    let id=object::id(&certificate);transfer::freeze_object(certificate);id
}
public fun certificate_kind<W,R>(c:&RoleCertificate<W,R>):u8{c.kind}
public fun certificate_role<W,R>(c:&RoleCertificate<W,R>):Role{c.role}
public fun assert_certificate<W,R>(c:&RoleCertificate<W,R>,kind:u8) {
    names<W,R>(kind);assert!(c.kind==kind && c.role.pinned && !c.role.frozen
        && c.role.version>0 && c.role.original==object::id_from_address(type_name::original_id<W>())
        && c.role.callable==object::id_from_address(type_name::defining_id<R>())
        && c.role.marker==option::some(type_name::with_defining_ids<R>()),EProof)
}
public fun register_from_certificate<W:drop,R:drop>(s:&mut State,kind:u8,_installer:W,_revision:R,c:&RoleCertificate<W,R>) {
    assert_certificate(c,kind);select_role(s,kind,c.role)
}
public fun assert_types<W,R>(s:&State,kind:u8) {
    names<W,R>(kind);let r=role(s,kind);
    assert!(r.original==object::id_from_address(type_name::original_id<W>())
        && r.callable==object::id_from_address(type_name::defining_id<R>())
        && (r.marker.is_none() || *r.marker.borrow()==type_name::with_defining_ids<R>()),EProof)
}
public fun assert_identity(s:&State,kind:u8,original:ID,callable:ID) {
    let r=role(s,kind);assert!(r.original==original && r.callable==callable,EProof)
}
/// First installation pins the original role lineage even without a later edit.
public fun pin(s:&mut State,kind:u8,marker:TypeName) {assert!(kind < 6,ERole);let r=s.roles.borrow_mut(kind as u64);assert!(r.marker.is_none() || *r.marker.borrow()==marker,EProof);r.marker=option::some(marker);r.pinned=true}
/// Locks this Config's role selection. Does not destroy an UpgradeCap or make
/// code immutable, and does not disable recovery/withdrawal on the parent.
public fun freeze_role(s:&mut State,kind:u8) {
    let r=role(s,kind);assert!(r.pinned && !r.frozen,ETransition);s.roles.borrow_mut(kind as u64).frozen=true
}

#[test_only]
public fun pin_business_bootstrap_for_testing(s:&mut State){let mut i=2;while(i < 6){s.roles.borrow_mut(i).pinned=true;i=i+1}}

/// Unit fixtures only: model the distinct initial deployment addresses before
/// any role is pinned. Production must use Publisher + UpgradeCap registration.
#[test_only]
public fun initial_role_for_testing<W,R>(s:&mut State,kind:u8){names<W,R>(kind);assert!(!s.roles[kind as u64].pinned,ETransition);*s.roles.borrow_mut(kind as u64)=Role{original:object::id_from_address(type_name::original_id<W>()),callable:object::id_from_address(type_name::defining_id<R>()),marker:option::some(type_name::with_defining_ids<R>()),version:1,pinned:false,frozen:false}}

/// Unpublished 0x0 VM fixture only. It does not attest chain init, Publisher or
/// UpgradeCap provenance. Production certificates always use proved_role.
#[test_only]
public fun certificate_for_testing<W,R>(kind:u8,version:u64,ctx:&mut TxContext):ID {
    names<W,R>(kind);let role=Role{original:object::id_from_address(type_name::original_id<W>()),callable:object::id_from_address(type_name::defining_id<R>()),marker:option::some(type_name::with_defining_ids<R>()),version,pinned:true,frozen:false};
    let c=RoleCertificate<W,R>{id:object::new(ctx),kind,role};let id=object::id(&c);transfer::freeze_object(c);id
}
