module soulidity::memory;

use sui::clock::Clock;
use sui::event;
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::soul::{Self as soul, SoulState};
use walrus::blob::{Self as blob, Blob};

const WRITER_FOUNDER: u8 = 0;
const WRITER_OWNER: u8 = 1;
const WRITER_GRANTED_AGENT: u8 = 2;

const EMemoryStateMismatch: u64 = 0;
const EMemoryGrantStateMismatch: u64 = 1;
const ENoMemoryEntries: u64 = 2;

public struct SoulMemory has key {
    id: UID,
    soul_id: ID,
    next_index: u64,
    entry_count: u64,
    last_entry_id: Option<ID>,
    last_entry_created_at_ms: Option<u64>,
}

public struct MemoryEntry has key, store {
    id: UID,
    soul_id: ID,
    index: u64,
    writer: address,
    writer_kind: u8,
    created_at_ms: u64,
    content_blob: Blob,
    prev_entry_id: Option<ID>,
}

public struct SoulMemoryCreated has copy, drop {
    memory_id: ID,
    soul_id: ID,
}

public struct MemoryEntryAppended has copy, drop {
    memory_id: ID,
    entry_id: ID,
    soul_id: ID,
    index: u64,
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

public fun next_index(self: &SoulMemory): u64 {
    self.next_index
}

public fun last_entry_id(self: &SoulMemory): &Option<ID> {
    &self.last_entry_id
}

public fun last_entry_created_at_ms(self: &SoulMemory): &Option<u64> {
    &self.last_entry_created_at_ms
}

public fun created_at_ms(self: &MemoryEntry): u64 {
    self.created_at_ms
}

public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulMemory {
    let memory = SoulMemory {
        id: object::new(ctx),
        soul_id,
        next_index: 0,
        entry_count: 0,
        last_entry_id: option::none(),
        last_entry_created_at_ms: option::none(),
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
): ID {
    append_impl(memory, writer, WRITER_FOUNDER, content_blob, clock.timestamp_ms(), ctx)
}

public fun append_as_owner(
    memory: &mut SoulMemory,
    state: &SoulState,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
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
): ID {
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
    ctx: &mut TxContext,
): ID {
    let entry = MemoryEntry {
        id: object::new(ctx),
        soul_id: memory.soul_id,
        index: memory.next_index,
        writer,
        writer_kind,
        created_at_ms,
        content_blob,
        prev_entry_id: memory.last_entry_id,
    };
    let entry_id = object::id(&entry);
    let blob_object_id = blob::object_id(&entry.content_blob);

    memory.next_index = memory.next_index + 1;
    memory.entry_count = memory.entry_count + 1;
    memory.last_entry_id = option::some(entry_id);
    memory.last_entry_created_at_ms = option::some(created_at_ms);

    transfer::share_object(entry);
    event::emit(MemoryEntryAppended {
        memory_id: object::id(memory),
        entry_id,
        soul_id: memory.soul_id,
        index: memory.next_index - 1,
        writer,
        writer_kind,
        created_at_ms,
        blob_object_id,
    });

    entry_id
}

public(package) fun share_memory(memory: SoulMemory) {
    transfer::share_object(memory);
}

#[test_only]
public fun last_entry_created_at_ms_for_testing(self: &SoulMemory): u64 {
    assert!(self.last_entry_created_at_ms.is_some(), ENoMemoryEntries);
    *self.last_entry_created_at_ms.borrow()
}

#[test_only]
public fun destroy_for_testing(self: SoulMemory) {
    let SoulMemory {
        id,
        soul_id: _,
        next_index: _,
        entry_count: _,
        last_entry_id: _,
        last_entry_created_at_ms: _,
    } = self;
    id.delete();
}

#[test_only]
public fun destroy_entry_for_testing(self: MemoryEntry): Blob {
    let MemoryEntry {
        id,
        soul_id: _,
        index: _,
        writer: _,
        writer_kind: _,
        created_at_ms: _,
        content_blob,
        prev_entry_id: _,
    } = self;
    id.delete();
    content_blob
}
