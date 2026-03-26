module soul_object::grant;

use sui::event;
use soul_object::soul::Soul;

const ENotOwner: u64 = 0;
const ENoAgentGrant: u64 = 1;
const EInvalidAgent: u64 = 2;
const ESelfGrant: u64 = 3;

public struct AgentGrantSet has copy, drop {
    soul_id: ID,
    agent: address,
}

public struct AgentGrantRevoked has copy, drop {
    soul_id: ID,
    old_agent: address,
}

public fun set_agent_grant(soul: &mut Soul, agent: address, ctx: &TxContext) {
    let owner = soul.owner();
    assert!(owner == ctx.sender(), ENotOwner);
    assert!(agent != @0x0, EInvalidAgent);
    assert!(agent != owner, ESelfGrant);

    let soul_id = object::id(soul);
    let existing_agent = *soul.agent_grant();
    if (existing_agent.is_some()) {
        let old_agent = existing_agent.destroy_some();
        if (old_agent == agent) {
            return
        };
        event::emit(AgentGrantRevoked { soul_id, old_agent });
    };

    soul.set_agent_grant(option::some(agent));
    event::emit(AgentGrantSet { soul_id, agent });
}

public fun revoke_agent_grant(soul: &mut Soul, ctx: &TxContext) {
    assert!(soul.owner() == ctx.sender(), ENotOwner);

    let existing_agent = *soul.agent_grant();
    assert!(existing_agent.is_some(), ENoAgentGrant);

    let old_agent = existing_agent.destroy_some();
    soul.set_agent_grant(option::none());
    event::emit(AgentGrantRevoked {
        soul_id: object::id(soul),
        old_agent,
    });
}
