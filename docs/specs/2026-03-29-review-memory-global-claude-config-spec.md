# Review-Memory Global Codex-Claude Config Spec

## Goal

把 review-memory 从仓库级临时 `.mcp.json` 配置收口成 Codex 与 Claude Code 的全局可用能力，并让本地 mem9 API 在需要时自动拉起，避免后续会话继续出现“工具存在但未全局生效 / API 未启动 / repo 写死”的尾巴。

## Scope

- `/Users/admin/.config/claude-code/config.json`
- `/Users/admin/.codex/config.toml`
- `/Users/admin/.claude/scripts/**`
- `/Users/admin/Desktop/nao/review-memory/**`
- `docs/specs/2026-03-29-review-memory-global-claude-config-spec.md`
- `docs/plans/2026-03-29-review-memory-global-claude-config-plan.md`

## Requirements

1. Claude Code user config 中必须存在全局 `review-memory` MCP server。
2. Codex user config 中必须存在全局 `review-memory` MCP server。
3. 全局 `review-memory` MCP 启动不得依赖当前仓库内的 `.mcp.json`。
4. MCP 启动链路不得写死 `REVIEW_MEMORY_REPO_ID=clawnews`；未显式传入时应按当前 git root 自动派生 repo id。
5. MCP 启动前必须探测本地 mem9 API；若 `http://127.0.0.1:8080` 不可用，应自动拉起本地 review-memory Docker stack。
6. Codex 默认新会话必须具备访问本机 mem9 API 的权限配置，不能要求手工追加运行参数后才能用 `review-memory`。
7. 本地 mem9 API 启动后应可被 curl 健康探测到，且 `claude mcp get review-memory` 与 `codex mcp get review-memory` 在任意项目目录下都可连接。
8. 清理旧的仓库级 `.mcp.json` 依赖，以及会在新会话启动时报错的无效全局 skill 断链，避免继续留下噪音和误导。

## Non-Goals

- 不迁移 review-memory 服务实现本身的业务逻辑。
- 不在本轮修改 mem9 上游源码或数据库 schema。
- 不处理 claude.ai / figma 等其他 MCP 的认证问题。

## Acceptance

- `docker compose -f /Users/admin/Desktop/nao/review-memory/docker/docker-compose.yml ps` 显示 `mnemo-server` 与 `postgres` 正常运行。
- `curl` 访问 `http://127.0.0.1:8080/v1alpha2/mem9s/memories?limit=1` 返回 200。
- `claude mcp get review-memory` 显示 `Scope: User config` 且 `Status: ✓ Connected`。
- `codex mcp get review-memory` 显示启用的全局 stdio 配置，且不再包含 `REVIEW_MEMORY_REPO_ID`。
- 默认 `codex exec` 新会话可直接访问 `http://127.0.0.1:8080`，且可完成一次 `review_memory_find_candidates` 调用，无需额外命令行覆盖。
- 从非 `clawnews` 目录执行同样检查时，Codex 与 Claude Code 的 `review-memory` 都仍可连接。
- 当前仓库不再依赖 `.mcp.json` 暴露 `review-memory`。
