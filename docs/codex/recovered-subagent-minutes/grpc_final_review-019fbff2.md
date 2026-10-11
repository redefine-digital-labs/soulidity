# Meeting minutes: `grpc_final_review`

## 任务与范围

只读审查 Soulidity 的 Sui gRPC 迁移，确认主网链身份、余额、对象读取和无签名模拟是否正确迁移，并检查发布、升级、旧市场暂停/退役路径是否可能连错网络、误签或失败开放。本子任务不改文件、不签名、不发交易。

## 最终结论

- 当时无 P0，但有一个阻止提交的 P1：`isNotFoundError()` 过宽，普通网关 `404 Not Found` 可能被误认为对象已删除，使退役 postflight 失败开放。
- 另有一个不阻止当次提交的 P1：Base58 genesis digest 被转小写比较，安全语义不精确。
- 两项均在 PR #22 合并前修复，完整 CI 后续全绿；本纪要中的缺陷是审查时状态，不是当前未修复结论。

## 关键决策

- 普通读写与模拟统一走 gRPC；仅复杂历史事件查询保留 GraphQL。
- 对象不存在只接受结构化 gRPC `NOT_FOUND` 或精确对象缺失错误。
- 链标识比较必须保留 Base58 大小写语义。
- 淘汰失效 JSON-RPC 传输层，但不删除链上历史或本地草稿。
- 真实发布必须等完整 CI；付费、Soul、Seal 和正式发布 gate 在该阶段继续关闭。

## 历史改动与证据路径

本子任务本身无改动。审查路径（可能只存在于历史提交/旧 worktree）：

- `packages/soulidity-sdk/src/sui-grpc-compat.ts`
- `packages/soulidity-sdk/src/sui-client.ts`
- `scripts/lib/soulidity-mainnet-migration.ts`
- `scripts/publish-soulidity-and-sync.ts`
- `scripts/upgrade-soulidity-mainnet.ts`
- `scripts/preflight-animacraft-market-retirement.ts`
- `scripts/retire-soulidity-legacy-market.ts`
- `tests/new-web/sui-grpc-compat.test.ts`
- `tests/scripts/soulidity-mainnet-migration.test.ts`

Git 证据：`94fbc85`、`b986f17`、`9567ae9`；PR #22 合并提交 `b70eaa8`。

## 验证结果

- 审查前已用主网 gRPC 实测链标识、余额、对象字段和无签名 simulation；41/41 单测通过。
- 修复后 SDK typecheck 通过，3 个目标测试文件共 55 项通过，新增 404 fail-closed 回归通过。
- PR #22 完整 CI 后续全绿并合并，实际 JSON-RPC client 实例清零。

## 风险、未完成项与后续变化

- 审查时 404 判定是提交 blocker；Base58 比较需修正；本地全量检查曾受 `ENOSPC` 影响。
- 后续上述代码问题与 CI 门槛均已关闭；该子任务从未授权或执行主网写入。
- 如需恢复这一阶段，应从 `b70eaa8` 或更新后的主分支开始，不应恢复审查时未修复 worktree。

## 来源追踪

- Thread ID：`019fbff2-a145-78a3-baa7-9766bf5b7dbd`
- 原始 source：2,330,944,152 B；SHA-256 `b6ae79feab33c83f6e6a423d170579ca087eb6f0825b8589177d34b4d2e9481c`
- 压缩正文：1,559,581,016 B；SHA-256 `30cc6a84955a8b01a6b1f0f792e6a20587d8567dfa48fbb9946984ef3c536e1c`
- 脱敏导出：1,103 条消息；SHA-256 `b7022b8b6e23a8313e475ea03368edf23b6b9ca531ee36066c6e15646701eb80`
- 代表性消息：
  - `da8f6338f11099b6a94d819dacc2a2647da12c84c425365f727e11bac6bf6909` — `2026-08-02T01:00:49.018Z`
  - `962dd476db710eb7c9a783bff8de1aed13796461446482d0d0ef9abf5667627b` — `2026-08-02T01:00:49.038Z`
  - `19393a2792b8967cd45737cbfff6a1089c641479d924586e79beb431bd73cc7b` — `2026-08-02T01:12:57.317Z`
  - `c75a60431baa00080223c39716ad717c957148e1e607b17e159f3799a1a83b7a` — `2026-08-02T01:16:45.118Z`

