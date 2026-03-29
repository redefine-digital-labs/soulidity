# Review-Memory Active-State Cutover Spec

## Goal

把 `review-memory` 升级为 closed-history 的主来源，避免 `new-review-batch` / `new-fix-batch` 每次把本地大体积 `fixed.md` / `not-issue.md` 带入上下文。

## Scope

- `src/mcp/review-memory/**`
- `scripts/review-memory-backfill.ts`
- `tests/mcp/review-memory-*.test.ts`
- `/Users/admin/.claude/skills/new-review-batch/SKILL.md`
- `/Users/admin/.claude/skills/new-fix-batch/SKILL.md`
- `/Users/admin/.claude/skills/new-batch-review/SKILL.md`
- `review/batch-0/**`
- `review/archive/**`
- `docker/review-memory/README.md`

## Requirements

1. `review/batch-0/` 只保留 active state：
   - `review.md`
   - `todo.md`
   - `fixed.md` stub
   - `not-issue.md` stub
2. 详细 closed history 迁移到 `review/archive/batch-0/fixed.md` 与 `review/archive/batch-0/not-issue.md`。
3. `new-review-batch` 不再 bulk-read 本地 `fixed.md` / `not-issue.md`；历史 closed findings 只通过 review-memory MCP 查询。
4. `new-fix-batch` 关闭 finding 到 `fixed` / `not_issue` 时：
   - 远端 upsert 到 review-memory
   - 本地详细记录写入 `review/archive/batch-0/`
   - active path 下的 `fixed.md` / `not-issue.md` 不再承载正文
5. `new-batch-review` 初始化时必须创建 active stub 文件和 archive 文件。
6. backfill 必须支持 archive 布局，且无论从哪个工作目录回填，`sourceFile` 都统一成 `review/...` 相对路径。

## Acceptance

- `new-review-batch` / `new-fix-batch` 的说明不再要求读取 active path 下的大体积 `fixed.md` / `not-issue.md`
- 当前 `clawnews/review/batch-0/fixed.md` 与 `not-issue.md` 变成小型 stub
- `clawnews/review/archive/batch-0/fixed.md` 与 `not-issue.md` 保留详细历史
- review-memory 测试通过，`typecheck:root` 通过
- mem9 对账后，`clawnews` 远端 closed-history 仍与本地 archive/active 状态一致
