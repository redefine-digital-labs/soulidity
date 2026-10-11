/// Thin namespace adapter to the sole Maker leaf implementation.
/// Types are canonical leaf types; this unpublished target is not old published ABI compatibility.
module soulidity_application::issuance;
use std::type_name::{Self,TypeName};
use soulidity_foundation::economics::{Self,Config,PrimaryReceipt};
use soulidity_standard::soul::{Self,Soul};
use soulidity_model::policy;
use soulidity_maker_admission::maker_issuance::{Self as leaf,Binding,Genesis,Contribution};
public fun bind<C,W:drop,R:drop,O:drop>(cfg:&Config<C>,_w:W,_r:R,_operator:O):Binding {leaf::bind<C,W,R,O>(cfg,_w,_r,_operator)}
#[test_only]
public fun authorize_genesis<C,W:drop,R:drop,P:key>(cfg:&Config<C>,w:W,r:R,p:&P,root:&Soul,binding:Binding,metadata:vector<u8>,ctx:&TxContext):Genesis {leaf::authorize_genesis<C,W,R,P>(cfg,w,r,p,root,binding,metadata,ctx)}
public fun consume_genesis(g:Genesis,root:&Soul,metadata:vector<u8>,ctx:&TxContext):(ID,TypeName) {leaf::consume_genesis(g,root,metadata,ctx)}
#[test_only]
public fun authorize_contribution<C,W:drop,R:drop,P:key>(cfg:&Config<C>,w:W,r:R,p:&P,root:&Soul,version:u64,policy:vector<u8>,payment:PrimaryReceipt,ctx:&TxContext):Contribution {leaf::authorize_contribution<C,W,R,P>(cfg,w,r,p,root,version,policy,payment,ctx)}
public fun consume_contribution(c:Contribution,root:&Soul,ctx:&TxContext):(ID,u64,vector<u8>,PrimaryReceipt) {leaf::consume_contribution(c,root,ctx)}
