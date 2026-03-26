module soul_market::grant;

use sui::event;
use soul_market::pass::{Self, PerpetualPass, SubscriptionPass};

// === Errors ===

const E_NOT_OWNER: u64 = 1;
const E_NO_AGENT_GRANT: u64 = 2;
const E_SELF_GRANT: u64 = 4;
const E_INVALID_AGENT: u64 = 5;

// === Events ===

public struct AgentGrantSet has copy, drop {
    pass_id: ID,
    agent: address,
}

public struct AgentGrantRevoked has copy, drop {
    pass_id: ID,
    old_agent: address,
}

// === Agent Grant: Perpetual ===

public entry fun set_agent_grant_perpetual(
    pass: &mut PerpetualPass,
    agent: address,
    ctx: &TxContext,
) {
    assert!(pass.perpetual_owner() == ctx.sender(), E_NOT_OWNER);
    assert!(agent != @0x0, E_INVALID_AGENT);
    assert!(agent != ctx.sender(), E_SELF_GRANT);

    let pass_id = object::id(pass);
    let grant_mut = pass::perpetual_agent_grant_mut(pass);
    let mut should_emit_set = true;
    if (grant_mut.is_some()) {
        let old_agent = grant_mut.extract();
        if (old_agent != agent) {
            event::emit(AgentGrantRevoked {
                pass_id,
                old_agent,
            });
        } else {
            should_emit_set = false;
        };
    };
    *grant_mut = option::some(agent);

    if (should_emit_set) {
        event::emit(AgentGrantSet {
            pass_id,
            agent,
        });
    };
}

public entry fun revoke_agent_grant_perpetual(
    pass: &mut PerpetualPass,
    ctx: &TxContext,
) {
    assert!(pass.perpetual_owner() == ctx.sender(), E_NOT_OWNER);

    let pass_id = object::id(pass);
    let grant_mut = pass::perpetual_agent_grant_mut(pass);
    assert!(grant_mut.is_some(), E_NO_AGENT_GRANT);
    let old_agent = grant_mut.extract();

    event::emit(AgentGrantRevoked {
        pass_id,
        old_agent,
    });
}

// === Agent Grant: Subscription ===

public entry fun set_agent_grant_subscription(
    pass: &mut SubscriptionPass,
    agent: address,
    ctx: &TxContext,
) {
    assert!(pass.subscription_owner() == ctx.sender(), E_NOT_OWNER);
    assert!(agent != @0x0, E_INVALID_AGENT);
    assert!(agent != ctx.sender(), E_SELF_GRANT);

    let pass_id = object::id(pass);
    let grant_mut = pass::subscription_agent_grant_mut(pass);
    let mut should_emit_set = true;
    if (grant_mut.is_some()) {
        let old_agent = grant_mut.extract();
        if (old_agent != agent) {
            event::emit(AgentGrantRevoked {
                pass_id,
                old_agent,
            });
        } else {
            should_emit_set = false;
        };
    };
    *grant_mut = option::some(agent);

    if (should_emit_set) {
        event::emit(AgentGrantSet {
            pass_id,
            agent,
        });
    };
}

public entry fun revoke_agent_grant_subscription(
    pass: &mut SubscriptionPass,
    ctx: &TxContext,
) {
    assert!(pass.subscription_owner() == ctx.sender(), E_NOT_OWNER);

    let pass_id = object::id(pass);
    let grant_mut = pass::subscription_agent_grant_mut(pass);
    assert!(grant_mut.is_some(), E_NO_AGENT_GRANT);
    let old_agent = grant_mut.extract();

    event::emit(AgentGrantRevoked {
        pass_id,
        old_agent,
    });
}
