# Soulidity Phase Handoff: infinite-flow-engine-rebrand

## Snapshot

- Created: 2026-08-23T11:17:52+09:00
- Phase: infinite-flow-engine-rebrand
- Status: complete
- Goal: 将公开独立仓库 soulidity-scene-engine 完整重品牌为 Infinite Flow Engine，并统一 GitHub、Move、SDK、英文文档与发布证据标识
- Worktree: `/Users/naoer/Documents/Claude/Projects/infinite-flow-engine`
- Branch: `main`
- Commit: `8399544b0f48aa60cd70bedb64fd77b0e6b7e17a`
- Working tree: clean and synchronized with `origin/main`
- Handoff: `docs/codex/handoffs/20260823-111752-infinite-flow-engine-rebrand.md`

## Outcome

Infinite Flow Engine 已完成公开重品牌：本地目录与 GitHub slug、Move package/address、TypeScript SDK、release schemas/scripts、英文公共文档和安全报告入口已统一；commit 8399544 已推送到 public main，旧 GitHub URL 正确跳转。

## Scope and non-goals

### In scope

- Rename public repository and local checkout to infinite-flow-engine
- Rename Move package/address and every source/test import to infinite_flow_engine
- Rename the source-only SDK to @soulidity/infinite-flow-engine and add repository metadata
- Rename release schema namespaces, evidence producers, validators, tests, and confirmation guard
- Publish English README, architecture, security, errors, deployment, and migration documentation
- Configure GitHub description, topics, redirect verification, and private vulnerability reporting

### Intentionally not done

- No Sui transaction, package publication, SceneVersion creation, npm publication, or Mainnet write
- No Scene/Run domain API rename, gameplay/economy change, downstream template migration, or legacy Move alias

## Durable decisions

- Current implementation is Infinite Flow Engine; Infinite Flow Protocol remains reserved for a future frozen cross-implementation specification.
- Soulidity remains the identity layer, vendored dependency, legal attribution, and npm scope; Scene, Run, Receipt, Outcome, and runtime terminology remain stable.
- Infinite denotes one Soul crossing many Scenes, while each Run is explicitly bounded; public copy states built on Sui and not affiliated with Flow blockchain.
- The pre-release rename intentionally invalidates old release evidence identifiers; fresh evidence must be generated from the renamed commit.

## Changed paths and assets

### Changed paths

- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/Move.toml
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/Move.lock
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/sources/
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/sdk/
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/release/
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/scripts/
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/README.md
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/ARCHITECTURE.md
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/SECURITY.md
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/ERRORS.md
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/DEPLOYMENT.md
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/MIGRATION.md
- /Users/naoer/Documents/Claude/Projects/infinite-flow-engine/vendor/soulidity/VENDOR_PROVENANCE.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- 8399544b0f48aa60cd70bedb64fd77b0e6b7e17a

## Verification

- sui move build --warnings-are-errors on Sui 1.76.1; canonical Move.lock stable across a second build — PASS
- sui move test --statistics, 35/35 — PASS
- node --test scripts/test/*.test.mjs, 11/11 — PASS
- sdk npm ci, npm test 5/5, npm run typecheck, 0 vulnerabilities — PASS
- npm publish --dry-run --access public package composition; no npm publication performed — PASS
- ./scripts/publish-immutable.sh strict build/tests and PTB preview; no chain write or publication — PASS
- JSON parse, shell syntax, relative Markdown links, git diff --check, English surface, and legacy-identifier allowlist — PASS
- Two independent final audits; no unresolved code/schema P0/P1/P2 and documentation findings resolved before commit — PASS
- GitHub main equals 8399544, repository PUBLIC, old URL redirects, metadata/topics live, private vulnerability reporting enabled — PASS

## Risks and recovery

### Risks or blockers

- Immutable production release remains intentionally blocked by local-snapshot provenance, missing successful verify-source evidence, unresolved mainnet VM dry-run, and reviewed:false governance.
- Move/package rename is source-breaking for any external template; no legacy module alias exists.
- The SDK remains private/source-only and was not published to npm.

### Recovery or rollback points

- Pre-rename source commit is fafe71f1ca961079616c89eda1da1cc79c06a7c6; use a normal revert rather than destructive reset if rollback is required. GitHub preserves the old URL redirect while the new name remains active.

### Working-tree evidence

```text
## main...origin/main
```

## Exact next action

后续若接入现有 Scene 模板，另开 bounded phase 审计并迁移其 Move.toml/import 到 infinite_flow_engine；在既有 provenance、verify-source 与 mainnet PTB dry-run blockers 关闭前不得执行链上 immutable publish。
