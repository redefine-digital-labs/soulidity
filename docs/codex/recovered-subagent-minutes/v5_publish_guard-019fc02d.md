# Meeting minutes: `v5_publish_guard`

## 任务与范围

只读审查干净 v5 Mainnet release worktree 的依赖隔离、dry-run 签名边界和安全执行条件；不修改文件、不签名、不发链上交易。

## 最终结论

- 审查时不能运行 dry-run：磁盘仅约 117 MiB，`tsx` 因 `ENOSPC` 无法创建 IPC socket。
- 其他 worktree 的 `node_modules`、锁文件和目标版本不一致，不能借用。
- 正确 `--dry-run` 会读取密钥以派生 sender、检查余额和选择 gas，但在 release journal 与签名函数之前返回，不调用 signing API，也不产生链上写入。

## 关键决策

- 先释放 1.5–2 GiB，再在 release worktree 严格按锁文件完整安装；不复用别的项目依赖，也不只补几个顶层包。
- 发布脚本直接导入该 worktree 的本地 SDK 源码。
- dry-run、默认暂停状态和链上读回一致后才允许真实签名。
- 提交超时或状态不确定时禁止重试；必须依据 journal、钱包历史和链上状态核销。

## 历史改动与证据路径

本子任务无改动。历史证据入口：

- worktree `tmp/soulidity-v5-mainnet-release`
- `scripts/publish-soulidity-and-sync.ts`
- `packages/soulidity-sdk/src/sui-grpc-compat.ts`
- `package-lock.json`
- 本地 SDK workspace 链接和发布 journal 代码

审查时的依赖差异：候选安装 Sui SDK `2.20.1`、锁文件要求 `2.16.0`；候选 `tsx 4.21.0`、锁文件要求 `4.23.1`。

## 验证结果

- 静态审计确认 dry-run 在 journal 创建和签名之前返回。
- dry-run 只构建临时 Move 包并调用 gRPC simulation，临时目录由 `finally` 清理。
- 本子任务因 `ENOSPC` 没有实际运行 dry-run，也没有生成签名、交易或发布记录。
- 前置 gRPC PR #22 已全绿并合并，覆盖生产 Web、桌面、Walrus uploader、发布/退役/smoke/E2E。

## 风险、未完成项与后续变化

- 当时未完成：完整锁文件安装、主网 dry-run、paused/readback 与真实发布。
- 空间问题随后解除并完成干净安装；后续 dry-run 在签名前因 Move VM 依赖校验失败而安全停止。
- 后续 PR #23 修复依赖绑定，PR #24 加固 finalized publish 恢复，PR #25 记录最终 v5 Mainnet 部署。
- 恢复时仍必须遵守“任何含糊提交不得重试”的原则。

## 来源追踪

- Thread ID：`019fc02d-b9aa-7853-93e2-22251aeed561`
- 原始 source：2,347,721,756 B；SHA-256 `282614ec1cae69f1d1fbbce36924104a2e9f591b44a04f1120668327e2d8e630`
- 压缩正文：1,571,121,488 B；SHA-256 `61dd07d86960eced33850ff7479d122eec29bdab128fe7f6f69f394728f1e032`
- 脱敏导出：1,114 条消息；SHA-256 `97ec13c14a01a5c3c30d4e621295da50c6f9cad75cd1f5379d04897907390c02`
- 代表性消息：
  - `b9f7851c47f86e2e79543e6bfded1613f870a5d019f1125964c8653118d13a83` — `2026-08-02T02:00:46.350Z`
  - `cdf6a018574821d1afd90e0abe0f04da47f7874ab440229bbe35f342c5509cd5` — `2026-08-02T02:00:46.350Z`
  - `dbc24baec16a9cbab1a5cb802fc977d024c4ccb9f68ec3253082ef463bbef4d8` — `2026-08-02T02:00:46.350Z`
  - `951c8497cf956389d0a54e515c1f00077a9385f6e8abab9bf7d370b87fa6e774` — `2026-08-02T02:00:46.373Z`
  - `4a0bdf01dc657023c4dc1b472f4753b4971da19b35eedf0557cbeff3f81e3a51` — `2026-08-02T02:03:02.139Z`

