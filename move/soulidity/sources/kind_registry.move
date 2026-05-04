module soulidity::kind_registry;

use std::string::{Self as string, String};
use sui::event;
use sui::table::{Self as table, Table};
use soulidity::grant;

const EKindNameEmpty: u64 = 1;
const EKindNameTaken: u64 = 2;
const EKindNotFound: u64 = 3;
const EKindDeprecated: u64 = 4;
const EInvalidDefaultGrantScope: u64 = 5;
const EKindNameInvalidLength: u64 = 6;
const EKindNameInvalidChar: u64 = 7;
const EOpMaskUnknownBit: u64 = 8;
const EReadModeUnknownBit: u64 = 9;
const ENoReadModeMask: u64 = 10;
const EReadModeOwnerRequired: u64 = 11;
const EActiveBindingMaskInconsistent: u64 = 12;
const EPublicRequiresDownloadPolicy: u64 = 13;
const EDownloadPolicyRequiresPublic: u64 = 14;

/// Built-in kind ids reserved at publish time.
const KIND_SOUL_DOC: u32 = 0;
const KIND_MEMORY: u32 = 1;
const KIND_SKILL: u32 = 2;
const KIND_SPRITE: u32 = 3;
const KIND_AUDIO: u32 = 4;
/// Ids 5..=15 are reserved for future built-ins (e.g. video, model3d, prompt)
/// and must not be issued via `register_kind`. Custom kinds start at 16.
const FIRST_CUSTOM_KIND: u32 = 16;

const KIND_NAME_MAX_LEN: u64 = 32;
const VERSION: u64 = 1;

// ── Op-mask bits ──────────────────────────────────────────────────────
//
// `op_mask` describes which user-callable operations are permitted on a
// content slot. Each `ContentSlot` snapshots the descriptor's `op_mask`
// at append time, so historical slots stay operable even if the kind is
// later deprecated. `OP_ACTIVE_BIND` must be in lock-step with the
// descriptor's `has_active_binding` boolean.
const OP_APPEND: u64 = 1 << 0;
const OP_DELETE: u64 = 1 << 1;
const OP_PURGE: u64 = 1 << 2;
const OP_ACTIVE_BIND: u64 = 1 << 3;
const OP_MASK_ALL: u64 = OP_APPEND | OP_DELETE | OP_PURGE | OP_ACTIVE_BIND;

// ── Read-mode bits ────────────────────────────────────────────────────
//
// `read_mode_mask` describes which read paths a kind may expose. `READ_OWNER`
// is mandatory for every kind — owner (and owner-issued grant agents) must
// always be able to read. `READ_PUBLIC` marks public readability, but slot
// masks must still include `READ_OWNER`; public slots remain Seal-encrypted
// so the owner approval path never disappears.
const READ_OWNER: u64 = 1 << 0;
const READ_GRANT: u64 = 1 << 1;
const READ_PAID: u64 = 1 << 2;
const READ_PUBLIC: u64 = 1 << 3;
const READ_MODE_MASK_ALL: u64 = READ_OWNER | READ_GRANT | READ_PAID | READ_PUBLIC;

public struct KindDescriptor has copy, drop, store {
    version: u64,
    kind: u32,
    name: String,
    /// Bit-OR of `OP_*` constants. Cached into `ContentSlot.op_mask` at
    /// append time and consulted from there during delete/purge/set_active.
    op_mask: u64,
    /// Bit-OR of `READ_*` constants. Each slot picks an in-mask non-empty
    /// subset at append time (`slot_read_mode_mask`) which is also cached
    /// onto the slot. Must always include `READ_OWNER`.
    read_mode_mask: u64,
    /// Equivalent to `(op_mask & OP_ACTIVE_BIND != 0)`. Kept as an explicit
    /// boolean so existing callers (content::set_active mismatch check)
    /// don't need to reach into op_mask.
    has_active_binding: bool,
    requires_download_policy: bool,
    /// Cached on append into `ContentSlot.grant_scope_mask`. Must be a
    /// single grant-scope bit (`SCOPE_SEAL`/`MEMORY`/`SKILLS`/`ASSETS`) when
    /// `read_mode_mask` permits grant or paid reads, otherwise must be 0.
    default_grant_scope_mask: u64,
    deprecated: bool,
}

public struct KindRegistry has key {
    id: UID,
    version: u64,
    /// Monotonically increasing custom-kind allocator. Starts at 16.
    next_kind: u32,
    kinds: Table<u32, KindDescriptor>,
    name_to_kind: Table<String, u32>,
}

public struct KindAdminCap has key, store {
    id: UID,
}

public struct KindRegistryCreated has copy, drop {
    registry_id: ID,
    admin_cap_id: ID,
}

public struct KindRegistered has copy, drop {
    registry_id: ID,
    kind: u32,
    name: String,
    op_mask: u64,
    read_mode_mask: u64,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
}

public struct KindDeprecated has copy, drop {
    registry_id: ID,
    kind: u32,
    name: String,
}

public struct KindReactivated has copy, drop {
    registry_id: ID,
    kind: u32,
    name: String,
}

// ── Built-in kind ids exposed to other modules ────────────────────────

public fun kind_soul_doc(): u32 { KIND_SOUL_DOC }

public fun kind_memory(): u32 { KIND_MEMORY }

public fun kind_skill(): u32 { KIND_SKILL }

public fun kind_sprite(): u32 { KIND_SPRITE }

public fun kind_audio(): u32 { KIND_AUDIO }

public fun first_custom_kind(): u32 { FIRST_CUSTOM_KIND }

// ── Op-mask bit accessors ─────────────────────────────────────────────

public fun op_append(): u64 { OP_APPEND }
public fun op_delete(): u64 { OP_DELETE }
public fun op_purge(): u64 { OP_PURGE }
public fun op_active_bind(): u64 { OP_ACTIVE_BIND }

// ── Read-mode bit accessors ───────────────────────────────────────────

public fun read_owner(): u64 { READ_OWNER }
public fun read_grant(): u64 { READ_GRANT }
public fun read_paid(): u64 { READ_PAID }
public fun read_public(): u64 { READ_PUBLIC }

// ── Descriptor accessors ──────────────────────────────────────────────

public fun descriptor_kind(d: &KindDescriptor): u32 { d.kind }

public fun protocol_version(): u64 { VERSION }

public fun descriptor_version(d: &KindDescriptor): u64 { d.version }

public fun descriptor_name(d: &KindDescriptor): &String { &d.name }

public fun descriptor_op_mask(d: &KindDescriptor): u64 { d.op_mask }

public fun descriptor_read_mode_mask(d: &KindDescriptor): u64 { d.read_mode_mask }

public fun descriptor_has_active_binding(d: &KindDescriptor): bool { d.has_active_binding }

public fun descriptor_requires_download_policy(d: &KindDescriptor): bool { d.requires_download_policy }

public fun descriptor_default_grant_scope_mask(d: &KindDescriptor): u64 { d.default_grant_scope_mask }

public fun descriptor_deprecated(d: &KindDescriptor): bool { d.deprecated }

public fun registry_id(self: &KindRegistry): ID { object::id(self) }

public fun registry_version(self: &KindRegistry): u64 { self.version }

public fun next_kind(self: &KindRegistry): u32 { self.next_kind }

public fun contains_kind(self: &KindRegistry, kind: u32): bool {
    self.kinds.contains(kind)
}

public fun contains_name(self: &KindRegistry, name: String): bool {
    self.name_to_kind.contains(name)
}

/// Aborts with `EKindNotFound` if `kind` is not registered.
public fun borrow_descriptor(self: &KindRegistry, kind: u32): &KindDescriptor {
    assert!(self.kinds.contains(kind), EKindNotFound);
    self.kinds.borrow(kind)
}

public fun kind_for_name(self: &KindRegistry, name: String): u32 {
    assert!(self.name_to_kind.contains(name), EKindNotFound);
    *self.name_to_kind.borrow(name)
}

// ── Init ──────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    let mut registry = KindRegistry {
        id: object::new(ctx),
        version: VERSION,
        next_kind: FIRST_CUSTOM_KIND,
        kinds: table::new(ctx),
        name_to_kind: table::new(ctx),
    };

    // Built-in kinds. Names are canonical lowercase bytes.
    //
    // SOUL_DOC: mint-only, owner+grant readable, no PUBLIC/PAID. The on-chain
    // soul.md is appended once during mint and is forever immutable.
    insert_descriptor_unchecked(
        &mut registry,
        KIND_SOUL_DOC,
        b"soul_doc".to_string(),
        0,
        READ_OWNER | READ_GRANT,
        false,
        false,
        grant::scope_seal(),
    );
    // MEMORY: owner-/agent-mutable timeline. memory.md may be appended,
    // soft-deleted, or hard-purged; readable by owner and grant agents.
    insert_descriptor_unchecked(
        &mut registry,
        KIND_MEMORY,
        b"memory".to_string(),
        OP_APPEND | OP_DELETE | OP_PURGE,
        READ_OWNER | READ_GRANT,
        false,
        false,
        grant::scope_memory(),
    );
    // SKILL: full CRUD, owner+grant readable.
    insert_descriptor_unchecked(
        &mut registry,
        KIND_SKILL,
        b"skill".to_string(),
        OP_APPEND | OP_DELETE | OP_PURGE,
        READ_OWNER | READ_GRANT,
        false,
        false,
        grant::scope_skills(),
    );
    // SPRITE / AUDIO: full CRUD plus active-binding; all four read modes
    // (owner / grant / paid / public). Slots pick a subset at append time.
    insert_descriptor_unchecked(
        &mut registry,
        KIND_SPRITE,
        b"sprite".to_string(),
        OP_APPEND | OP_DELETE | OP_PURGE | OP_ACTIVE_BIND,
        READ_OWNER | READ_GRANT | READ_PAID | READ_PUBLIC,
        true,
        true,
        grant::scope_assets(),
    );
    insert_descriptor_unchecked(
        &mut registry,
        KIND_AUDIO,
        b"audio".to_string(),
        OP_APPEND | OP_DELETE | OP_PURGE | OP_ACTIVE_BIND,
        READ_OWNER | READ_GRANT | READ_PAID | READ_PUBLIC,
        true,
        true,
        grant::scope_assets(),
    );

    let admin_cap = KindAdminCap { id: object::new(ctx) };
    let registry_id = object::id(&registry);
    let admin_cap_id = object::id(&admin_cap);
    event::emit(KindRegistryCreated {
        registry_id,
        admin_cap_id,
    });

    transfer::share_object(registry);
    transfer::transfer(admin_cap, ctx.sender());
}

fun insert_descriptor_unchecked(
    registry: &mut KindRegistry,
    kind: u32,
    name: String,
    op_mask: u64,
    read_mode_mask: u64,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
) {
    assert_descriptor_well_formed(
        op_mask,
        read_mode_mask,
        has_active_binding,
        requires_download_policy,
        default_grant_scope_mask,
    );
    let registry_id = object::id(registry);
    let descriptor = KindDescriptor {
        version: VERSION,
        kind,
        name: copy name,
        op_mask,
        read_mode_mask,
        has_active_binding,
        requires_download_policy,
        default_grant_scope_mask,
        deprecated: false,
    };
    registry.kinds.add(kind, descriptor);
    registry.name_to_kind.add(copy name, kind);
    event::emit(KindRegistered {
        registry_id,
        kind,
        name,
        op_mask,
        read_mode_mask,
        has_active_binding,
        requires_download_policy,
        default_grant_scope_mask,
    });
}

// ── Admin entries ─────────────────────────────────────────────────────

public fun register_kind(
    registry: &mut KindRegistry,
    _: &KindAdminCap,
    name: String,
    op_mask: u64,
    read_mode_mask: u64,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
    _ctx: &mut TxContext,
): u32 {
    assert_valid_kind_name(&name);
    assert!(!registry.name_to_kind.contains(name), EKindNameTaken);

    let kind = registry.next_kind;
    registry.next_kind = kind + 1;
    insert_descriptor_unchecked(
        registry,
        kind,
        name,
        op_mask,
        read_mode_mask,
        has_active_binding,
        requires_download_policy,
        default_grant_scope_mask,
    );
    kind
}

public fun deprecate_kind(
    registry: &mut KindRegistry,
    _: &KindAdminCap,
    kind: u32,
    _ctx: &TxContext,
) {
    assert!(registry.kinds.contains(kind), EKindNotFound);
    let registry_id = object::id(registry);
    let descriptor = registry.kinds.borrow_mut(kind);
    assert!(!descriptor.deprecated, EKindDeprecated);
    descriptor.deprecated = true;
    event::emit(KindDeprecated {
        registry_id,
        kind,
        name: descriptor.name,
    });
}

public fun reactivate_kind(
    registry: &mut KindRegistry,
    _: &KindAdminCap,
    kind: u32,
    _ctx: &TxContext,
) {
    assert!(registry.kinds.contains(kind), EKindNotFound);
    let registry_id = object::id(registry);
    let descriptor = registry.kinds.borrow_mut(kind);
    descriptor.deprecated = false;
    event::emit(KindReactivated {
        registry_id,
        kind,
        name: descriptor.name,
    });
}

// ── Helpers used by content.move during append ────────────────────────

public(package) fun assert_kind_active(registry: &KindRegistry, kind: u32) {
    assert!(registry.kinds.contains(kind), EKindNotFound);
    let descriptor = registry.kinds.borrow(kind);
    assert!(!descriptor.deprecated, EKindDeprecated);
}

// ── Validation ────────────────────────────────────────────────────────

fun assert_valid_kind_name(name: &String) {
    let bytes = string::as_bytes(name);
    let len = bytes.length();
    assert!(len >= 1 && len <= KIND_NAME_MAX_LEN, EKindNameInvalidLength);

    let mut i = 0;
    while (i < len) {
        let b = bytes[i];
        // canonical bytes: [a-z0-9_-]
        let is_lower = b >= 0x61 && b <= 0x7A;
        let is_digit = b >= 0x30 && b <= 0x39;
        let is_underscore = b == 0x5F;
        let is_dash = b == 0x2D;
        assert!(is_lower || is_digit || is_underscore || is_dash, EKindNameInvalidChar);
        i = i + 1;
    };
    assert!(len > 0, EKindNameEmpty);
}

/// Cross-field validation shared by built-in pre-registration and admin
/// `register_kind`. Enforces the Phase 2 op/read-mode invariants.
fun assert_descriptor_well_formed(
    op_mask: u64,
    read_mode_mask: u64,
    has_active_binding: bool,
    requires_download_policy: bool,
    default_grant_scope_mask: u64,
) {
    // op_mask must be a subset of the four known bits.
    assert!((op_mask & OP_MASK_ALL) == op_mask, EOpMaskUnknownBit);

    // read_mode_mask: subset of known bits, non-empty, must include OWNER.
    assert!((read_mode_mask & READ_MODE_MASK_ALL) == read_mode_mask, EReadModeUnknownBit);
    assert!(read_mode_mask != 0, ENoReadModeMask);
    assert!((read_mode_mask & READ_OWNER) != 0, EReadModeOwnerRequired);

    // has_active_binding must be in lock-step with OP_ACTIVE_BIND.
    let has_active_op = (op_mask & OP_ACTIVE_BIND) != 0;
    assert!(has_active_op == has_active_binding, EActiveBindingMaskInconsistent);

    // PUBLIC <-> requires_download_policy double-implication. PUBLIC slots
    // need the policy enum (PUBLIC / OWNER_ONLY / ALLOWLIST). Kinds that
    // never expose PUBLIC must keep the policy slot fixed at 0.
    let has_public_read = (read_mode_mask & READ_PUBLIC) != 0;
    if (has_public_read) {
        assert!(requires_download_policy, EPublicRequiresDownloadPolicy);
    } else {
        assert!(!requires_download_policy, EDownloadPolicyRequiresPublic);
    };

    // default_grant_scope_mask gating: non-zero iff GRANT or PAID is allowed.
    assert_valid_default_grant_scope(default_grant_scope_mask, read_mode_mask);
}

fun assert_valid_default_grant_scope(mask: u64, read_mode_mask: u64) {
    let needs_scoped_read = (read_mode_mask & (READ_GRANT | READ_PAID)) != 0;
    if (!needs_scoped_read) {
        // Owner-only / public-only kinds: no grant or paid read path,
        // so the cached scope mask must be zero.
        assert!(mask == 0, EInvalidDefaultGrantScope);
    } else {
        // A grant/paid-readable kind must have exactly one grant-scope bit
        // set. We deliberately reject combined masks (e.g. SEAL|MEMORY) so
        // that the slot's cached scope is unambiguous at seal time.
        let allowed = grant::scope_seal()
            | grant::scope_memory()
            | grant::scope_skills()
            | grant::scope_assets();
        assert!(mask != 0, EInvalidDefaultGrantScope);
        assert!((mask & allowed) == mask, EInvalidDefaultGrantScope);
        assert!(is_single_bit(mask), EInvalidDefaultGrantScope);
    };
}

fun is_single_bit(mask: u64): bool {
    mask != 0 && (mask & (mask - 1)) == 0
}

// ── Test helpers ──────────────────────────────────────────────────────

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx)
}

#[test_only]
public fun destroy_admin_cap_for_testing(cap: KindAdminCap) {
    let KindAdminCap { id } = cap;
    id.delete();
}
