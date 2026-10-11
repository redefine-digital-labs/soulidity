# Meeting minutes: `v5_vm_verify_failure`

## 任务与范围

只读诊断 v5 Mainnet dry-run 的 `VMVerificationOrDeserializationError in command 0`，区分 Move 产物、主网 VM、依赖绑定和自定义 gRPC simulation 转换问题，并整理合并前验证矩阵。本任务不改文件、不签名、不发交易。

## 最终结论

- 根因不是 bytecode v7、包体积、gas、verifier meter 或 gRPC 适配器，而是 Animacraft callable package 依赖绑定错误。
- v5 模块依赖 `commerce_v5` 与 `seal_v5`，构建却绑定到不含这些模块的旧 callable package；正确目标是已审核的 v5 callable package。
- 保持 11 个模块字节不变、只替换依赖后，无签名 gRPC simulation 成功，产生 30 个 object changes 和 13 个 events。

## 关键决策

- Mainnet 只允许把已知旧 Animacraft ID 精确映射到审核过的 v5 ID。
- 缺少依赖、未知 ID 或重复冲突时立即失败。
- 发布前查询目标包，确认必需模块和函数存在；对最终依赖重写后的完整 PTB 再模拟。
- 不为此问题升级仓库固定的 Sui SDK；长期应给审核过的 Animacraft revision 建立稳定 tag/主分支记录。

## 历史改动与证据路径

本子任务本身无改动；父任务并发实现。历史路径：

- `move/soulidity/Move.toml`
- `move/soulidity/Move.lock`
- `scripts/lib/reviewed-move-dependencies.ts`
- `scripts/publish-soulidity-and-sync.ts`
- `scripts/upgrade-soulidity-mainnet.ts`
- `tests/scripts/reviewed-move-dependencies.test.ts`
- `.github/workflows/soulidity-fast-path-smoke.yml`

Git 证据：依赖绑定 `88c5b0a` / PR #23 merge `f40d326`；安全核销 `1474664` / `b5cabf2`；v5 Mainnet 记录 `88a0dfb` / `ccec77d`。

## 验证结果

- Move 编译成功，11 个模块均为 bytecode v7；主网支持该版本，verifier meter 通过。
- 官方 `sui client publish --dry-run` 复现同一错误，排除 gRPC 假象。
- `verify-source --verify-deps` 指出旧包缺少所需模块；切换正确依赖后 simulation 成功。
- 发布相关 42 tests、全量 1320 tests、SDK/Web typecheck、Web lint、Walrus build、生产 Web build、Move build 和 124 个 Move tests 均通过；`git diff --check` 通过。
- Desktop exact gate 未在本地重跑，计划由 CI 的 pnpm 9 环境覆盖。

## 风险、未完成项与后续变化

- 审查时 helper 与测试仍 untracked；根 typecheck 被既有 TS7022 阻断；Animacraft revision 仅在远端功能分支；workflow 使用浮动 Sui 工具链。
- helper、测试和 pin 后续经 PR #23 合并；恢复保护和 v5 部署记录也分别经 PR #24/#25 合并。
- 浮动工具链和稳定 tag 仍是长期维护风险。

## 恢复入口

- 从 PR #23 的 merge `f40d326` 和 v5 Mainnet 记录 `ccec77d` 恢复上下文，先核对当前 `Move.toml` / `Move.lock` 与 `reviewed-move-dependencies.ts` 中的 callable package 映射。
- 重新执行发布脚本的无签名 dry-run，确认最终依赖重写后的完整 PTB simulation 成功，再运行发布相关测试、Move build/tests、SDK/Web typecheck 和生产 Web build。
- 如果 journal、钱包历史或链上状态存在任何含糊提交，停止重试并先完成链上核销；不要从旧错误现场直接继续签名。

## 来源追踪

- Thread ID：`019fc038-1afa-7b90-9416-1b82d2cc11aa`
- 原始 source：2,340,496,926 B；SHA-256 `fc129f2e0474151ad37d268c80f4cf492b7ce8169b6457b0aa4f08cd9ed46b3b`
- 压缩正文：1,565,909,832 B；SHA-256 `8377999284c2aa0e1e3cc53c99f425e582774dbea1098c4dbfb9cef39dad5e21`
- 脱敏导出：1,127 条消息；SHA-256 `516bab53dd4587faae544d9bc3953cf1e7af76c3985858df89b113432020fdc3`
- 代表性消息：
  - `60e800af4f9a37c3e097e9d3da9a3b3836963ba53672b3d188c14b45463b111e` — `2026-08-02T02:10:08.631Z`
  - `a6b556779e00ee03d90e66eb9f9eacd0d8aa9184682256f7feac8befe9f2a436` — `2026-08-02T02:20:35.808Z`
  - `85137aef13d67d7d76a107c9304474c2879577a4f5825578b23b1249702aa039` — `2026-08-02T02:38:13.629Z`
  - `f5bc9a5221ed92a6cc36ec72e0a84f461334ce0958f590f83864250662e62091` — `2026-08-02T03:11:43.737Z`
  - `ae193f61538a1c790fb82843836843ddedf66ade638b9d904adcfdcf1910f149` — `2026-08-02T03:24:07.995Z`
