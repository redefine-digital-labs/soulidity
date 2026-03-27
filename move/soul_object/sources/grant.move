module soul_object::grant;

use sui::event;
use soul_object::soul::Soul;

const ENoAgentGrant: u64 = 0;
const EInvalidAgent: u64 = 1;
const ESelfGrant: u64 = 2;

public struct SoulAccessCap has key, store {
    id: UID,
    soul_id: ID,
    agent: address,
    grant_version: u64,
}

public struct AgentGrantSet has copy, drop {
    soul_id: ID,
    agent: address,
    grant_version: u64,
}

public struct AgentGrantRevoked has copy, drop {
    soul_id: ID,
    old_agent: address,
}

public fun soul_id(self: &SoulAccessCap): ID {
    self.soul_id
}

public fun agent(self: &SoulAccessCap): address {
    self.agent
}

public fun grant_version(self: &SoulAccessCap): u64 {
    self.grant_version
}

public fun set_agent_grant(soul: &mut Soul, agent: address, ctx: &mut TxContext): SoulAccessCap {
    assert!(agent != @0x0, EInvalidAgent);
    assert!(agent != ctx.sender(), ESelfGrant);

    let soul_id = object::id(soul);
    let existing_agent = *soul.agent_grant();
    if (existing_agent.is_some()) {
        let old_agent = existing_agent.destroy_some();
        event::emit(AgentGrantRevoked { soul_id, old_agent });
    };

    let grant_version = soul.set_agent_grant(option::some(agent));
    event::emit(AgentGrantSet {
        soul_id,
        agent,
        grant_version,
    });

    SoulAccessCap {
        id: object::new(ctx),
        soul_id,
        agent,
        grant_version,
    }
}

public fun revoke_agent_grant(soul: &mut Soul, _ctx: &TxContext) {
    let existing_agent = *soul.agent_grant();
    assert!(existing_agent.is_some(), ENoAgentGrant);

    let old_agent = existing_agent.destroy_some();
    soul.clear_agent_grant();
    event::emit(AgentGrantRevoked {
        soul_id: object::id(soul),
        old_agent,
    });
}

#[test_only]
public fun destroy_for_testing(self: SoulAccessCap) {
    let SoulAccessCap {
        id,
        soul_id: _,
        agent: _,
        grant_version: _,
    } = self;
    id.delete();
}
