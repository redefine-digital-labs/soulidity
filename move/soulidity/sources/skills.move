module soulidity::skills;

use sui::clock::Clock;
use sui::event;
use sui::table;
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::soul::{Self as soul, SoulState};
use walrus::blob::{Self as blob, Blob};

const EDocumentIdTooShort: u64 = 0;
const EDocumentIdPrefixMismatch: u64 = 1;
const ESkillsStateMismatch: u64 = 2;
const ESkillVersionSoulMismatch: u64 = 3;
const ESkillVersionSkillsMismatch: u64 = 4;
const ESkillVersionDeleted: u64 = 5;

const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

public struct SoulSkills has key {
    id: UID,
    soul_id: ID,
    next_version: u64,
    version_count: u64,
    latest_version_id: Option<ID>,
    version_index: table::Table<u64, ID>,
}

public struct SkillVersion has key, store {
    id: UID,
    soul_id: ID,
    skills_id: ID,
    version: u64,
    previous_version_id: Option<ID>,
    is_public: bool,
    deleted: bool,
    created_at_ms: u64,
    content_blob: Blob,
}

public struct SoulSkillsCreated has copy, drop {
    skills_id: ID,
    soul_id: ID,
}

public struct SkillVersionAppended has copy, drop {
    skills_id: ID,
    soul_id: ID,
    version_id: ID,
    version: u64,
    previous_version_id: Option<ID>,
    is_public: bool,
    created_at_ms: u64,
    blob_object_id: ID,
}

public struct SkillVersionDeleted has copy, drop {
    skills_id: ID,
    soul_id: ID,
    version_id: ID,
    deleted_by: address,
}

public fun soul_id(self: &SoulSkills): ID {
    self.soul_id
}

public fun skills_id(self: &SoulSkills): ID {
    object::id(self)
}

public fun version_count(self: &SoulSkills): u64 {
    self.version_count
}

public fun latest_version_id(self: &SoulSkills): &Option<ID> {
    &self.latest_version_id
}

public fun version_id_for(self: &SoulSkills, version_number: u64): ID {
    *table::borrow(&self.version_index, version_number)
}

public fun skills_id_on_version(self: &SkillVersion): ID {
    self.skills_id
}

public fun version_number(self: &SkillVersion): u64 {
    self.version
}

public fun previous_version_id(self: &SkillVersion): &Option<ID> {
    &self.previous_version_id
}

public fun is_public(self: &SkillVersion): bool {
    self.is_public
}

public fun is_deleted(self: &SkillVersion): bool {
    self.deleted
}

public fun created_at_ms(self: &SkillVersion): u64 {
    self.created_at_ms
}

public fun content_blob_object_id(self: &SkillVersion): ID {
    blob::object_id(&self.content_blob)
}

public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulSkills {
    let skills = SoulSkills {
        id: object::new(ctx),
        soul_id,
        next_version: 1,
        version_count: 0,
        latest_version_id: option::none(),
        version_index: table::new(ctx),
    };

    event::emit(SoulSkillsCreated {
        skills_id: object::id(&skills),
        soul_id,
    });

    skills
}

public(package) fun append_initial_version(
    skills: &mut SoulSkills,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    append_version_impl(skills, is_public, content_blob, clock, ctx)
}

public fun append_version_as_owner(
    skills: &mut SoulSkills,
    state: &SoulState,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    soul::assert_owner(state, ctx.sender());
    assert_skills_matches_state(skills, state);
    append_version_impl(skills, is_public, content_blob, clock, ctx)
}

public fun append_version_as_granted_agent(
    skills: &mut SoulSkills,
    state: &SoulState,
    soul_grant: &SoulGrant,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    assert_skills_matches_state(skills, state);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_skills(), clock, ctx);
    append_version_impl(skills, is_public, content_blob, clock, ctx)
}

public fun delete_version_as_owner(
    skills: &SoulSkills,
    version: &mut SkillVersion,
    state: &SoulState,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_version_matches(skills, version, state);
    version.deleted = true;
    event::emit(SkillVersionDeleted {
        skills_id: object::id(skills),
        soul_id: soul::soul_id(state),
        version_id: object::id(version),
        deleted_by: ctx.sender(),
    });
}

public fun delete_version_as_granted_agent(
    skills: &SoulSkills,
    version: &mut SkillVersion,
    state: &SoulState,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_version_matches(skills, version, state);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_skills(), clock, ctx);
    version.deleted = true;
    event::emit(SkillVersionDeleted {
        skills_id: object::id(skills),
        soul_id: soul::soul_id(state),
        version_id: object::id(version),
        deleted_by: ctx.sender(),
    });
}

entry fun approve_private_read_owner(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    version: &SkillVersion,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, object::id(version));
    soul::assert_owner(state, ctx.sender());
    assert_version_matches(skills, version, state);
    assert!(!version.deleted, ESkillVersionDeleted);
}

entry fun approve_private_read_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    version: &SkillVersion,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, object::id(version));
    assert_version_matches(skills, version, state);
    assert!(!version.deleted, ESkillVersionDeleted);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_skills(), clock, ctx);
}

fun append_version_impl(
    skills: &mut SoulSkills,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    let previous_version_id = skills.latest_version_id;
    let version_number = skills.next_version;
    let version = SkillVersion {
        id: object::new(ctx),
        soul_id: skills.soul_id,
        skills_id: object::id(skills),
        version: version_number,
        previous_version_id,
        is_public,
        deleted: false,
        created_at_ms: clock.timestamp_ms(),
        content_blob,
    };
    let version_id = object::id(&version);
    let blob_object_id = blob::object_id(&version.content_blob);

    skills.next_version = skills.next_version + 1;
    skills.version_count = skills.version_count + 1;
    skills.latest_version_id = option::some(version_id);
    table::add(&mut skills.version_index, version_number, version_id);

    transfer::share_object(version);
    event::emit(SkillVersionAppended {
        skills_id: object::id(skills),
        soul_id: skills.soul_id,
        version_id,
        version: skills.next_version - 1,
        previous_version_id,
        is_public,
        created_at_ms: clock.timestamp_ms(),
        blob_object_id,
    });

    version_id
}

fun assert_skills_matches_state(skills: &SoulSkills, state: &SoulState) {
    assert!(skills.soul_id == soul::soul_id(state), ESkillsStateMismatch);
}

fun assert_version_matches(skills: &SoulSkills, version: &SkillVersion, state: &SoulState) {
    assert_skills_matches_state(skills, state);
    assert!(version.soul_id == soul::soul_id(state), ESkillVersionSoulMismatch);
    assert!(version.skills_id == object::id(skills), ESkillVersionSkillsMismatch);
}

fun assert_matching_document_id(id: vector<u8>, version_id: ID) {
    let domain = b"soul-skill:";
    let domain_len = domain.length();
    let version_id_bytes = version_id.to_bytes();
    let version_id_len = version_id_bytes.length();
    assert!(
        id.length() >= domain_len + 1 + version_id_len + DOCUMENT_ID_NONCE_BYTES,
        EDocumentIdTooShort,
    );

    let mut i = 0;
    while (i < domain_len) {
        assert!(id[i] == domain[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };

    assert!(id[domain_len] == DOCUMENT_ID_VERSION, EDocumentIdPrefixMismatch);

    let version_id_offset = domain_len + 1;
    i = 0;
    while (i < version_id_len) {
        assert!(id[version_id_offset + i] == version_id_bytes[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };
}

public(package) fun share_skills(skills: SoulSkills) {
    transfer::share_object(skills);
}

#[test_only]
public(package) fun approve_private_read_as_owner_for_testing(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    version: &SkillVersion,
    ctx: &TxContext,
) {
    approve_private_read_owner(id, state, skills, version, ctx)
}

#[test_only]
public(package) fun approve_private_read_as_granted_agent_for_testing(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    version: &SkillVersion,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    approve_private_read_granted_agent(id, state, skills, version, soul_grant, clock, ctx)
}
