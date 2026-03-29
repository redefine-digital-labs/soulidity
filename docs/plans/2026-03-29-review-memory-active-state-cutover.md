# Review-Memory Active-State Cutover Plan

1. 改 review-memory backfill / markdown 解析，使 archive 路径可回放且 `sourceFile` 规范化。
2. 补测试覆盖：
   - archive `sourceFile` / `batchId` 解析
   - 外部路径 backfill 规范化
3. 更新 `new-review-batch` / `new-fix-batch` / `new-batch-review`：
   - active path 只读 `review.md` / `todo.md`
   - closed-history 走 MCP + archive
4. 迁移当前 `review/batch-0/`：
   - 新建 `review/archive/batch-0/`
   - 移动 `fixed.md` / `not-issue.md` 详细内容到 archive
   - active path 写 stub
5. 更新 README 说明新的 active/archive 分层。
6. 回填对账并验证：
   - targeted vitest
   - `npm run typecheck:root`
   - mem9 repo 对账
