module soulidity::memory;

use sui::clock::Clock;
use sui::dynamic_object_field as dof;
use sui::event;
use sui::table;
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::soul::{Self as soul, SoulState};
use walrus::blob::{Self as blob, Blob};

const WRITER_FOUNDER: u8 = 0;
const WRITER_OWNER: u8 = 1;
const WRITER_GRANTED_AGENT: u8 = 2;

const EMemoryStateMismatch: u64 = 0;
const EMemoryGrantStateMismatch: u64 = 1;
const EMemoryEntryMissing: u64 = 2;

public struct SoulMemory has key {
    id: UID,
    soul_id: ID,
    entries: table::Table<u64, ID>,
    entry_count: u64,
}

public struct MemoryBlobKey has copy, drop, store {
    timestamp_key: u64,
}

public struct SoulMemoryCreated has copy, drop {
    memory_id: ID,
    soul_id: ID,
}

public struct MemoryEntryAppended has copy, drop {
    memory_id: ID,
    soul_id: ID,
    timestamp_key: u64,
    writer: address,
    writer_kind: u8,
    created_at_ms: u64,
    blob_object_id: ID,
}

public fun soul_id(self: &SoulMemory): ID {
    self.soul_id
}

public fun entry_count(self: &SoulMemory): u64 {
    self.entry_count
}

public fun contains_entry(self: &SoulMemory, timestamp_key: u64): bool {
    table::contains(&self.entries, timestamp_key)
}

public fun blob_object_id_for(self: &SoulMemory, timestamp_key: u64): ID {
    assert!(contains_entry(self, timestamp_key), EMemoryEntryMissing);
    *table::borrow(&self.entries, timestamp_key)
}

public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulMemory {
    let memory = SoulMemory {
        id: object::new(ctx),
        soul_id,
        entries: table::new(ctx),
        entry_count: 0,
    };

    event::emit(SoulMemoryCreated {
        memory_id: object::id(&memory),
        soul_id,
    });

    memory
}

public(package) fun append_founding(
    memory: &mut SoulMemory,
    writer: address,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    append_impl(memory, writer, WRITER_FOUNDER, content_blob, clock.timestamp_ms(), ctx)
}

public fun append_as_owner(
    memory: &mut SoulMemory,
    state: &SoulState,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    soul::assert_owner(state, ctx.sender());
    assert!(memory.soul_id == soul::soul_id(state), EMemoryStateMismatch);
    append_impl(
        memory,
        ctx.sender(),
        WRITER_OWNER,
        content_blob,
        clock.timestamp_ms(),
        ctx,
    )
}

public fun append_as_granted_agent(
    memory: &mut SoulMemory,
    state: &SoulState,
    soul_grant: &SoulGrant,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    assert!(memory.soul_id == soul::soul_id(state), EMemoryGrantStateMismatch);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_memory(), clock, ctx);
    append_impl(
        memory,
        ctx.sender(),
        WRITER_GRANTED_AGENT,
        content_blob,
        clock.timestamp_ms(),
        ctx,
    )
}

fun append_impl(
    memory: &mut SoulMemory,
    writer: address,
    writer_kind: u8,
    content_blob: Blob,
    created_at_ms: u64,
    _ctx: &mut TxContext,
): u64 {
    let mut timestamp_key = created_at_ms;
    // Resolve collisions: if the same millisecond is already taken, increment until free.
    while (table::contains(&memory.entries, timestamp_key)) {
        timestamp_key = timestamp_key + 1;
    };
    let blob_object_id = blob::object_id(&content_blob);

    table::add(&mut memory.entries, timestamp_key, blob_object_id);
    memory.entry_count = memory.entry_count + 1;

    dof::add(&mut memory.id, MemoryBlobKey { timestamp_key }, content_blob);
    event::emit(MemoryEntryAppended {
        memory_id: object::id(memory),
        soul_id: memory.soul_id,
        timestamp_key,
        writer,
        writer_kind,
        created_at_ms,
        blob_object_id,
    });

    timestamp_key
}

public(package) fun share_memory(memory: SoulMemory) {
    transfer::share_object(memory);
}

#[test_only]
public fun destroy_for_testing(self: SoulMemory) {
    let SoulMemory {
        id,
        soul_id: _,
        entries,
        entry_count: _,
    } = self;
    table::drop(entries);
    id.delete();
}
