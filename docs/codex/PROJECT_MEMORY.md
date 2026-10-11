# Soulidity Durable Project Memory

This file contains only stable, cross-phase facts and decisions. Keep it under 8 KiB. Current work belongs in `CURRENT.md`; finished-phase detail belongs in one handoff, source, tests, issues, and Git history. Never paste raw chats, tool logs, credentials, or embedded image data here.

## Repository boundaries

- The primary Soulidity Git root is this repository.
- `animacraft/` is a separate nested Git repository. Check and change it with its own Git root; never assume the parent repository records its contents.
- Multiple worktrees can contain valuable uncommitted or untracked work. A clean sibling worktree does not make another worktree disposable.

## Working-memory contract

- One Codex task represents one bounded release phase or one explicit objective.
- `docs/codex/CURRENT.md` is the only automatic continuation entry point. It links to at most one handoff.
- `docs/codex/handoffs/` is an archive, not startup context. Read only the handoff named by `CURRENT.md`.
- Important product and engineering truth must live in code, tests, repository docs, or intentional Git commits. Chat history is not the only copy.
- Existing `CONTEXT.md` is legacy context and is not the authority for the current product or release state.

## Context-size controls

- Store images in the relevant project asset directory and refer to their paths. Do not repeatedly upload or inline the same image bytes.
- Give subagents no conversation history or only the smallest useful recent slice. Do not full-fork long or image-heavy tasks.
- Do not reawaken completed subagents from a large-history task; follow-up runs can create another large rollout. Prefer local review or a fresh no-history subagent.
- Start a handoff before changing the objective, after completing a phase, or before creating five or more new subagents or any nested subagent tree.
- `/compact` can reduce active context inside an unchanged phase, but it does not replace a durable handoff and does not reclaim the raw rollout archive on disk.

## Storage and recovery

- Generated dependency/build caches can be recreated; source, `.git`, assets, environment files, and dirty worktrees must be preserved.
- Codex rollout archives are recovery artifacts, not live memory. Compressed `.jsonl.zst` files are not directly resumable until restored to their original `.jsonl` paths.
- Session archiving must be explicit, hash-verified, and preferably written to an encrypted external or separately backed-up filesystem.

## Authority order

When facts conflict, prefer current tests and source, then an intentional Git commit or current specification, then `CURRENT.md` and its linked handoff, then this stable-memory file. Do not revive stale facts solely from an old chat or handoff.

## Confirmed ecosystem identity (2026-09-06)

- Product map and approved introduction: `docs/SOULIDITY_ECOSYSTEM_CN.md`.
- SoulDesk is the confirmed desktop product name, replacing Soulidity Desktop / Anima Desktop in product introductions. Application/package rebranding has not yet been performed; preserve Desktop-Claw upstream attribution.
- Infinite Flow Engine is the Sui full-chain game-engine product (MUD is a category analogy, not feature parity). Soul Expedition, Soul Paper Theater, Infinite Stellar, and Soul Habitat are games regardless of implementation stage. Do not assume every game depends on the engine.

- Public English ecosystem documentation lives in the standalone repository `https://github.com/redefine-digital-labs/soulidity-docs` (local sibling `../soulidity-docs/`), rather than the product code repository. User confirmed current development centers on Sui, with future expansion to Solana and Sonic SVM; do not present these as currently supported deployments.

## Confirmed organization direction (2026-10-03)

- Product explanation clarification (2026-10-04): start from OC / character-community problems, then explain the integrated onchain solution. Core business authority/rules live onchain, content uses Walrus/Seal, editing/rendering/inference run in clients/runtimes. This complements the external AI Agent creator audience. Global-first status is unverified. Narrative and four diagrams: `docs/SOULIDITY_PROBLEM_PRODUCT_ARCHITECTURE_CN.md`.

- Naoer leads the whole Foundation; Codex takes the Labs CEO working role for product, engineering and delivery coordination. This does not grant legal, account or signing authority.
- Internal Agents have stable identities, positions and responsibilities. External AI Agent creators are the core users; internal trial activity must be distinguished from external adoption.
- Current organizational entry: `agent-management/README.md`; proposed milestones and operating model are linked there. Slack Lists/Canvas and nine role contracts are now created and verified; metrics/timing are planning targets, and persistent bot identities/automation are not configured. April role documents and fundraising/TGE schedules are historical when conflicting with this entry.

## Current engineering authority and management setup (2026-10-03)

- Active AC/SO delivery is owned by chat `Unified Maker v8 Market execution` (`01a02161-12b8-7b83-9d6e-2da4e7027107`). AC execution root: `tmp/animacraft-v8-mainnet-release`; SO root: `/Users/naoer/.codex/worktrees/f722/soulidity`. Read AC CURRENT and its named current spec; the old nested v5 checkout is not current production authority.
- Existing AC/SO PRODUCT_DELIVERY_MILESTONES and AGILE_DELIVERY_PLAN retain M1–M4/S0–S14. Ecosystem management uses ECO-* identifiers; it must not replace or reset that ongoing product goal. AC/SO confirmed architecture is chain + frontend with no owned business backend.
- Slack is the ecosystem task entry; created objects and record IDs are in `agent-management/workspace.json`. Role contracts and actual bounded runs are registered separately from Slack accounts, Souls or unattended runtimes. Latest management/product snapshot: `agent-management/LIVE_PRODUCT_STATE.md`.

## Confirmed delivery loop (2026-10-05)

- User confirmed Agile + DevOps Plan/Code/Build/Test/Release/Deploy/Operate/Monitor across product, design, engineering, release and operations. Canonical stage responsibilities/exit criteria: `agent-management/OPERATING_MODEL.md` section 8.
- Reuse Delivery/DEV/BUG; stage is independent of status. User-authorized reconstruction boards may supplement them; do not reset M1–M4/S0–S14/G1–G5 or active owners. No uncalibrated risk scale.
- AI/Codex methodology v1 is in `agent-management/OPERATING_MODEL.md` section 9; reusable task contract: `agent-management/templates/ai-work-item.json`. Uses bounded tasks, review-aware concurrency, exclusive shared resources and combined-candidate evidence. Effectiveness remains to be measured; existing owners and permissions stay authoritative.

## Required engineering handbook (2026-10-06)

- `agent-management/PRODUCT_ENGINEERING_HANDBOOK_CN.md` is the required cross-domain reference: management/product/Agile, DevOps, financial/DeFi mechanisms, Ethereum and Sui security, permissions, upgrade locks and operations. Read core sections 1–4, 9, 12 once, then task-relevant updates. Record applicability/evidence on existing tasks; use `agent-management/templates/product-engineering-review.md` for funds, contracts, permissions or migrations. Sui is current focus; EVM/DeFi coverage does not imply deployments or new scope. Existing owners, milestones, authorization and CURRENT remain authoritative.

- Soul DOF：九表157项/文件/现前端映射在workspace.json。用户2026-10-07已授权全部合约重构（含Maker/Pack），新goal active、Code进行中，目标spec见独立工作树docs/CONTRACT_REBUILD_SPEC_CN.md。现站为依据；原CURRENT/Owner保留。
- 新标准：Player/Soul每Part一个固定Style单位；Creator声明REFERENCE、SOUL_BOUND或TRANSFERABLE，仅后者发自由Item对象。Free装即绑定/取下原ID，无通用未启用库存；Bound可卸下仍永久本Soul。目标见docs/SOUL_DOF_V1_REBUILD_CN.md；尚未生产实现/部署。

- Grant后续换Sui Agent Pass；接口/迁移待核验，见重构规格。
