You are performing an INDEPENDENT security audit of the Sui Move package at `move/soulidity/` (relative to the working directory). Deliverable: a written audit report (see FORMAT at the end). You have read-only access; do not modify any file.

SCOPE (production modules in `move/soulidity/sources/`):
soul.move, grant.move, kind_registry.move, content.move, paid_access.move, market.move, collection.move, profile.move, social.move, community_posts.move, community_votes.move, named_loadout_v1.move, animacraft_v8_binding.move, animacraft_equipment_adapter_v8.move.
Test files (`*_tests.move` in `sources/` and `tests/`) and `move/soulidity/probes/` are reference material for intended behavior, not audit targets. `move/soulidity/Move.toml`, `Move.lock`, `Published.toml` are in scope for dependency / upgrade review.

CONSTRAINTS:
- Do NOT read `docs/audits/`. Your findings must be independent of prior audits. You may read `docs/plans/`, `docs/specs/`, and the TypeScript tx builders under `web/lib/soulidity/tx/` only if needed to understand intended PTB composition.
- Do NOT read or execute anything under `~/.claude/`, `~/.agents/`, `.claude/`, `agents/`. Stay on repository code.
- `sui move build` / `sui move test` will FAIL on this machine: `animacraft_v8_core` / `animacraft_v8_output` (and transitively `animacraft_v8_runtime` / `animacraft_v8_seal`) are `local` dependencies pointing at a path that does not exist here. Do a static review. Treat `animacraft_v8_*` types/functions as an external trusted-interface boundary: audit how soulidity USES them (what it checks before/after each call, what it passes), not their internals.
- Dependency sources ARE available locally for API verification; verify kiosk / transfer_policy / personal_kiosk / dynamic_field / derived_object / coin semantics against source rather than from memory:
  - Kiosk extensions (personal_kiosk, kiosk_lock_rule, personal_kiosk_rule, witness_rule): `~/.move/https___github_com_MystenLabs_apps_git_7a07937149c0af057be8f6747e60d0f1acd88fde/kiosk/`
  - Sui framework: `~/.move/https___github_com_MystenLabs_sui_git_a4185da5659d8d299d34e1bb2515ff1f7e32a20a/crates/sui-framework/packages/sui-framework/sources/`
  - Walrus: `~/.move/https___github_com_MystenLabs_walrus_git_a19764ff77f501a79db88dc6d922a2c73848e989/`

CONTEXT: The package is deployed on Sui mainnet (see `Published.toml`). It holds user-owned NFT "Souls" (kiosk-locked; `TransferPolicy<Soul>` with kiosk_lock_rule + personal_kiosk_rule + witness_rule), shared `SoulState` / `SoulContent` / `SoulPaidAccessList` objects, a USDC fixed-price marketplace (PurchaseCap held inside a shared `SoulListing` / `CollectionListing`), scoped time-limited `SoulGrant`s to agents, per-kind paid access, Seal approval functions (`seal_approve_*`) that gate decryption of Walrus blobs, a kind registry, collections with extra royalty, profile / social / community modules, private named-loadout and bookmarks heads, and an Animacraft V8 native-soul integration (witness types consumed by an external package). Admin caps (`MarketAdminCapV2`, `KindAdminCap`, `UpgradeCap`, TransferPolicy caps) are assumed to be held by a multisig; a plain "admin is centralized" finding is out of scope unless a non-cap-holder can obtain cap authority or an admin action has an unintended effect beyond its stated purpose.

WHAT TO HUNT (non-exhaustive):
1. Authorization: any path where a non-owner / non-grantee / non-buyer can mutate state, pass a `seal_approve_*` function (these are the decryption gate: any success path for an unauthorized sender is Critical), bypass kiosk custody, or move a Soul / SoulCollectionRight outside the market flows.
2. Object model: shared-object mutation without checks; missing ID cross-checks between related objects (Soul / SoulState / SoulContent / SoulPaidAccessList / SoulListing / Kiosk / PersonalKioskCap / SoulCollection / SoulCollectionRight / KioskRegistry); mixing objects of different Souls; dynamic-field / dynamic-object-field key collisions; derived-object identity (`derived_object::claim` on `KioskRegistry`); `key`-only vs `store` abilities and transfer surfaces; whether any public function returns a witness, proof, or cap; `public(package)` functions leaked through public wrappers.
3. Marketplace economics: fee / royalty math (rounding direction, overflow, u128 -> u64 casts, bps caps), payment routing (who receives what; conditions like `creator != seller`), exact-payment checks, PurchaseCap lifecycle (list / cancel / buy / delete), `SoulListing.is_active` vs `SoulState.is_listed` desync, collection binding interactions, stale royalty snapshots in listings, pause / gate semantics across V1 (`MarketConfig`) and V2 (`MarketConfigV2`) entry points. Note `init` creates only a V2 config; determine whether V1 functions are reachable with a real `MarketConfig` on this deployment and whether that matters.
4. Grants and paid access: epoch-snapshot logic; capacity accounting (`active_grant_count` vs tables after rotation); supersede / revoke / destroy edge cases; expiry comparisons; scope-mask validation; renewal / duration math (`renewal_base_ms`); config / entry epoch pinning; owner self-purchase; buyer-row cleanup; anything letting a grant or paid entry outlive an ownership rotation or be used by the wrong sender.
5. Content: append / delete / purge / set_active gates (op_mask, read_mode_mask caching); version-index integrity; envelope persistence into `SoulState.config_ext` (key reservation, collisions with user-chosen keys, size bounds); seal document-id parsing (length, offsets, endianness, name terminator ambiguity, nonce); upload-recovery namespace; SOUL_DOC / MEMORY canonical names; blob custody (dof add / remove / burn); griefing via unbounded growth.
6. Animacraft V8 integration: who can construct `MintBindingWitnessV8` / `SoulOwnerWitnessV8`; equipment binding / unbinding consistency with `set_listed` / `rotate_owner`; `quote_animacraft_v8_soul_sale` underflow and royalty assumptions; listing version checks; whether an ordinary buy / list path can process a native-V8 Soul or vice versa; whether a Soul can be bricked (equipment bound while listed, etc.).
7. Profile / social / community / named_loadout / bookmarks: identity binding (`is_registered_profile`), CAS / revision logic, handle uniqueness, head validation, receipt replay logic, DoS via unbounded vectors or tables, frozen-object assumptions.
8. Upgrade and deployment: struct layout and version fields, `Move.toml` dependency pinning (`addr_subst`, `published-at`), anything that would break or weaken invariants on package upgrade; test-only code accidentally reachable; `#[test]` functions in non-test files (e.g. `market.move` asserting `@soulidity == @0x107`).
9. Liveness / DoS / griefing: shared-object contention hot spots, unbounded loops over caller-controlled vectors, storage griefing against the next owner, operations that permanently block a Soul from being listed or transferred.

METHOD: Read every production module fully. For each candidate finding, construct the concrete attack or failure sequence (which functions, called by whom, with which objects) and verify it against the code line by line before reporting. Prefer fewer verified findings over many speculative ones; label confidence honestly. Also record important invariants you checked that HOLD, with file:line evidence, so a cross-audit can compare coverage.

FORMAT (write in 简体中文; keep code identifiers and paths in English; your FINAL message must be the complete report):
# Codex 独立审计报告 — soulidity Move
## 1. 总评
(2-5 sentences)
## 2. 发现汇总表
| ID | 严重度 | 位置 (module.move:line) | 标题 | 置信度 |
Severity scale: Critical / High / Medium / Low / Informational. IDs: CX-1, CX-2, ...
## 3. 发现详情
Per finding: 位置 / 描述 / 攻击或失效路径（逐步） / 影响 / 修复建议 / 置信度与验证依据
## 4. 已验证成立的关键不变量
Bullet list with file:line evidence.
## 5. 范围与限制
What you could not verify (animacraft internals, no build, etc.).
