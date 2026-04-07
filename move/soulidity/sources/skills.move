module soulidity::skills;

use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::dynamic_object_field as dof;
use sui::event;
use sui::table;
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::soul::{Self as soul, SoulState};
use walrus::blob::{Self as blob, Blob};

const EDocumentIdTooShort: u64 = 0;
const EDocumentIdPrefixMismatch: u64 = 1;
const ESkillsStateMismatch: u64 = 2;
const ESkillSlotMissing: u64 = 3;
const ESkillVersionDeleted: u64 = 4;
const EEmptySkillName: u64 = 5;

const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

public struct SkillSlot has copy, drop, store {
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    created_at_ms: u64,
}

public struct SoulSkills has key {
    id: UID,
    soul_id: ID,
    skills: table::Table<String, vector<SkillSlot>>,
    skill_count: u64,
}

public struct SkillBlobKey has copy, drop, store {
    skill_name: String,
    version_index: u64,
}

public struct SoulSkillsCreated has copy, drop {
    skills_id: ID,
    soul_id: ID,
}

public struct SkillVersionAppended has copy, drop {
    skills_id: ID,
    soul_id: ID,
    skill_name: String,
    version_index: u64,
    is_public: bool,
    created_at_ms: u64,
    blob_object_id: ID,
}

public struct SkillVersionDeleted has copy, drop {
    skills_id: ID,
    soul_id: ID,
    skill_name: String,
    version_index: u64,
    deleted_by: address,
}

public fun soul_id(self: &SoulSkills): ID {
    self.soul_id
}

public fun skills_id(self: &SoulSkills): ID {
    object::id(self)
}

public fun skill_count(self: &SoulSkills): u64 {
    self.skill_count
}

public fun contains_skill(self: &SoulSkills, skill_name: String): bool {
    table::contains(&self.skills, skill_name)
}

public fun version_count(self: &SoulSkills, skill_name: String): u64 {
    if (!table::contains(&self.skills, copy skill_name)) {
        return 0
    };
    table::borrow(&self.skills, skill_name).length()
}

public fun blob_object_id_for(self: &SoulSkills, skill_name: String, version_index: u64): ID {
    borrow_slot(self, skill_name, version_index).blob_object_id
}

public fun version_is_public(self: &SoulSkills, skill_name: String, version_index: u64): bool {
    borrow_slot(self, skill_name, version_index).is_public
}

public fun version_is_deleted(self: &SoulSkills, skill_name: String, version_index: u64): bool {
    borrow_slot(self, skill_name, version_index).deleted
}

public fun version_created_at_ms(self: &SoulSkills, skill_name: String, version_index: u64): u64 {
    borrow_slot(self, skill_name, version_index).created_at_ms
}

public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulSkills {
    let skills = SoulSkills {
        id: object::new(ctx),
        soul_id,
        skills: table::new(ctx),
        skill_count: 0,
    };

    event::emit(SoulSkillsCreated {
        skills_id: object::id(&skills),
        soul_id,
    });

    skills
}

public(package) fun append_initial_version(
    skills: &mut SoulSkills,
    skill_name: String,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    append_version_impl(skills, skill_name, is_public, content_blob, clock, ctx)
}

public fun append_version_as_owner(
    skills: &mut SoulSkills,
    state: &SoulState,
    skill_name: String,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    soul::assert_owner(state, ctx.sender());
    assert_skills_matches_state(skills, state);
    append_version_impl(skills, skill_name, is_public, content_blob, clock, ctx)
}

public fun append_version_as_granted_agent(
    skills: &mut SoulSkills,
    state: &SoulState,
    soul_grant: &SoulGrant,
    skill_name: String,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    assert_skills_matches_state(skills, state);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_skills(), clock, ctx);
    append_version_impl(skills, skill_name, is_public, content_blob, clock, ctx)
}

public fun delete_version_as_owner(
    skills: &mut SoulSkills,
    state: &SoulState,
    skill_name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_skills_matches_state(skills, state);
    let slot = borrow_slot_mut(skills, copy skill_name, version_index);
    assert!(!slot.deleted, ESkillVersionDeleted);
    slot.deleted = true;
    event::emit(SkillVersionDeleted {
        skills_id: object::id(skills),
        soul_id: soul::soul_id(state),
        skill_name,
        version_index,
        deleted_by: ctx.sender(),
    });
}

public fun delete_version_as_granted_agent(
    skills: &mut SoulSkills,
    state: &SoulState,
    skill_name: String,
    version_index: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_skills_matches_state(skills, state);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_skills(), clock, ctx);
    let slot = borrow_slot_mut(skills, copy skill_name, version_index);
    assert!(!slot.deleted, ESkillVersionDeleted);
    slot.deleted = true;
    event::emit(SkillVersionDeleted {
        skills_id: object::id(skills),
        soul_id: soul::soul_id(state),
        skill_name,
        version_index,
        deleted_by: ctx.sender(),
    });
}

entry fun approve_private_read_owner(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    skill_name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, object::id(skills), copy skill_name, version_index);
    soul::assert_owner(state, ctx.sender());
    assert_skills_matches_state(skills, state);
    let slot = borrow_slot(skills, skill_name, version_index);
    assert!(!slot.deleted, ESkillVersionDeleted);
}

entry fun approve_private_read_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    skill_name: String,
    version_index: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, object::id(skills), copy skill_name, version_index);
    assert_skills_matches_state(skills, state);
    let slot = borrow_slot(skills, skill_name, version_index);
    assert!(!slot.deleted, ESkillVersionDeleted);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_skills(), clock, ctx);
}

fun append_version_impl(
    skills: &mut SoulSkills,
    skill_name: String,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    _ctx: &mut TxContext,
): u64 {
    assert!(!string::is_empty(&skill_name), EEmptySkillName);

    let created_at_ms = clock.timestamp_ms();
    let blob_object_id = blob::object_id(&content_blob);
    let slot = SkillSlot {
        blob_object_id,
        is_public,
        deleted: false,
        created_at_ms,
    };

    let version_index = if (table::contains(&skills.skills, copy skill_name)) {
        let slots = table::borrow_mut(&mut skills.skills, copy skill_name);
        let next_index = slots.length();
        vector::push_back(slots, slot);
        next_index
    } else {
        table::add(&mut skills.skills, copy skill_name, vector[slot]);
        skills.skill_count = skills.skill_count + 1;
        0
    };

    dof::add(
        &mut skills.id,
        SkillBlobKey {
            skill_name: copy skill_name,
            version_index,
        },
        content_blob,
    );
    event::emit(SkillVersionAppended {
        skills_id: object::id(skills),
        soul_id: skills.soul_id,
        skill_name,
        version_index,
        is_public,
        created_at_ms,
        blob_object_id,
    });

    version_index
}

fun assert_skills_matches_state(skills: &SoulSkills, state: &SoulState) {
    assert!(skills.soul_id == soul::soul_id(state), ESkillsStateMismatch);
}

fun borrow_slot(skills: &SoulSkills, skill_name: String, version_index: u64): &SkillSlot {
    assert!(table::contains(&skills.skills, copy skill_name), ESkillSlotMissing);
    let slots = table::borrow(&skills.skills, skill_name);
    assert!(version_index < slots.length(), ESkillSlotMissing);
    vector::borrow(slots, version_index)
}

fun borrow_slot_mut(skills: &mut SoulSkills, skill_name: String, version_index: u64): &mut SkillSlot {
    assert!(table::contains(&skills.skills, copy skill_name), ESkillSlotMissing);
    let slots = table::borrow_mut(&mut skills.skills, skill_name);
    assert!(version_index < slots.length(), ESkillSlotMissing);
    vector::borrow_mut(slots, version_index)
}

fun assert_matching_document_id(
    id: vector<u8>,
    skills_id: ID,
    skill_name: String,
    version_index: u64,
) {
    let domain = b"soul-skill:";
    let domain_len = domain.length();
    let skills_id_bytes = skills_id.to_bytes();
    let skills_id_len = skills_id_bytes.length();
    let skill_name_bytes = string::as_bytes(&skill_name);
    let skill_name_len = skill_name_bytes.length();
    assert!(
        id.length() >= domain_len + 1 + skills_id_len + skill_name_len + 1 + 8 + DOCUMENT_ID_NONCE_BYTES,
        EDocumentIdTooShort,
    );

    let mut i = 0;
    while (i < domain_len) {
        assert!(id[i] == domain[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };

    assert!(id[domain_len] == DOCUMENT_ID_VERSION, EDocumentIdPrefixMismatch);

    let skills_id_offset = domain_len + 1;
    i = 0;
    while (i < skills_id_len) {
        assert!(id[skills_id_offset + i] == skills_id_bytes[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };

    let skill_name_offset = skills_id_offset + skills_id_len;
    i = 0;
    while (i < skill_name_len) {
        assert!(id[skill_name_offset + i] == skill_name_bytes[i], EDocumentIdPrefixMismatch);
        i = i + 1;
    };
    assert!(id[skill_name_offset + skill_name_len] == 0x00, EDocumentIdPrefixMismatch);

    assert_u64_segment(&id, skill_name_offset + skill_name_len + 1, version_index);
}

fun assert_u64_segment(id: &vector<u8>, start: u64, value: u64) {
    let mut shift = 56;
    let mut index = 0;
    while (index < 8) {
        let expected = ((value >> shift) & 0xFF) as u8;
        assert!(id[start + index] == expected, EDocumentIdPrefixMismatch);
        shift = if (shift >= 8) shift - 8 else 0;
        index = index + 1;
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
    skill_name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    approve_private_read_owner(id, state, skills, skill_name, version_index, ctx)
}

#[test_only]
public(package) fun approve_private_read_as_granted_agent_for_testing(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    skill_name: String,
    version_index: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    approve_private_read_granted_agent(id, state, skills, skill_name, version_index, soul_grant, clock, ctx)
}

#[test_only]
public fun destroy_for_testing(self: SoulSkills) {
    let SoulSkills {
        id,
        soul_id: _,
        skills,
        skill_count: _,
    } = self;
    table::drop(skills);
    id.delete();
}
