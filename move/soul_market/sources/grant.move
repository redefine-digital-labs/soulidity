module soul_market::grant;

use sui::event;
use soul_market::pass::{Self, PerpetualPass, SubscriptionPass};

// === Events ===

public struct AgentGrantSet has copy, drop {
    pass_id: ID,
    agent: address,
}

public struct AgentGrantRevoked has copy, drop {
    pass_id: ID,
    old_agent: address,
}

public struct PassTransferred has copy, drop {
    pass_id: ID,
    from: address,
    to: address,
}

// === Agent Grant: Perpetual ===

public entry fun set_agent_grant_perpetual(
    pass: &mut PerpetualPass,
    agent: address,
    ctx: &TxContext,
) {
    assert!(pass.perpetual_owner() == ctx.sender(), 1); // ENotOwner

    let grant_mut = pass::perpetual_agent_grant_mut(pass);
    *grant_mut = option::some(agent);

    event::emit(AgentGrantSet {
        pass_id: object::id(pass),
        agent,
    });
}

public entry fun revoke_agent_grant_perpetual(
    pass: &mut PerpetualPass,
    ctx: &TxContext,
) {
    assert!(pass.perpetual_owner() == ctx.sender(), 1); // ENotOwner

    let grant_mut = pass::perpetual_agent_grant_mut(pass);
    let old_agent = grant_mut.extract();

    event::emit(AgentGrantRevoked {
        pass_id: object::id(pass),
        old_agent,
    });
}

// === Agent Grant: Subscription ===

public entry fun set_agent_grant_subscription(
    pass: &mut SubscriptionPass,
    agent: address,
    ctx: &TxContext,
) {
    assert!(pass.subscription_owner() == ctx.sender(), 1); // ENotOwner

    let grant_mut = pass::subscription_agent_grant_mut(pass);
    *grant_mut = option::some(agent);

    event::emit(AgentGrantSet {
        pass_id: object::id(pass),
        agent,
    });
}

public entry fun revoke_agent_grant_subscription(
    pass: &mut SubscriptionPass,
    ctx: &TxContext,
) {
    assert!(pass.subscription_owner() == ctx.sender(), 1); // ENotOwner

    let grant_mut = pass::subscription_agent_grant_mut(pass);
    let old_agent = grant_mut.extract();

    event::emit(AgentGrantRevoked {
        pass_id: object::id(pass),
        old_agent,
    });
}

// === Transfer ===

public entry fun transfer_perpetual_pass(
    mut pass: PerpetualPass,
    to: address,
    ctx: &TxContext,
) {
    let from = ctx.sender();
    assert!(pass.perpetual_owner() == from, 1); // ENotOwner
    let pass_id = object::id(&pass);

    // Clear agent grant on transfer
    let grant_mut = pass::perpetual_agent_grant_mut(&mut pass);
    if (grant_mut.is_some()) {
        let old_agent = grant_mut.extract();
        event::emit(AgentGrantRevoked {
            pass_id,
            old_agent,
        });
    };

    pass::set_perpetual_owner(&mut pass, to);

    event::emit(PassTransferred {
        pass_id,
        from,
        to,
    });

    transfer::public_transfer(pass, to);
}

public entry fun transfer_subscription_pass(
    mut pass: SubscriptionPass,
    to: address,
    ctx: &TxContext,
) {
    let from = ctx.sender();
    assert!(pass.subscription_owner() == from, 1); // ENotOwner
    let pass_id = object::id(&pass);

    // Clear agent grant on transfer
    let grant_mut = pass::subscription_agent_grant_mut(&mut pass);
    if (grant_mut.is_some()) {
        let old_agent = grant_mut.extract();
        event::emit(AgentGrantRevoked {
            pass_id,
            old_agent,
        });
    };

    pass::set_subscription_owner(&mut pass, to);

    event::emit(PassTransferred {
        pass_id,
        from,
        to,
    });

    transfer::public_transfer(pass, to);
}
