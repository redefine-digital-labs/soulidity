# Review-Memory MCP Implementation Plan

## Step 1

先把 review-memory 的核心模型补齐：

- 定义远端 record / candidate / backfill 结果类型
- 规范 `uid` / `fingerprint` 计算
- 解析归档 markdown 为结构化 records
- 封装 mem9 HTTP client 与排序 / upsert 服务层

## Step 2

把入口层接上仓库运行方式：

- 新增 `stdio` MCP server，暴露查询 / 读取 / 写入 3 个工具
- 新增 backfill CLI，默认找最新 `review/batch-N`
- 在 `.env.example`、`package.json`、`tsconfig.json` 中补齐运行与校验入口

## Step 3

用测试和命令验证可用性：

- 跑 `tests/mcp/**` 覆盖核心行为
- 跑 `npm run typecheck:root` 确认新增入口可编译
- 用 `npm run review-memory:backfill -- --help` 验证 CLI 入口
