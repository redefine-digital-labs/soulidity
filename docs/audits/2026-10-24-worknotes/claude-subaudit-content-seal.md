# Independent Sui Move Review — Content / Seal / Grant / Paid-Access / Kinds / Loadout / Profile / Social

Package: `move/soulidity/` (edition 2024.beta). Static review only (`sui move build/test` not runnable here; `animacraft_v8_*` local deps missing).
Reviewer did NOT read `docs/audits/` or any `.claude/` content. Dependency semantics verified against:
- Sui framework `~/.move/https___github_com_MystenLabs_sui_git_a4185da5659d8d299d34e1bb2515ff1f7e32a20a/.../sources/{dynamic_field,dynamic_object_field,table}.move`
- Sui `derived_object.move` (framework/mainnet checkout; Move.lock pins several Sui revs, `derived_object` is absent from the a4185da rev)
- Sui protocol config `sui-protocol-config/src/lib.rs:2909` → `max_move_object_size: Some(250 * 1024)` (= 256 000 bytes)
- Walrus `mainnet-contracts/walrus/sources/system/blob.move`, `system.move`, `system/shared_blob.move` (rev a19764ff)

Severity scale: Critical / High / Medium / Low / Informational. Confidence: High = verified line-by-line; Medium = verified code, impact partly depends on off-chain behaviour.

---

## (a) Findings table

| ID | Severity | Location | Title | Confidence |
|----|----------|----------|-------|------------|
| CT-1 | Medium | `content.move:728-732`, `852-856` (only `dof::add`/`dof::remove`, no `dof::borrow_mut`); Walrus `system.move:177-190` | Custodied Walrus `Blob`s can never be extended → every content version, including the "forever immutable" SOUL_DOC v0, loses Walrus availability when its registered storage period ends; no on-chain remediation | High |
| CT-2 | Medium | `content.move:140`, `711-726`, `213-214`, `1144-1150`, `568-578` | Single canonical MEMORY name `"default"` stores all versions in one `vector<ContentSlot>` dynamic-field object; at ≈3 150 versions the object exceeds `max_move_object_size` and MEMORY appends are permanently blocked (grantee-griefable; purge does not shrink) | High |
| CT-3 | Medium | `content.move:780-828` (agent delete), `976-977`, `996-997`, `1017-1018`, `1074-1075` (Seal gates) | Granted-agent soft-delete is irreversible: no owner undelete exists and every `seal_approve*` path asserts `!deleted`, so a MEMORY/SKILLS/ASSETS-scoped agent can permanently destroy owner readability of all versions in its scope | High |
| CT-4 | Low | `content.move:447-514`, `757-870`; `market.move:1515-1543`, `1574-1601`; `soul.move:444-449` | No `is_listed`/market gate on content, envelope or config mutation: seller (or seller's agent) can delete/purge/append content or wipe envelopes between listing and purchase; buyer has no atomic content-state assertion (`assert_mutation_scope` only pins epoch) | High |
| CT-5 | Low | `market.move:2593-2603` vs `1515-1543`, `1574-1601` | `content_seal_envelope_v1:` prefix is reserved only in the mint path; post-mint `set_state_config*/delete_state_config*` let the owner overwrite or delete per-version Seal envelopes (asymmetric reservation) | High |
| CT-6 | Low | `grant.move:197-204`, `261-277`, `347-358`, `473-492` | Expired grants keep consuming `grant_capacity` until an explicit `cleanup_inactive_grants`; `issue` only cleans the target grantee; `revoke` on an expired/stale grantee aborts (`EGrantNotFound`) and rolls back its own cleanup | High |
| CT-7 | Low | `paid_access.move:483-497`, `597-629` | `cleanup_stale_entries` sweeps only epoch-stale entries (expired entries persist forever unless re-purchased/revoked); renewal `base + duration_ms` has no overflow guard (owner-set huge `duration_ms` makes every purchase abort) | High |
| CT-8 | Informational | `soul.move:585-608`; `grant.move:434-442`; `market.move:744-745`, `2973-2974` | `rotate_owner` does not reset `active_grant_count` itself; correctness relies on each caller pairing it with `invalidate_all_for_owner_rotation` (a wrapper that ignores both of its arguments). An unpaired future call would permanently inflate the count (stale rows never decrement it) | High |
| CT-9 | Informational | `content.move:1026-1036`; `web/lib/soulidity/content-append-preparation.ts:164-173` | `seal_approve_upload_recovery` is a stateless, author-bound KMS; the client's recovery bundle contains the content DEK, so every uploader (owner **or granted agent**) retains a perpetual Seal-backed decrypt capability for versions it uploaded, independent of later revocation, deletion, or Soul sale | High (code) / Medium (impact) |
| CT-10 | Informational | `named_loadout_v1.move:87-90`; `profile.move:273-276` | `head.version == VERSION` is inside `assert!` when reading stored heads; bumping either constant in a package upgrade makes `current_head`/`bookmarks_head` (and therefore every commit) abort for all existing heads | High |
| CT-11 | Informational | `kind_registry.move:329-356`, `457-475`; `content.move:497-499`, `795-796`, `999` | Grant scope bits are shared across kinds: an admin-registered kind that reuses `SCOPE_MEMORY` (or any built-in bit) is automatically readable/writable by every existing MEMORY-scoped grant; owners cannot scope grants per kind | High |
| CT-12 | Informational | `content.move:694-695`, `481-514`, `665-688` | Append does not check Walrus certification/expiry/`deletable` of the supplied `Blob`; an ASSETS-scoped agent may choose `READ_PUBLIC` for SPRITE/AUDIO slots, publishing content under the owner's Soul | High |

No Critical or High findings. All sender-binding Seal gates, epoch invalidation and id-namespace separation were verified to hold (section (c)).

---

## (b) Per-finding detail

### CT-1 — Custodied blobs cannot be extended; content availability has a hard expiry (Medium)

**Location.** `content.move:728-732` (`dof::add(&mut content.id, ContentBlobKey{..}, content_blob)`), `852-856` (`dof::remove` → `blob::burn`). No `dof::borrow_mut`/`&mut Blob` path anywhere in the package (grep over `sources/*.move` for `dof::`, `&mut Blob`, `extend` only hits content.move lines above).

**Description.** Walrus storage is time-bounded (`Blob.storage.end_epoch`, `blob.move:106-108`). Extending a blob requires `&mut Blob` (`system.move:177-179 extend_blob_with_resource(self, blob: &mut Blob, ..)`, `183-190 extend_blob(self, blob: &mut Blob, ..)`). Once a `Blob` is moved into the `SoulContent` dynamic object field, the only operations exposed are read via `borrow_slot` metadata and `purge_deleted_version_as_owner` (which burns it). Nothing can borrow it mutably, so no custodied blob can ever be extended.

**Failure path.**
1. Owner mints; SOUL_DOC v0 blob registered for N epochs (≤ `max_epochs_ahead`).
2. Epochs pass; `Blob.storage.end_epoch` is reached. Walrus nodes may drop slivers for that `blob_id` unless another live registration exists.
3. `content::borrow_slot(..)`/`seal_approve_content_owner(..)` still succeed on-chain (slot not deleted/purged) but the ciphertext is gone. SOUL_DOC cannot be re-appended (`append_initial_invariant_version` is package-only and asserts `!items.contains(key)` at `content.move:572`; `append_version_as_owner` fails `EOpNotAllowed` because SOUL_DOC `op_mask = 0`, `kind_registry.move:216-225`, `content.move:658-663`).

**Impact.** Permanent loss of Walrus availability for the Soul's identity document and any version the owner does not re-upload. Buyers of a Soul inherit blobs with unknown remaining lifetime.

**Mitigation that exists off-chain (not verified by code here).** Walrus availability is keyed by `blob_id`, so any party can re-register the identical ciphertext under a fresh `Blob` they control; readers that resolve `blob_id` from the custodied `Blob` object keep working. This is why severity is Medium, not High.

**Fix.** Add an owner (and optionally anyone-can-pay) `extend_content_blob(content, state, registry, walrus_system, kind, name, version_index, epochs, payment)` that `dof::borrow_mut`s the `Blob` and calls `walrus::system::extend_blob`, or emit `end_epoch` in `ContentVersionAppended` and document the re-registration duty. Record `end_epoch` on the slot so indexers can warn.

**Evidence verified.** `content.move:728-732`, `852-856`; grep for any other `dof::`/`&mut Blob` in `sources/*.move` (none); Walrus `system.move:170-190`; `blob.move:261-267` (`burn` destroys any blob, deletable or not).

---

### CT-2 — Unbounded single-object growth of the canonical MEMORY version vector (Medium)

**Location.** `SoulContent.items: Table<ContentKey, vector<ContentSlot>>` (`content.move:140`); append pushes into the existing vector (`712-716`); MEMORY is forced to the single name `"default"` (`213-214`, `assert_canonical_name_for_kind` `1144-1150`, enforced on every append path via `655`, and on the initial path `573-574`).

**Description.** Each `(kind,name)` version list is one dynamic-field value object `Field<ContentKey, vector<ContentSlot>>`. A `ContentSlot` serialises to 81 bytes (8+4+32+1+1+1+1+8+8+8+1+8). Sui rejects objects larger than `max_move_object_size = 256 000` bytes (`sui-protocol-config/src/lib.rs:2909`). Therefore after ≈(256 000 − 32 − 37 − 3)/81 ≈ 3 159 versions the `push_back` at `content.move:715` produces an object that fails the size check and every subsequent MEMORY append aborts. Purge (`859-860`) only flips `purged = true`; nothing ever removes slots or allows an alternative MEMORY name. Appends also rewrite the full vector each time, so gas grows linearly with history.

**Attack / failure path.**
1. Any grant with `SCOPE_MEMORY` (`kind_registry.move:228-237` → `grant::scope_memory()`): `append_version_as_granted_agent(.., kind=1, name="default", ..)` ≈3 150 times with minimal `Blob`s (each call passes `grant::assert_active_with_scope`, `content.move:499`).
2. Owner revokes the grant afterwards — too late; the vector is full.
3. Owner's own `append_version_as_owner` for MEMORY now aborts forever; the Soul's memory timeline is frozen.

Even without an attacker, an active agent writing memory several times a day reaches the cap in a few years.

**Impact.** Permanent denial of the core "memory" feature for that Soul; also transferred to any buyer. Irreversible without a package upgrade.

**Fix.** Store versions as `Table<ContentKey, Table<u64, ContentSlot>>` (one object per version) or `TableVec`, keeping `version_count` in a small header struct; or allow MEMORY segment names (`default`, `default-2`, …) via an explicit rotation op; or cap versions per name and expose compaction.

**Evidence verified.** `content.move:93-122` (slot layout), `140`, `711-726`, `804-828`, `857-860`; `kind_registry.move:228-237`; Sui `max_move_object_size` constant.

---

### CT-3 — Granted-agent soft-delete is irreversible; no owner undo (Medium)

**Location.** `delete_version_as_granted_agent` `content.move:780-802` → `mark_slot_deleted` `804-828`; Seal gates `976-977` (owner), `996-997` (agent), `1017-1018` (public), `1074-1075` (paid).

**Description.** Delete only needs an active grant whose scope matches the kind's `default_grant_scope_mask` plus slot `OP_DELETE` (`797`). MEMORY, SKILL, SPRITE, AUDIO all carry `OP_DELETE` (`kind_registry.move:228-270`). There is no `undelete`; `slot.deleted` is written once (`818`) and read as a hard denial by all four Seal paths. The Walrus blob and the on-chain envelope remain, but Seal key servers will never again release the key for that document id, so the owner (and paid buyers) lose the content unless they hold a cached DEK.

**Attack path.** Compromised/malicious agent with the normal MEMORY grant: loop `delete_version_as_granted_agent(content, state, registry, grant, 1, "default", i, clock)` for `i in 0..version_count` (only the active-bound version of SPRITE/AUDIO is protected, `798-800`; MEMORY/SKILL have no active binding). Owner's only remedy is `grant::revoke`, after the damage.

**Impact.** Total, irreversible loss of owner readability of memory/skills (or non-active assets). Also reduces resale value for a listed Soul (see CT-4).

**Fix.** Make agent delete a reversible tombstone the owner can clear (`undelete_version_as_owner` allowed while `!purged`), or restrict `OP_DELETE` on the agent path to versions the agent itself appended (record `appended_by` on the slot), or require a delete-lock window before purge and let `seal_approve_content_owner` ignore `deleted` (owner-only recovery read).

**Evidence verified.** All lines above; `kind_registry.move:228-270` op masks; no `undelete`/`deleted = false` anywhere in `content.move`.

---

### CT-4 — Content/envelope mutations are not gated while the Soul is listed (Low)

**Location.** Every content mutator (`content.move:447-514`, `757-870`) and `market::set_state_config*/delete_state_config*` (`market.move:1515-1543`, `1574-1601`) check only owner/grant; `soul::is_listed` (`soul.move:236-238`) is consulted only by `set_listed` and collection logic.

**Failure path.** Seller lists Soul (`is_listed = true`). Before `buy_soul_fixed_price` executes, seller (or seller's agent) soft-deletes/purges memory, appends junk versions, or `delete_state_config`s the `content_seal_envelope_v1:*` keys. Buyer pays full price for a hollowed Soul. The buyer cannot defend in-PTB: `assert_mutation_scope` (`content.move:384-391`) pins only the ownership epoch; there is no public "no version deleted / version_count == X" assertion to include atomically with the purchase.

**Impact.** Economic rug-pull on secondary sales; market custody is out of my scope but the missing content-side gate is in scope.

**Fix.** Either abort content/envelope mutations while `soul::is_listed(state)` (named_loadout intentionally skips this; content should not), or expose a read-only `assert_content_snapshot(content, expected_digest_of(items/active/deleted flags))` that buyers include in the purchase PTB.

---

### CT-5 — Envelope-key prefix reserved only at mint (Low)

**Location.** `assert_initial_config_key_unreserved` `market.move:2593-2603` (mint only) vs `set_state_config*` `1515-1529`, `1574-1588`, `delete_state_config*` `1531-1543`, `1590-1602`.

**Description.** Envelope keys are `content_seal_envelope_v1:<sha256 hex>` (`content.move:521-530`), written by `persist_append_envelope` (`534-539`) only for the version just appended. Post-mint the owner can `set_state_config` the same key with garbage or `delete_state_config` it. The owner can already destroy their own content, so there is no privilege escalation; a grantee has no path (append writes only its own new version key — `content_envelope_tests.move:79 granted_append_preserves_owner_envelope_and_unrelated_config`). Pre-planting a key for a future version is harmless because append `upsert`s (`soul.move:467-469`).

**Impact.** Consistency/UX only; combined with CT-4 it is one more rug-pull lever.

**Fix.** Move the reserved-prefix check into `soul::upsert_state_config`/`delete_state_config` callers in market (or a `public(package)` flag), keeping `content::persist_append_envelope` as the only writer.

---

### CT-6 — Expired grants hold capacity; `revoke` of an expired grant aborts (Low)

**Location.** `grant.move:197` (`cleanup_inactive_grant_for_grantee` for the *target* grantee only), `202` (capacity check), `268-269` (`revoke`), `347-358` (`cleanup_inactive_grants`).

**Path.** Capacity 1, grant to A expires. Owner issues to B → cleanup(B) no-op → `active_grant_count(1) < grant_capacity(1)` fails → `EGrantCapacityExceeded`. Owner tries `revoke(A)` → cleanup removes A and decrements count, then `assert!(active_grant_contains_grantee(A))` fails → whole tx aborts, cleanup rolled back. Owner must discover `cleanup_inactive_grants([A])`.

**Impact.** Availability/UX; no auth bypass (expired grants are rejected at `grant.move:456-458`).

**Fix.** In `issue`, when at capacity, sweep expired rows lazily or let `revoke` succeed (emit `SoulGrantExpired`) when the row is expired/stale.

---

### CT-7 — Expired paid entries never swept; renewal overflow (Low)

**Location.** `paid_access.move:597-629` (only `ownership_epoch_snapshot != current_epoch` removed), `483-489` (`now_ms + duration`), `491-497`.

**Description.** Expired entries stay until the buyer re-purchases (`452-454`) or owner revokes; storage grows with one-time buyers. `compute_expires_at_ms` adds `duration_ms` to `max(now, previous_expiry)` without a checked add; an owner configuring `duration_ms` near `u64::MAX` (allowed, `308-346`) makes every purchase abort with arithmetic overflow — self-inflicted, but the market has already moved the payment coins earlier in the same tx (reverted by the abort, so no loss).

**Fix.** Sweep `expires_at_ms <= now` in `cleanup_stale_entries` (needs `Clock`); bound `duration_ms` (e.g. ≤ 100 years) in `configure/update_paid_access_kind`.

---

### CT-8 — `rotate_owner` depends on caller discipline to reset the grant count (Informational)

**Location.** `soul.move:589-608` (`rotate_owner` increments epoch only), `585-587` (`clear_active_grant_count_for_owner_rotation`), `grant.move:434-442` (wrapper discarding `new_owner`, `invalidated_by`), call sites `market.move:744-745`, `2973-2974` (correctly paired).

**Risk.** `remove_active_grant_for_grantee` decrements only when `slot.ownership_epoch_snapshot == state.ownership_epoch` (`soul.move:579-581`), so if any future code path rotates without clearing, the stale rows can never bring the count down → permanent capacity exhaustion (`grant.move:202`). Also `active_grant_contains_grantee` requires `count > 0` (`soul.move:527`) which would be wrong in the opposite direction. `protocol_tests.move:4190` already calls `soul::rotate_owner` unpaired in a test.

**Fix.** Reset `active_grant_count = 0` inside `rotate_owner`; delete the no-op wrapper.

---

### CT-9 — Stateless author-bound recovery namespace leaves a perpetual decrypt path for uploaders (Informational)

**Location.** `content.move:1026-1036` checks only domain, version byte, length (142) and `id[30..62] == bcs(sender)`; the trailing 96 bytes are unchecked. Client: `content-append-preparation.ts:164-173` encrypts `{dek, iv, contentHash, sidecar, ...}` under that id; `content-upload-recovery-id.ts:11-31`.

**Description.** This is a sender-bound Seal "KMS": any address can mint keys for any 96-byte suffix forever. The recovery bundle holds the content DEK and is kept off-chain by the uploader. A granted agent that appended memory therefore keeps a Seal-backed capability to decrypt that version after revocation, soft-delete, or Soul sale. Since the uploader necessarily possessed the plaintext, this is not a new confidentiality leak; it is a trust-model note: "revocation" never covers content the revoked party authored, and Seal server logs will show successful approvals unrelated to any Soul state.

**Fix (optional).** Bind recovery ids to a short TTL via `Clock` (e.g. encode `expires_at_ms` in the id and assert `clock.timestamp_ms() < expires`), or document explicitly.

---

### CT-10 — Version constants asserted on stored heads (Informational)

`named_loadout_v1.move:87-90` and `profile.move:273-276` abort (`EInvalidHead`/`EInvalidBookmarksHead`) when `head.version != VERSION`. A future upgrade that bumps the constant without a migration bricks `current_head`, `commit`, `save`, `update`, `commit_bookmarks` for every existing head. Prefer soft-returning `none` for older versions or keep per-version readers.

---

### CT-11 — Scope bits are shared across kinds (Informational)

`assert_valid_default_grant_scope` (`kind_registry.move:457-475`) requires exactly one of the four `SCOPE_*` bits; `register_kind` lets the admin pick any of them. Content read/write gates use the slot's cached `grant_scope_mask` (`content.move:999`) or the descriptor's (`498-499`, `795-796`). Hence a grant issued today with `SCOPE_MEMORY` automatically extends to any custom kind the admin later registers with `SCOPE_MEMORY`. Owners cannot restrict a grant to a kind. Document, or add a per-grant kind allowlist.

---

### CT-12 — Blob state not validated at append; agent may publish public slots (Informational)

`append_version_impl` uses only `blob::object_id` (`content.move:695`); certification (`blob.move:111-117`) and remaining epochs are unchecked, so an uncertified or already-expired blob can be bound (consistent with the named_loadout doc "Move verifies scope/CAS/capture, not … Walrus availability", but undocumented in content.move). Separately, the agent chooses `slot_read_mode_mask` (`481-514`); for SPRITE/AUDIO it may include `READ_PUBLIC` (`679-688`), making a version world-readable via `seal_approve_content_public` under the owner's Soul. Within the ASSETS scope by design — flagging for the trust model.

---

## (c) Invariants checked that HOLD (evidence)

**Seal id namespace & parsing**
- Content id = `"soul-content:"(13) ‖ 0x01 ‖ kind u32 BE ‖ content ID (32) ‖ name ‖ 0x00 ‖ version_index u64 BE ‖ nonce(16)`; exact length check `content.move:1169-1177`, fixed offsets `1184-1204`. Name bytes are `[a-z0-9_-]` (`1097-1112`, enforced at append) so the `0x00` terminator is unambiguous; given a fixed total length the mapping id → (kind, name, version_index) is injective. Nonce is unchecked by design (key diversification). Matches test builder `protocol_tests.move:171-191` and SDK `content-document-id.ts:5-19`.
- Recovery id: 142 bytes, domain `"soul-content-upload-recovery:"`; content ids are 76-107 bytes and differ at byte 12 (`:` vs `-`) → no cross-acceptance (`content.move:1027-1032`; `content_envelope_tests.move:208 upload_recovery_id_does_not_approve_an_existing_content_document`).
- `named_loadout_v1::seal_approve` and `profile::seal_approve_bookmarks` require byte-exact equality with a sender-derived SHA-256 (`named_loadout_v1.move:72-75`, `65-70`; `profile.move:263-265`, `255-261`) — 32-byte ids, distinct domain strings; no prefix/length overlap with content ids.
- All `seal_approve*` entrypoints in the package: `content.move:962, 981, 1004, 1026`, `paid_access.move:656`, `named_loadout_v1.move:72`, `profile.move:263` — none accepts another's id format.

**Seal gates deny the right parties**
- Owner path binds to `state.current_owner` (`content.move:971` → `soul.move:409-411`); previous owners fail after `rotate_owner` (`soul.move:597-600`).
- State↔content binding on every path (`content.move:1091-1095`); deleted/purged denial (`976-977`, `996-997`, `1017-1018`, `1074-1075`); per-path read-mode bit (`978`, `998`, `1019`, `1086`); public path additionally `seal_encrypted` (`1020`).
- Agent path: `grant::assert_active_with_scope` checks soul (`grant.move:451`), `grantee == sender` (`452`), epoch snapshot (`453`), expiry strict `<` (`456-458`), membership via `active_grant_ids` + slot grantee/scope/epoch equality (`460-469`), scope superset (`470`). Revoked/superseded grant ids are removed from `active_grant_ids` (`soul.move:577-578`) → `EGrantNotActive`.
- Paid path: `has_access` requires list↔state binding (`paid_access.move:261`, `685-691`), entry scope ⊇ slot scope (`266`), entry epoch == current (`267`), not expired (`268-271`); slot must allow `READ_PAID` (`1079-1087`). Owner cannot buy (`market.move:2262`).

**Grant table consistency**
- `push_active_grant` adds both tables and increments (`soul.move:499-517`); `remove_active_grant_for_grantee` removes both and decrements only for current-epoch rows (`573-583`); `issue` cleans/supersedes before pushing so `Table::add` never collides (`grant.move:197-204`, `219-226`); capacity enforced only on net-new rows (`202`) and `set_grant_capacity ≥ count` (`369-370`); `revoke_scope` cannot empty the mask (`294`) and re-pins epoch (`302`, `314`); `destroy_invalidated_grant` requires epoch mismatch ∨ not active ∨ expired (`401`) and cleans the matching row (`402-412`) — `&&` binds tighter than `||` in Move, and `active_grant_ids` consistency makes the first conjunct always true for the found slot.
- Rotation: both market sites clear count then increment epoch (`market.move:744-745`, `2973-2974`); afterwards every existing row is stale, `active_grant_contains_*` is false (`soul.move:527`, `540`), and stale rows removed later never decrement (`579-581`). Test `protocol_tests.move:3669` asserts `active_grant_count == 0` after purchase.
- `assert_mutation_snapshot`, `assert_capacity`, `assert_preserves_active_scopes` are read-only (`grant.move:138-175`).

**Paid-access lifecycle**
- Configs pinned to descriptor scope and `READ_PAID` (`paid_access.move:693-703`) and to owner epoch (`324`, `368`, `430-433`); entries pinned to epoch (`466`, `544`); `EAlreadyHasAccess` only for live unbounded entries (`445-457`); stale/expired entries replaced; outer rows reclaimed when inner table empties (`635-642`; tests `protocol_tests.move:4101`, `4155`). Owner-only config/add/revoke (`319`, `363`, `403`, `515`, `576`).

**Content ops**
- Op gates read the slot's cached `op_mask` (`content.move:691`, `1127-1136`) so deprecation/reactivation cannot retroactively change them; descriptors are immutable except `deprecated` (`kind_registry.move:358-391`). Deprecation only blocks new appends (`assert_kind_active` used solely at `content.move:652`).
- SOUL_DOC: exactly one version (`572`, `op_mask = 0` → `659-662`), owner+grant read mode forced at mint (`581-582`), set_active impossible (`885-888`, `kind_registry.move:216-225`). MEMORY canonical name enforced everywhere (`655`, `768`, `792`, `843`, `973`, `993`, `1014`, `1071`).
- Read-mode subset, non-empty, owner-required (`668-677`); PUBLIC ⇒ `DOWNLOAD_POLICY_PUBLIC` (`684-688`); policy enum validity (`1114-1125`).
- Version CAS (`516-519`); `version_index` = vector length, never reused after purge (`712-716`); blob dof key unique per slot (`728-732`), removed+burned exactly once (`847-856`, `850 EVersionPurged`).
- Active binding: cannot delete active (`772-774`, `798-800`), cannot bind deleted/purged (`900-901`), binding policy derived from slot (`907`); market wrappers require owner (`market.move:1497`, `1510`, `1556`, `1569`).
- Envelope key = SHA-256(BCS `ContentEnvelopeKeyV1{content,kind,name,version}`) (`521-530`); written only for the newly appended index (`475`, `512`, `594`, `636`), bounded 1..65 536 bytes (`518`); mint reserves the prefix (`market.move:2585`, `2593-2603`).
- Mint-only initial paths are `public(package)`, invoked on the freshly created, not-yet-shared state/content (`market.move:2521-2553`); user kinds need `OP_APPEND` both at wallet boundary (`2735-2741`) and in content (`621-624`). Content id is deterministic and single-claim (`derived_object.move:38-44`; `market.move:168-171`, `2530-2532`).

**kind_registry**
- `assert_descriptor_well_formed` (`424-455`): known bits only, `READ_OWNER` mandatory, `has_active_binding ⇔ OP_ACTIVE_BIND`, `READ_PUBLIC ⇔ requires_download_policy`; `assert_valid_default_grant_scope` (`457-475`): zero iff no GRANT/PAID, else exactly one allowed bit. Admin-only mutation via `KindAdminCap` (`329-391`); names unique and charset-checked (`341`, `403-420`); built-in ids 5..15 unallocatable (`next_kind` starts at 16, `207`, `343-344`).

**named_loadout_v1 / profile bookmarks**
- Owner + exact epoch on every write and on seal (`named_loadout_v1.move:77-80`, `72-75`); head validated and treated as empty for older epochs (`84-94`); CAS on revision (`153`); replay resolved before CAS with conflict detection (`140-147`); receipts bounded to 32 (`157`); ciphertext/blob-id reference validation (`116-138`); `save` verifies equipment binding/revision/commitment (`177-180`). Generic `replace_named_loadout_head_v1<T>` is type-safe: `df::exists_` is type-agnostic but `borrow_mut<_, T>` aborts on mismatch (`soul.move:423-430`; `dynamic_field.move:73-81`, `101-108`); only `named_loadout_v1` calls it (package grep).
- Bookmarks: key and seal id derived solely from `ctx.sender()` (`profile.move:263-265`, `331`, `354`); CAS + bounded receipts + replay (`336-353`); other wallets/registries rejected (tests `private_bookmarks_tests.move:167`, `174`).

**profile / social / community**
- One profile per owner (`profile.move:176`), handle uniqueness and clean swap (`178`, `220-227`), profile object `key`-only and transferred once (`54`, `195`); `is_registered_profile` binds owner↔id via `by_owner` (`364-367`), used by every actor check (`social.move:79-80`, `community_posts.move:114`, `141`, `165-166`, `community_votes.move:63`, `110`).
- CAS before no-op and overflow/underflow guards: `social.move:85-87`, `98-100`; `community_posts.move:117`, `142`, `173-175`; `community_votes.move:68-70`, `74-85`. Comments frozen (`157`); `accept_answer` requires post author (id and owner), question type, comment parent/index match (`166-172`). Unbounded growth is in `Table`s (one object per entry), not in a single object.

---

## (d) Not verified / out of reach

- Seal key-server behaviour: acceptance of `public` (non-`entry`) functions, handling of original vs upgraded package id (client uses `originalPackageId` for ids and `callablePackageId` for the call, `walrus-batch-seal.ts:201-204`), session-key TTLs. All findings assume the documented Seal model (any successful `seal_approve*` in the package releases the key for `[pkg][id]`).
- Walrus availability semantics after blob expiry and the effect of re-registering the same `blob_id` (CT-1 mitigation) are from Walrus documentation knowledge, not from code read here. `max_epochs_ahead` for mainnet is a deployment parameter (not in the Move source).
- `animacraft_v8_*` runtime (`assert_soul_equipment_read_v8`, `native_proof::*_witness`) used by `named_loadout_v1::save` — dependency sources unavailable.
- Exact BCS size of the `Field<ContentKey, vector<ContentSlot>>` object (CT-2 threshold ≈3 150 is computed, not executed).
- No `sui move test` run; test expectations were read, not executed.
- Market custody/payment flows (reviewed separately) — only the call sites into content/paid_access/grant/soul were read.
