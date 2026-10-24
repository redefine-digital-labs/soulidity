/// Liveness gate for the content layer: one shared singleton read first by the
/// 24 directly public entries of `content` / `grant` / `paid_access` /
/// `named_loadout_v1` (every owner / agent mutator and every `seal_approve_*`).
/// `version` pins the bytecode generation: after a package upgrade the admin
/// calls `migrate` from the new code and every older package version aborts at
/// `assert_live`. `paused` is the emergency stop for the same surface.
/// Not covered here, by design: market entry points (mint, list, buy, config /
/// active-binding / paid-access-config wrappers) keep their own `MarketConfigV2`
/// gates, and the mint-time package-only content paths are reachable solely
/// through them. `set_paused` therefore stops the content layer, not the market.
module soulidity::protocol_gate;

use sui::event;

const VERSION: u64 = 1;

const EGateVersionMismatch: u64 = 0;
const EGatePaused: u64 = 1;
const EGateCapMismatch: u64 = 2;
const ENothingToMigrate: u64 = 3;

public struct ProtocolGate has key {
    id: UID,
    version: u64,
    paused: bool,
}

/// Bound to exactly one gate so a cap from another deployment cannot act here.
public struct ProtocolGateCap has key, store {
    id: UID,
    gate_id: ID,
}

public struct ProtocolGateCreated has copy, drop {
    gate_id: ID,
    cap_id: ID,
    version: u64,
}

public struct ProtocolGatePausedUpdated has copy, drop {
    gate_id: ID,
    paused: bool,
}

public struct ProtocolGateMigrated has copy, drop {
    gate_id: ID,
    old_version: u64,
    new_version: u64,
}

fun init(ctx: &mut TxContext) {
    let gate = ProtocolGate { id: object::new(ctx), version: VERSION, paused: false };
    let cap = ProtocolGateCap { id: object::new(ctx), gate_id: object::id(&gate) };
    event::emit(ProtocolGateCreated { gate_id: object::id(&gate), cap_id: object::id(&cap), version: VERSION });
    transfer::share_object(gate);
    transfer::transfer(cap, ctx.sender());
}

public fun protocol_version(): u64 { VERSION }

public fun version(self: &ProtocolGate): u64 { self.version }

public fun is_paused(self: &ProtocolGate): bool { self.paused }

public fun cap_gate_id(cap: &ProtocolGateCap): ID { cap.gate_id }

/// First statement of every gated entry. Version is checked before pause so an
/// outdated package version is always rejected, even while paused.
public fun assert_live(self: &ProtocolGate) {
    assert!(self.version == VERSION, EGateVersionMismatch);
    assert!(!self.paused, EGatePaused);
}

public fun set_paused(self: &mut ProtocolGate, cap: &ProtocolGateCap, paused: bool) {
    assert!(cap.gate_id == object::id(self), EGateCapMismatch);
    self.paused = paused;
    event::emit(ProtocolGatePausedUpdated { gate_id: object::id(self), paused });
}

/// Run once from the upgraded package: moves the gate to this bytecode's
/// `VERSION` so every older version fails `assert_live`. Aborts when the gate
/// is already current, so the call cannot be replayed from old bytecode.
public fun migrate(self: &mut ProtocolGate, cap: &ProtocolGateCap) {
    assert!(cap.gate_id == object::id(self), EGateCapMismatch);
    assert!(self.version < VERSION, ENothingToMigrate);
    let old_version = self.version;
    self.version = VERSION;
    event::emit(ProtocolGateMigrated { gate_id: object::id(self), old_version, new_version: VERSION });
}

// ── Test helpers ──────────────────────────────────────────────────────

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

#[test_only]
public fun new_for_testing(ctx: &mut TxContext): ProtocolGate {
    ProtocolGate { id: object::new(ctx), version: VERSION, paused: false }
}

#[test_only]
public fun new_cap_for_testing(gate: &ProtocolGate, ctx: &mut TxContext): ProtocolGateCap {
    ProtocolGateCap { id: object::new(ctx), gate_id: object::id(gate) }
}

#[test_only]
public fun set_version_for_testing(self: &mut ProtocolGate, version: u64) { self.version = version }

#[test_only]
public fun destroy_for_testing(self: ProtocolGate) {
    let ProtocolGate { id, version: _, paused: _ } = self;
    id.delete();
}

#[test_only]
public fun destroy_cap_for_testing(cap: ProtocolGateCap) {
    let ProtocolGateCap { id, gate_id: _ } = cap;
    id.delete();
}
