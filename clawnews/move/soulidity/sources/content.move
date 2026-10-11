module soulidity::content;

use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::dynamic_object_field as dof;
use sui::event;
use sui::table::{Self as table, Table};
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::kind_registry::{Self as kind_registry, KindRegistry};
use soulidity::soul::{Self as soul, SoulState};
use walrus::blob::{Self as blob, Blob};

const EContentMismatch: u64 = 3;
const ENameNotFound: u64 = 4;
const EVersionOutOfBounds: u64 = 5;
const EVersionDeleted: u64 = 6;
const EVersionPurged: u64 = 7;
const EDocumentIdInvalidLength: u64 = 8;
const EDocumentIdPrefixMismatch: u64 = 9;
const EKindRequiresDownloadPolicy: u64 = 10;
const EInvalidDownloadPolicy: u64 = 11;
const EContentNameInvalidLength: u64 = 12;
const EContentNameInvalidChar: u64 = 13;
const EKindActiveBindingNotSupported: u64 = 14;
const EActiveVersionDeleted: u64 = 15;
const EVersionNotDeleted: u64 = 16;
const EOpNotAllowed: u64 = 18;
const EReadModeNotAllowed: u64 = 19;
const EPublicSlotNoSeal: u64 = 20;
const ESoulDocAlreadyExists: u64 = 21;
const EMemoryNameMismatch: u64 = 22;
const ESoulDocNameMismatch: u64 = 23;
const EInitialKindOpNotAllowed: u64 = 24;
const EEmptySlotReadMode: u64 = 25;
const EPublicReadModeRequiresPublicPolicy: u64 = 26;
const EInitialSoulDocMissing: u64 = 27;
const EInitialMemoryMissing: u64 = 28;
const EOwnerReadModeRequired: u64 = 29;

const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;
const DOCUMENT_ID_DOMAIN_LEN: u64 = 13; // "soul-content:"
const CONTENT_ID_LEN: u64 = 32;
const KIND_BYTES: u64 = 4; // u32 big-endian
const VERSION_INDEX_BYTES: u64 = 8; // u64 big-endian
const CONTENT_NAME_MAX_LEN: u64 = 32;
const VERSION: u64 = 1;

const DOWNLOAD_POLICY_PUBLIC: u8 = 0;
const DOWNLOAD_POLICY_OWNER_ONLY: u8 = 1;
const DOWNLOAD_POLICY_ALLOWLIST: u8 = 2;

// Built-in invariant kind ids (kept here as locals so content.move can
// enforce SOUL_DOC / MEMORY name rules without depending on
// `kind_registry` accessors at every call site). They must match
// `kind_registry::kind_soul_doc()` / `kind_memory()`.
const KIND_SOUL_DOC_ID: u32 = 0;
const KIND_MEMORY_ID: u32 = 1;

// ── Keys ──────────────────────────────────────────────────────────────

public struct ContentKey has copy, drop, store {
    kind: u32,
    name: String,
}

public struct ContentBlobKey has copy, drop, store {
    kind: u32,
    name: String,
    version_index: u64,
}

// ── Slot / version metadata ───────────────────────────────────────────

public struct ContentSlot has copy, drop, store {
    version: u64,
    kind: u32,
    blob_object_id: ID,
    /// Derived from `slot_read_mode_mask & READ_PUBLIC != 0`. Kept on the
    /// slot so off-chain mirrors / events stay 1:1 with Phase 1 wire shape.
    is_public: bool,
    deleted: bool,
    purged: bool,
    download_policy: u8,
    /// Cached at append time from `KindDescriptor.default_grant_scope_mask`.
    /// Seal read paths consult only this cache (not `KindRegistry`), so
    /// historical versions remain seal-approvable even if the kind is later
    /// deprecated and reactivated. KindDescriptor immutability (enforced in
    /// `kind_registry.move`) guarantees this cache is consistent forever.
    grant_scope_mask: u64,
    /// Caller-chosen subset of `KindDescriptor.read_mode_mask` at append
    /// time. Seal entries (`seal_approve_content_*`) read this cached mask
    /// rather than the registry so historical slots remain authoritative.
    read_mode_mask: u64,
    /// Snapshot of `KindDescriptor.op_mask` at append time. Delete / purge
    /// / set_active gates check this cache so re-activated kinds can't
    /// retroactively gain mutating power over old slots.
    op_mask: u64,
    /// Slots always keep Seal encryption. Public readability is represented by
    /// `READ_PUBLIC` + `DOWNLOAD_POLICY_PUBLIC`, but `READ_OWNER` is still
    /// mandatory so the owner Seal path never disappears.
    seal_encrypted: bool,
    created_at_ms: u64,
}

// ── Soul-level "current active" pointer for kinds with active binding ──

public struct ActiveBinding has copy, drop, store {
    version: u64,
    kind: u32,
    name: String,
    version_index: u64,
    download_policy: u8,
}

// ── Root object ───────────────────────────────────────────────────────

public struct SoulContent has key {
    id: UID,
    version: u64,
    soul_id: ID,
    items: Table<ContentKey, vector<ContentSlot>>,
    count_by_kind: Table<u32, u64>,
    /// Per-kind currently-active binding. Only meaningful for kinds whose
    /// `KindDescriptor.has_active_binding=true`. Absorbed from the previous
    /// `SoulMetadata::active_sprite/voice` design so delete-while-active
    /// guards can stay intra-module.
    active: Table<u32, ActiveBinding>,
}

// ── Events ────────────────────────────────────────────────────────────

public struct SoulContentCreated has copy, drop {
    content_id: ID,
    soul_id: ID,
}

public struct ContentVersionAppended has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    name: String,
    version_index: u64,
    is_public: bool,
    download_policy: u8,
    grant_scope_mask: u64,
    read_mode_mask: u64,
    op_mask: u64,
    seal_encrypted: bool,
    blob_object_id: ID,
    created_at_ms: u64,
}

public struct ContentVersionDeleted has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    name: String,
    version_index: u64,
    deleted_by: address,
}

public struct ContentVersionPurged has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    name: String,
    version_index: u64,
    purged_by: address,
}

public struct ActiveBindingUpdated has copy, drop {
    content_id: ID,
    soul_id: ID,
    kind: u32,
    kind_name: String,
    binding: Option<ActiveBinding>,
    updater: address,
}

// ── Public download-policy enum exposure ──────────────────────────────

public fun download_policy_public(): u8 { DOWNLOAD_POLICY_PUBLIC }
public fun download_policy_owner_only(): u8 { DOWNLOAD_POLICY_OWNER_ONLY }
public fun download_policy_allowlist(): u8 { DOWNLOAD_POLICY_ALLOWLIST }

// ── Canonical names for invariant kinds ───────────────────────────────

/// SOUL_DOC slots must use the canonical name "soul".
public fun soul_doc_name(): String { b"soul".to_string() }

/// MEMORY slots must use the canonical name "default".
public fun memory_name(): String { b"default".to_string() }

// ── ActiveBinding accessors ───────────────────────────────────────────

public fun active_binding_version(b: &ActiveBinding): u64 { b.version }
public fun active_binding_kind(b: &ActiveBinding): u32 { b.kind }
public fun active_binding_name(b: &ActiveBinding): &String { &b.name }
public fun active_binding_version_index(b: &ActiveBinding): u64 { b.version_index }
public fun active_binding_download_policy(b: &ActiveBinding): u8 { b.download_policy }

fun new_active_binding(
    kind: u32,
    name: String,
    version_index: u64,
    download_policy: u8,
): ActiveBinding {
    ActiveBinding { version: VERSION, kind, name, version_index, download_policy }
}

// ── Slot accessors ────────────────────────────────────────────────────

public fun slot_version(slot: &ContentSlot): u64 { slot.version }
public fun slot_kind(slot: &ContentSlot): u32 { slot.kind }
public fun slot_blob_object_id(slot: &ContentSlot): ID { slot.blob_object_id }
public fun slot_is_public(slot: &ContentSlot): bool { slot.is_public }
public fun slot_deleted(slot: &ContentSlot): bool { slot.deleted }
public fun slot_purged(slot: &ContentSlot): bool { slot.purged }
public fun slot_download_policy(slot: &ContentSlot): u8 { slot.download_policy }
public fun slot_grant_scope_mask(slot: &ContentSlot): u64 { slot.grant_scope_mask }
public fun slot_read_mode_mask(slot: &ContentSlot): u64 { slot.read_mode_mask }
public fun slot_op_mask(slot: &ContentSlot): u64 { slot.op_mask }
public fun slot_seal_encrypted(slot: &ContentSlot): bool { slot.seal_encrypted }
public fun slot_created_at_ms(slot: &ContentSlot): u64 { slot.created_at_ms }

// ── Root accessors ────────────────────────────────────────────────────

public fun content_id(self: &SoulContent): ID { object::id(self) }

public fun protocol_version(): u64 { VERSION }

public fun content_version(self: &SoulContent): u64 { self.version }

public fun soul_id(self: &SoulContent): ID { self.soul_id }

public fun version_count(self: &SoulContent, kind: u32, name: String): u64 {
    let key = ContentKey { kind, name };
    if (!self.items.contains(key)) {
        return 0
    };
    self.items.borrow(key).length()
}

public fun count_for_kind(self: &SoulContent, kind: u32): u64 {
    if (!self.count_by_kind.contains(kind)) {
        return 0
    };
    *self.count_by_kind.borrow(kind)
}

public fun has_active(self: &SoulContent, kind: u32): bool {
    self.active.contains(kind)
}

public fun borrow_slot(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): &ContentSlot {
    let key = ContentKey { kind, name };
    assert!(self.items.contains(key), ENameNotFound);
    let slots = self.items.borrow(key);
    assert!(version_index < slots.length(), EVersionOutOfBounds);
    vector::borrow(slots, version_index)
}

public fun blob_object_id_for(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): ID {
    borrow_slot(self, kind, name, version_index).blob_object_id
}

public fun version_is_public(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): bool {
    borrow_slot(self, kind, name, version_index).is_public
}

public fun version_is_deleted(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): bool {
    borrow_slot(self, kind, name, version_index).deleted
}

public fun version_is_purged(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): bool {
    borrow_slot(self, kind, name, version_index).purged
}

public fun version_grant_scope_mask(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): u64 {
    borrow_slot(self, kind, name, version_index).grant_scope_mask
}

public fun version_read_mode_mask(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): u64 {
    borrow_slot(self, kind, name, version_index).read_mode_mask
}

public fun version_seal_encrypted(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): bool {
    borrow_slot(self, kind, name, version_index).seal_encrypted
}

public fun active_binding(self: &SoulContent, kind: u32): Option<ActiveBinding> {
    if (!self.active.contains(kind)) {
        return option::none()
    };
    option::some(*self.active.borrow(kind))
}

public fun is_version_active(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): bool {
    if (!self.active.contains(kind)) {
        return false
    };
    let binding = self.active.borrow(kind);
    binding.name == name && binding.version_index == version_index
}

public fun assert_version_not_active(
    self: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
) {
    assert!(!is_version_active(self, kind, name, version_index), EActiveVersionDeleted);
}

// ── Lifecycle: create / share ─────────────────────────────────────────

public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulContent {
    let content = SoulContent {
        id: object::new(ctx),
        version: VERSION,
        soul_id,
        items: table::new(ctx),
        count_by_kind: table::new(ctx),
        active: table::new(ctx),
    };
    event::emit(SoulContentCreated {
        content_id: object::id(&content),
        soul_id,
    });
    content
}

public(package) fun share_content(content: SoulContent) {
    transfer::share_object(content);
}

// ── Append (owner) ────────────────────────────────────────────────────

public fun append_version_as_owner(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    soul::assert_owner(state, ctx.sender());
    assert_content_matches_state(content, state);
    append_version_impl(
        content,
        registry,
        kind,
        name,
        slot_read_mode_mask,
        download_policy,
        content_blob,
        clock,
        true,
    )
}

// ── Append (granted agent) ────────────────────────────────────────────

public fun append_version_as_granted_agent(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    soul_grant: &SoulGrant,
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    assert_content_matches_state(content, state);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    let scope_mask = kind_registry::descriptor_default_grant_scope_mask(descriptor);
    grant::assert_active_with_scope(state, soul_grant, scope_mask, clock, ctx);
    append_version_impl(
        content,
        registry,
        kind,
        name,
        slot_read_mode_mask,
        download_policy,
        content_blob,
        clock,
        true,
    )
}

// ── Initial mint append (package-only) ────────────────────────────────
//
// Two variants split out so caller-supplied `initial_content` cannot
// silently bypass the `OP_APPEND` gate on custom kinds. Invariant entries
// (SOUL_DOC v0, MEMORY v0) bypass the gate by design — those kinds
// declare `op_mask=0` for SOUL_DOC and the memory append op is what
// records the founding entry; mint-time creation must be allowed even
// when end-user `OP_APPEND` is denied.

/// Append-time invariant entry. ONLY valid for `(KIND_SOUL_DOC, "soul")`
/// and `(KIND_MEMORY, "default")`. Aborts on any other (kind, name).
public(package) fun append_initial_invariant_version(
    content: &mut SoulContent,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    content_blob: Blob,
    clock: &Clock,
): u64 {
    if (kind == KIND_SOUL_DOC_ID) {
        assert!(name == soul_doc_name(), ESoulDocNameMismatch);
        // soul.md is forever immutable: at most v0 allowed.
        let key = ContentKey { kind, name: copy name };
        assert!(!content.items.contains(key), ESoulDocAlreadyExists);
    } else if (kind == KIND_MEMORY_ID) {
        assert!(name == memory_name(), EMemoryNameMismatch);
    } else {
        // Invariant path is reserved for SOUL_DOC and MEMORY only.
        abort EInitialKindOpNotAllowed
    };
    // Mint invariants are fixed to owner+grant; callers cannot downgrade
    // SOUL_DOC / MEMORY slots to owner-only or any other subset.
    let invariant_read_mode = kind_registry::read_owner() | kind_registry::read_grant();
    assert!(slot_read_mode_mask == invariant_read_mode, EReadModeNotAllowed);
    append_version_impl(
        content,
        registry,
        kind,
        name,
        slot_read_mode_mask,
        download_policy,
        content_blob,
        clock,
        false,
    )
}

/// Append-time entry for non-invariant kinds. Enforces `OP_APPEND` so
/// admin-registered kinds with an empty `op_mask` cannot be seeded with
/// initial content during mint.
public(package) fun append_initial_user_version(
    content: &mut SoulContent,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    content_blob: Blob,
    clock: &Clock,
): u64 {
    // SOUL_DOC / MEMORY must come through `append_initial_invariant_version`.
    assert!(kind != KIND_SOUL_DOC_ID, ESoulDocNameMismatch);
    assert!(kind != KIND_MEMORY_ID, EMemoryNameMismatch);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    assert!(
        kind_registry::descriptor_op_mask(descriptor) & kind_registry::op_append() != 0,
        EInitialKindOpNotAllowed,
    );
    append_version_impl(
        content,
        registry,
        kind,
        name,
        slot_read_mode_mask,
        download_policy,
        content_blob,
        clock,
        false,
    )
}

fun append_version_impl(
    content: &mut SoulContent,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    content_blob: Blob,
    clock: &Clock,
    enforce_op_append: bool,
): u64 {
    assert_valid_content_name(&name);
    kind_registry::assert_kind_active(registry, kind);
    // Invariant-kind name guards. Held even on user-driven append paths so
    // owner / agent calls can never fork the canonical name space.
    assert_canonical_name_for_kind(kind, &name);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);

    if (enforce_op_append) {
        assert!(
            kind_registry::descriptor_op_mask(descriptor) & kind_registry::op_append() != 0,
            EOpNotAllowed,
        );
    };

    // slot_read_mode_mask must be a non-empty subset of descriptor's mask and
    // must keep READ_OWNER. Kind descriptors require READ_OWNER, and per-slot
    // subsets cannot weaken that owner-read invariant.
    assert!(slot_read_mode_mask != 0, EEmptySlotReadMode);
    let descriptor_read_mode_mask = kind_registry::descriptor_read_mode_mask(descriptor);
    assert!(
        (slot_read_mode_mask & descriptor_read_mode_mask) == slot_read_mode_mask,
        EReadModeNotAllowed,
    );
    assert!(
        slot_read_mode_mask & kind_registry::read_owner() != 0,
        EOwnerReadModeRequired,
    );

    let read_public = kind_registry::read_public();
    let is_public = (slot_read_mode_mask & read_public) != 0;

    let requires_policy = kind_registry::descriptor_requires_download_policy(descriptor);
    assert_valid_download_policy(requires_policy, download_policy);
    if (is_public) {
        // Any PUBLIC slot must declare DOWNLOAD_POLICY_PUBLIC. Mixed slots
        // (PUBLIC + OWNER/GRANT/PAID) still need the public URL signal.
        assert!(download_policy == DOWNLOAD_POLICY_PUBLIC, EPublicReadModeRequiresPublicPolicy);
    };

    let grant_scope_mask = kind_registry::descriptor_default_grant_scope_mask(descriptor);
    let op_mask = kind_registry::descriptor_op_mask(descriptor);
    let seal_encrypted = true;

    let created_at_ms = clock.timestamp_ms();
    let blob_object_id = blob::object_id(&content_blob);
    let slot = ContentSlot {
        version: VERSION,
        kind,
        blob_object_id,
        is_public,
        deleted: false,
        purged: false,
        download_policy,
        grant_scope_mask,
        read_mode_mask: slot_read_mode_mask,
        op_mask,
        seal_encrypted,
        created_at_ms,
    };

    let key = ContentKey { kind, name };
    let version_index = if (content.items.contains(key)) {
        let slots = content.items.borrow_mut(key);
        let idx = slots.length();
        vector::push_back(slots, slot);
        idx
    } else {
        content.items.add(key, vector[slot]);
        if (content.count_by_kind.contains(kind)) {
            let count = content.count_by_kind.borrow_mut(kind);
            *count = *count + 1;
        } else {
            content.count_by_kind.add(kind, 1);
        };
        0
    };

    dof::add(
        &mut content.id,
        ContentBlobKey { kind, name, version_index },
        content_blob,
    );

    let kind_name = *kind_registry::descriptor_name(descriptor);
    event::emit(ContentVersionAppended {
        content_id: object::id(content),
        soul_id: content.soul_id,
        kind,
        kind_name,
        name,
        version_index,
        is_public,
        download_policy,
        grant_scope_mask,
        read_mode_mask: slot_read_mode_mask,
        op_mask,
        seal_encrypted,
        blob_object_id,
        created_at_ms,
    });

    version_index
}

// ── Delete (owner) ────────────────────────────────────────────────────

public fun delete_version_as_owner(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_content_matches_state(content, state);
    assert_canonical_name_for_kind(kind, &name);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    let kind_name = *kind_registry::descriptor_name(descriptor);
    assert_slot_op_allowed(content, kind, name, version_index, kind_registry::op_delete());
    if (kind_registry::descriptor_has_active_binding(descriptor)) {
        assert_version_not_active(content, kind, name, version_index);
    };
    mark_slot_deleted(content, kind, name, version_index, ctx, kind_name);
}

// ── Delete (granted agent) ────────────────────────────────────────────

public fun delete_version_as_granted_agent(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    soul_grant: &SoulGrant,
    kind: u32,
    name: String,
    version_index: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_content_matches_state(content, state);
    assert_canonical_name_for_kind(kind, &name);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    let kind_name = *kind_registry::descriptor_name(descriptor);
    let scope_mask = kind_registry::descriptor_default_grant_scope_mask(descriptor);
    grant::assert_active_with_scope(state, soul_grant, scope_mask, clock, ctx);
    assert_slot_op_allowed(content, kind, name, version_index, kind_registry::op_delete());
    if (kind_registry::descriptor_has_active_binding(descriptor)) {
        assert_version_not_active(content, kind, name, version_index);
    };
    mark_slot_deleted(content, kind, name, version_index, ctx, kind_name);
}

fun mark_slot_deleted(
    content: &mut SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
    kind_name: String,
) {
    let key = ContentKey { kind, name };
    assert!(content.items.contains(key), ENameNotFound);
    let slots = content.items.borrow_mut(key);
    assert!(version_index < slots.length(), EVersionOutOfBounds);
    let slot = vector::borrow_mut(slots, version_index);
    assert!(!slot.deleted, EVersionDeleted);
    slot.deleted = true;
    event::emit(ContentVersionDeleted {
        content_id: object::id(content),
        soul_id: content.soul_id,
        kind,
        kind_name,
        name,
        version_index,
        deleted_by: ctx.sender(),
    });
}

// ── Purge (owner only) ────────────────────────────────────────────────

public fun purge_deleted_version_as_owner(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &mut TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_content_matches_state(content, state);
    assert_canonical_name_for_kind(kind, &name);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    let kind_name = *kind_registry::descriptor_name(descriptor);
    assert_slot_op_allowed(content, kind, name, version_index, kind_registry::op_purge());
    {
        let slot = borrow_slot(content, kind, name, version_index);
        assert!(slot.deleted, EVersionNotDeleted);
        assert!(!slot.purged, EVersionPurged);
    };
    let stored: Blob = dof::remove(
        &mut content.id,
        ContentBlobKey { kind, name, version_index },
    );
    blob::burn(stored);
    let key = ContentKey { kind, name };
    let slots = content.items.borrow_mut(key);
    let slot = vector::borrow_mut(slots, version_index);
    slot.purged = true;
    event::emit(ContentVersionPurged {
        content_id: object::id(content),
        soul_id: content.soul_id,
        kind,
        kind_name,
        name,
        version_index,
        purged_by: ctx.sender(),
    });
}

// ── Active binding (package only — invoked from market wrappers) ─────

public(package) fun set_active(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    assert_content_matches_state(content, state);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    assert!(
        kind_registry::descriptor_has_active_binding(descriptor),
        EKindActiveBindingNotSupported,
    );
    // OP_ACTIVE_BIND must be set in op_mask. (Equivalent to has_active_binding
    // by `assert_descriptor_well_formed` invariants, but explicit here so a
    // future invariant relaxation can't silently re-enable mutation.)
    assert!(
        kind_registry::descriptor_op_mask(descriptor) & kind_registry::op_active_bind() != 0,
        EOpNotAllowed,
    );
    let kind_name = *kind_registry::descriptor_name(descriptor);

    // Verify the target version exists and is appendable / readable.
    let slot = borrow_slot(content, kind, copy name, version_index);
    assert!(!slot.deleted, EVersionDeleted);
    assert!(!slot.purged, EVersionPurged);
    // Active version must itself permit the active-bind op.
    assert!(slot.op_mask & kind_registry::op_active_bind() != 0, EOpNotAllowed);

    // ActiveBinding policy is derived from the authoritative slot. Callers
    // cannot bind a version under a different visibility / ACL policy.
    let binding = new_active_binding(kind, name, version_index, slot.download_policy);

    if (content.active.contains(kind)) {
        let current = content.active.borrow_mut(kind);
        *current = binding;
    } else {
        content.active.add(kind, binding);
    };

    event::emit(ActiveBindingUpdated {
        content_id: object::id(content),
        soul_id: content.soul_id,
        kind,
        kind_name,
        binding: option::some(binding),
        updater: ctx.sender(),
    });
}

public(package) fun clear_active(
    content: &mut SoulContent,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    ctx: &TxContext,
) {
    assert_content_matches_state(content, state);
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    assert!(
        kind_registry::descriptor_has_active_binding(descriptor),
        EKindActiveBindingNotSupported,
    );
    assert!(
        kind_registry::descriptor_op_mask(descriptor) & kind_registry::op_active_bind() != 0,
        EOpNotAllowed,
    );
    let kind_name = *kind_registry::descriptor_name(descriptor);
    if (content.active.contains(kind)) {
        let _ = content.active.remove(kind);
    };
    event::emit(ActiveBindingUpdated {
        content_id: object::id(content),
        soul_id: content.soul_id,
        kind,
        kind_name,
        binding: option::none(),
        updater: ctx.sender(),
    });
}

// ── Seal approval functions ──────────────────────────────────────────
// Declared `public` (not `entry`) so other Move modules can compose them.
// Seal client only needs the function to be callable in a PTB dryRun,
// which `public fun` satisfies.

public fun seal_approve_content_owner(
    id: vector<u8>,
    state: &SoulState,
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_content_matches_state(content, state);
    assert_canonical_name_for_kind(kind, &name);
    assert_matching_document_id(id, object::id(content), kind, name, version_index);
    let slot = borrow_slot(content, kind, name, version_index);
    assert!(!slot.deleted, EVersionDeleted);
    assert!(!slot.purged, EVersionPurged);
    assert!(slot.read_mode_mask & kind_registry::read_owner() != 0, EReadModeNotAllowed);
}

public fun seal_approve_content_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    content: &SoulContent,
    soul_grant: &SoulGrant,
    kind: u32,
    name: String,
    version_index: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_content_matches_state(content, state);
    assert_canonical_name_for_kind(kind, &name);
    assert_matching_document_id(id, object::id(content), kind, name, version_index);
    let slot = borrow_slot(content, kind, name, version_index);
    assert!(!slot.deleted, EVersionDeleted);
    assert!(!slot.purged, EVersionPurged);
    assert!(slot.read_mode_mask & kind_registry::read_grant() != 0, EReadModeNotAllowed);
    grant::assert_active_with_scope(state, soul_grant, slot.grant_scope_mask, clock, ctx);
}

/// Seal approval for slots that include `READ_PUBLIC`. Public slots still keep
/// `READ_OWNER` and Seal encryption, so the owner read path remains available.
public fun seal_approve_content_public(
    id: vector<u8>,
    state: &SoulState,
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
    _ctx: &TxContext,
) {
    assert_content_matches_state(content, state);
    assert_canonical_name_for_kind(kind, &name);
    assert_matching_document_id(id, object::id(content), kind, name, version_index);
    let slot = borrow_slot(content, kind, name, version_index);
    assert!(!slot.deleted, EVersionDeleted);
    assert!(!slot.purged, EVersionPurged);
    assert!(slot.read_mode_mask & kind_registry::read_public() != 0, EReadModeNotAllowed);
    assert!(slot.seal_encrypted, EPublicSlotNoSeal);
}

// ── Mint-time invariant: SOUL_DOC v0 + MEMORY v0 must exist ──────────

/// Called by `market::mint_soul_in_personal_kiosk_impl` before
/// `soul::share_state`. Guarantees that every shared `SoulContent` carries
/// an immutable `(KIND_SOUL_DOC, "soul", v0)` entry and at least one
/// `(KIND_MEMORY, "default", vN)` founding memory entry. Mirror / API /
/// UI layers may rely on these invariants without conditional branches.
public(package) fun assert_initial_content_complete(
    state: &SoulState,
    content: &SoulContent,
) {
    assert_content_matches_state(content, state);
    assert!(
        version_count(content, KIND_SOUL_DOC_ID, soul_doc_name()) == 1,
        EInitialSoulDocMissing,
    );
    assert!(
        version_count(content, KIND_MEMORY_ID, memory_name()) >= 1,
        EInitialMemoryMissing,
    );
}

// ── Helpers used by paid_access.move ──────────────────────────────────

public(package) fun assert_valid_content_seal_request(
    id: vector<u8>,
    state: &SoulState,
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
): u64 {
    assert_content_matches_state(content, state);
    assert_canonical_name_for_kind(kind, &name);
    assert_matching_document_id(id, object::id(content), kind, name, version_index);
    let slot = borrow_slot(content, kind, name, version_index);
    assert!(!slot.deleted, EVersionDeleted);
    assert!(!slot.purged, EVersionPurged);
    slot.grant_scope_mask
}

public(package) fun assert_slot_paid_read_allowed(
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
) {
    let slot = borrow_slot(content, kind, name, version_index);
    assert!(slot.read_mode_mask & kind_registry::read_paid() != 0, EReadModeNotAllowed);
}

// ── Validation ────────────────────────────────────────────────────────

fun assert_content_matches_state(content: &SoulContent, state: &SoulState) {
    assert!(content.soul_id == soul::soul_id(state), EContentMismatch);
    let bound = soul::content_id(state);
    assert!(bound.contains(&object::id(content)), EContentMismatch);
}

fun assert_valid_content_name(name: &String) {
    let bytes = string::as_bytes(name);
    let len = bytes.length();
    assert!(len >= 1 && len <= CONTENT_NAME_MAX_LEN, EContentNameInvalidLength);

    let mut i = 0;
    while (i < len) {
        let b = bytes[i];
        let is_lower = b >= 0x61 && b <= 0x7A;
        let is_digit = b >= 0x30 && b <= 0x39;
        let is_underscore = b == 0x5F;
        let is_dash = b == 0x2D;
        assert!(is_lower || is_digit || is_underscore || is_dash, EContentNameInvalidChar);
        i = i + 1;
    };
}

fun assert_valid_download_policy(requires_policy: bool, policy: u8) {
    if (requires_policy) {
        assert!(
            policy == DOWNLOAD_POLICY_PUBLIC
                || policy == DOWNLOAD_POLICY_OWNER_ONLY
                || policy == DOWNLOAD_POLICY_ALLOWLIST,
            EInvalidDownloadPolicy,
        );
    } else {
        assert!(policy == DOWNLOAD_POLICY_PUBLIC, EKindRequiresDownloadPolicy);
    };
}

fun assert_slot_op_allowed(
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
    op_bit: u64,
) {
    let slot = borrow_slot(content, kind, name, version_index);
    assert!(slot.op_mask & op_bit != 0, EOpNotAllowed);
}

/// Enforces that `(kind=KIND_SOUL_DOC, name="soul")` and
/// `(kind=KIND_MEMORY, name="default")` are the only allowed pairs for
/// the invariant kinds, on every public mutating / sealing path. Custom
/// and CRUD kinds (skill / sprite / audio / admin-registered) fall
/// through with no name restriction (other than the generic charset
/// guard in `assert_valid_content_name`).
fun assert_canonical_name_for_kind(kind: u32, name: &String) {
    if (kind == KIND_SOUL_DOC_ID) {
        assert!(name == &soul_doc_name(), ESoulDocNameMismatch);
    } else if (kind == KIND_MEMORY_ID) {
        assert!(name == &memory_name(), EMemoryNameMismatch);
    };
}

fun assert_matching_document_id(
    id: vector<u8>,
    content_object_id: ID,
    kind: u32,
    name: String,
    version_index: u64,
) {
    let domain = b"soul-content:";
    let domain_len = domain.length();
    assert!(domain_len == DOCUMENT_ID_DOMAIN_LEN, EDocumentIdInvalidLength);
    let content_id_bytes = content_object_id.to_bytes();
    let content_id_len = content_id_bytes.length();
    assert!(content_id_len == CONTENT_ID_LEN, EDocumentIdInvalidLength);
    let name_bytes = string::as_bytes(&name);
    let name_len = name_bytes.length();

    // 13 + 1 + 4 + 32 + name_len + 1 + 8 + 16
    let expected_len = domain_len
        + 1
        + KIND_BYTES
        + content_id_len
        + name_len
        + 1
        + VERSION_INDEX_BYTES
        + DOCUMENT_ID_NONCE_BYTES;
    assert!(id.length() == expected_len, EDocumentIdInvalidLength);

    let mut i = 0;
    while (i < domain_len) {
        assert!(id[i] == domain[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };
    assert!(id[domain_len] == DOCUMENT_ID_VERSION, EDocumentIdPrefixMismatch);

    let kind_offset = domain_len + 1;
    assert_u32_segment(&id, kind_offset, kind);

    let content_id_offset = kind_offset + KIND_BYTES;
    i = 0;
    while (i < content_id_len) {
        assert!(id[content_id_offset + i] == content_id_bytes[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };

    let name_offset = content_id_offset + content_id_len;
    i = 0;
    while (i < name_len) {
        assert!(id[name_offset + i] == name_bytes[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };
    assert!(id[name_offset + name_len] == 0x00, EDocumentIdPrefixMismatch);

    assert_u64_segment(&id, name_offset + name_len + 1, version_index);
}

fun assert_u32_segment(id: &vector<u8>, start: u64, value: u32) {
    let mut shift: u8 = 24;
    let mut index: u64 = 0;
    while (index < 4) {
        let byte = ((value >> shift) & 0xFF) as u8;
        assert!(id[start + index] == byte, EDocumentIdPrefixMismatch);
        shift = if (shift >= 8) shift - 8 else 0;
        index = index + 1;
    };
}

fun assert_u64_segment(id: &vector<u8>, start: u64, value: u64) {
    let mut shift: u8 = 56;
    let mut index: u64 = 0;
    while (index < 8) {
        let byte = ((value >> shift) & 0xFF) as u8;
        assert!(id[start + index] == byte, EDocumentIdPrefixMismatch);
        shift = if (shift >= 8) shift - 8 else 0;
        index = index + 1;
    };
}

// ── Test helpers ──────────────────────────────────────────────────────

#[test_only]
public fun destroy_for_testing(self: SoulContent) {
    let SoulContent {
        id,
        version: _,
        soul_id: _,
        items,
        count_by_kind,
        active,
    } = self;
    table::drop(items);
    table::drop(count_by_kind);
    table::drop(active);
    id.delete();
}
