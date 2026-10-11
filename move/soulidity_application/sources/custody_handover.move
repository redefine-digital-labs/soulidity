/// Owned address delivery groundwork. Account/market/access/terminal sink
/// migration remains separate; arbitrary key+store public transfers have no hook.
module soulidity_application::custody_handover;
use soulidity_custody::lifecycle;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::{character,vault};
public fun handover(s:Soul,recipient:address):ID {
    let mut h=lifecycle::begin_handover(s);
    character::acknowledge_handover(&mut h);
    vault::acknowledge_handover(&mut h);
    lifecycle::finish_handover(h,recipient)
}

public fun handover_construction(c:lifecycle::Construction,
    completion:soulidity_origin_protocol::producer_origin::CompletionAuthorization,
    recipient:address,ctx:&TxContext,
):ID {
    let mut h=lifecycle::begin_construction_handover(c,completion,ctx);
    character::acknowledge_handover(&mut h);vault::acknowledge_handover(&mut h);
    lifecycle::finish_handover(h,recipient)
}
public fun handover_parent(p:lifecycle::ParentDelivery,recipient:address,ctx:&TxContext):ID {
    let mut h=lifecycle::begin_parent_handover(p,ctx);
    character::acknowledge_handover(&mut h);vault::acknowledge_handover(&mut h);
    lifecycle::finish_handover(h,recipient)
}
