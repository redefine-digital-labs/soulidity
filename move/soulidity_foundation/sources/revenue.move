/// Canonical root-bound income ledger. Mutations require the owning module's actual private UID, not a declared ID.
module soulidity_foundation::revenue;
use sui::balance::{Self,Balance};
use sui::coin::{Self,Coin};
use sui::table::{Self,Table};
use sui::event;
const EAmount:u64=1;const ERevision:u64=2;const ERequest:u64=3;const ERoot:u64=4;
public struct Ledger<phantom C> has store {
    root:ID,revision:u64,funds:Balance<C>,collected:u128,withdrawn:u128,
    requests:Table<Request,Receipt>,
}
public struct Request has copy,drop,store {actor:address,attempt:vector<u8>}
public struct Receipt has copy,drop,store {
    root:ID,actor:address,attempt:vector<u8>,recipient:address,amount:u64,
    before_revision:u64,after_revision:u64,balance:u64,total_collected:u128,total_withdrawn:u128,
}
public struct Withdrawn has copy,drop {receipt:Receipt}
public struct Snapshot has copy,drop,store {root:ID,revision:u64,balance:u64,collected:u128,withdrawn:u128}
public fun snapshot<C>(l:&Ledger<C>):Snapshot{Snapshot{root:l.root,revision:l.revision,balance:balance::value(&l.funds),collected:l.collected,withdrawn:l.withdrawn}}
public fun new<C>(parent:&UID,ctx:&mut TxContext):Ledger<C>{Ledger{root:object::uid_to_inner(parent),revision:0,funds:balance::zero(),collected:0,withdrawn:0,requests:table::new(ctx)}}
public fun deposit<C>(parent:&UID,l:&mut Ledger<C>,payment:Coin<C>){
    assert!(object::uid_to_inner(parent)==l.root,ERoot);
    let amount=coin::value(&payment);if(amount==0){coin::destroy_zero(payment);return};
    coin::put(&mut l.funds,payment);l.collected=l.collected+(amount as u128);l.revision=l.revision+1;
}
public fun withdraw<C>(parent:&UID,l:&mut Ledger<C>,expected:u64,amount:u64,recipient:address,attempt:vector<u8>,ctx:&mut TxContext){
    assert!(object::uid_to_inner(parent)==l.root,ERoot);
    assert!(l.revision==expected,ERevision);
    assert!(amount>0 && amount<=balance::value(&l.funds) && recipient!=@0x0,EAmount);
    assert!(attempt.length()==32 && attempt.any!(|x|x!=0),ERequest);
    let key=Request{actor:ctx.sender(),attempt};assert!(!l.requests.contains(key),ERequest);
    let payment=coin::take(&mut l.funds,amount,ctx);l.withdrawn=l.withdrawn+(amount as u128);l.revision=l.revision+1;
    let receipt=Receipt{root:l.root,actor:ctx.sender(),attempt,recipient,amount,before_revision:expected,after_revision:l.revision,balance:balance::value(&l.funds),total_collected:l.collected,total_withdrawn:l.withdrawn};
    l.requests.add(key,receipt);event::emit(Withdrawn{receipt});transfer::public_transfer(payment,recipient)
}
public fun root<C>(l:&Ledger<C>):ID{l.root}
public fun revision<C>(l:&Ledger<C>):u64{l.revision}
public fun balance<C>(l:&Ledger<C>):u64{balance::value(&l.funds)}
public fun collected<C>(l:&Ledger<C>):u128{l.collected}
public fun withdrawn<C>(l:&Ledger<C>):u128{l.withdrawn}
public fun receipt<C>(l:&Ledger<C>,actor:address,attempt:vector<u8>):Option<Receipt>{let k=Request{actor,attempt};if(l.requests.contains(k))option::some(*l.requests.borrow(k)) else option::none()}
public fun receipt_root(r:&Receipt):ID{r.root}
public fun receipt_actor(r:&Receipt):address{r.actor}
public fun receipt_recipient(r:&Receipt):address{r.recipient}
public fun receipt_amount(r:&Receipt):u64{r.amount}
public fun receipt_balance(r:&Receipt):u64{r.balance}
public fun receipt_revision(r:&Receipt):u64{r.after_revision}
