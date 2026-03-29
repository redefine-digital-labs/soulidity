# Review-Memory Global Codex-Claude Config Plan

1. 记录当前状态与根因：
   - 全局 Claude user config 只有 `chrome-devtools`
   - 当前仓库 `.mcp.json` 承载 `review-memory`
   - mem9 API 未常驻，`.env` 也无全局 `MEM9_*`
2. 在 `/Users/admin/.claude/scripts/` 新增全局 wrapper：
   - 启动前探测 `http://127.0.0.1:8080`
   - 不可用时执行 `docker compose ... up -d postgres mnemo-server`
   - 等待 API 健康后再 `exec` review-memory MCP server
3. 把 `review-memory` 注册到 Claude Code user config：
   - command 指向全局 wrapper
   - env 仅保留 `MEM9_API_URL` / `MEM9_API_KEY` / `REVIEW_MEMORY_AGENT_NAME`
   - 不再设置 `REVIEW_MEMORY_REPO_ID`
4. 把 Codex 全局 `review-memory` 改成同一条 wrapper 启动链路：
   - command 指向全局 wrapper
   - env 仅保留 `MEM9_API_URL` / `MEM9_API_KEY` / `REVIEW_MEMORY_AGENT_NAME`
   - 不再设置 `REVIEW_MEMORY_REPO_ID`
5. 如果默认 Codex 新会话仍因沙箱权限无法访问本机 mem9：
   - 调整 `/Users/admin/.codex/config.toml` 的默认 sandbox 配置到可直接访问本机 mem9 的模式
   - 以默认新会话再次验证 `curl 127.0.0.1:8080` 与 `review_memory_find_candidates`
6. 清理当前仓库的 `.mcp.json` 中 `review-memory` 依赖，避免 project-scope 覆盖 user-scope。
7. 清理 Codex 全局 skills 中已失效的软链，避免每次新会话启动刷错误。
8. 启动并验证：
   - docker compose 状态
   - curl 健康探测
   - `claude mcp get review-memory`
   - `codex mcp get review-memory`
   - 在非 `clawnews` 目录再次检查 scope / connectivity
