# Review-Memory MCP Spec

## Goal

给 review/fix 工作流增加一个基于 mem9 的远端历史判例库，使当前 batch 只保留本地审计状态，历史 `fixed` / `not-issue` / `todo` 则通过 MCP 按需检索与回填，不再依赖全量读取长归档文件。

## Scope

- `src/mcp/review-memory/**`
- `scripts/review-memory-backfill.ts`
- `tests/mcp/**`
- `.env.example`
- `package.json`
- `tsconfig.json`
- `docs/specs/2026-03-28-review-memory-mcp-spec.md`
- `docs/plans/2026-03-28-review-memory-mcp.md`

## Non-Goals

- 不接管 OpenClaw 的通用 memory slot
- 不把 mem9 作为当前 batch open/closed 的唯一事实源
- 不在本轮引入 embeddings-only RAG 或自动判定 dismiss/fix

## Constraints

- 远端底座固定为 mem9 `mnemo-server`
- 本地 `review/batch-N/*.md` 继续是 canonical 审计记录
- 远端只记录 closed findings：`fixed` / `not_issue` / `todo`
- MCP 查询只返回候选判例，最终归类仍由当前 reviewer/fixer 决定
- 远端同步失败不得阻断本地归档；允许后续 backfill 补偿

## Acceptance

1. 仓库内存在可直接运行的 `stdio` MCP server，提供：
   - `review_memory_find_candidates`
   - `review_memory_get_record`
   - `review_memory_record_resolution`
2. 仓库内存在可直接运行的回填脚本，能把最新或指定 `review/batch-N` 的 `fixed.md` / `not-issue.md` / `todo.md` 同步到 mem9。
3. 配置同时支持 `MEM9_*` 与 `MNEMO_*`，且前者优先。
4. 远端 record 的 `uid` 不依赖本地 F/N/T 编号；重复回填保持幂等。
5. 测试覆盖 record 构建、markdown 解析、服务层排序/upsert、backfill 幂等、配置优先级、mem9 HTTP 客户端请求格式。
