# New Web Health Fixes Spec

## Goal

一次性收口 `new-web + shared/web libs + prisma` 当前已确认的仓库健康问题：移除高风险 `xlsx` 依赖但保留 `.xlsx` 模板导入能力，补上 agent API key 失败限流回退，修复 Soul/Collection 详情的重复链上报价读取，避免 Soul detail 拉取无限增长的 `skillVersions`，把 community post tags 从 CSV 字符串切到数组模型并加速查询，同时清理孤儿类型声明并完成本轮约定的依赖升级。

## Scope

- `new-web/app/collections/create/souls/**`
- `new-web/lib/soulidity/**`
- `new-web/app/api/souls/**`
- `new-web/app/api/collections/[id]/route.ts`
- `new-web/app/api/community/**`
- `new-web/app/community/**`
- `new-web/components/community/**`
- `new-web/components/souls/**`
- `new-web/lib/hooks/use-community.ts`
- `web/lib/rate-limit.ts`
- `web/app/api/community/**`
- `web/app/community/**`
- `src/shared/**`
- `src/types/**`
- `prisma/schema.prisma`
- `prisma/migrations/**`
- `prisma/MANUAL_INDEXES.md`
- `package.json`
- `web/package.json`
- `new-web/package.json`
- relevant lockfiles
- `tests/new-web/**`

## Non-Goals

- 不处理 legacy `web` 管理面权限问题
- 不改 community 产品交互和页面视觉
- 不扩展新的社区检索维度，只修复现有 `tag` 查询模型
- 不改 Soulidity 合约或链上对象结构

## Constraints

- `new-web` 批量导入仍需支持 `.xlsx` 和 `.csv`；旧 `.xls` 支持可以移除，但不能继续保留误导性文案或接受面
- agent API key 失败限流在无可信 IP 时也必须工作，且不能退化为放行无限尝试
- Soul/Collection 详情页不能再为每次请求都无缓存拉取 `MarketConfig`
- Soul detail 首屏不能再全量拉取所有 skill 历史；完整历史必须有单独读取路径
- community `Post.tags` 新模型确认替代旧 CSV 后，本轮需要同轮清理旧查询、旧序列化和误导性类型
- 手工索引若 Prisma 不能完整表达，必须补 migration 和登记文档
- 所有完成声明前必须有新鲜验证证据

## Acceptance

1. `new-web` 不再依赖 `xlsx`，批量模板下载/解析继续支持 `.xlsx` 与 `.csv`，并拒绝或不再宣称支持 `.xls`。
2. agent API key 失败限流在有 IP、只有匿名指纹、两者都缺失三种情况下都能命中稳定桶，不再出现“无 IP 即不节流”。
3. Soul detail、Collection detail 以及复用同一配置的相关读路径通过统一缓存读取 `MarketConfig`，避免每个请求直连链上读取。
4. Soul detail 不再返回无限增长的 `skillVersions`；首屏只返回受限预览和总量，完整历史改由独立接口分页读取。
5. `Post.tags` 从 `String?` 切到 `String[]`，`GET /api/community/posts` 使用数组查询而不是 CSV `contains`，并有对应索引/migration 支撑。
6. new-web/community 读写链路统一消费数组 tags；shared article-to-post sync 和仍参与编译的 legacy community 路径完成必要兼容。
7. `src/types/node-fetch.d.ts`、`src/types/xml2js.d.ts` 删除，不留孤儿声明。
8. 约定的依赖升级完成：
   - root/web/new-web Prisma 栈升到同一版本
   - `next` / `react` / `react-dom` / `openai` / `dotenv` / `grammy` / `@tanstack/react-query` 升级
   - `node-cron`、`@mysten/sui`、`@privy-io/react-auth` 完成本轮升级并通过验证
9. 验证至少覆盖：
   - relevant `vitest` suites
   - `npm run typecheck`
   - `npm audit --omit=dev` 至少在 root / `new-web` 重新检查一次，确认 `xlsx` 告警已消失
