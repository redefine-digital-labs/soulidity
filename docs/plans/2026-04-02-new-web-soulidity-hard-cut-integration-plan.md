# New-Web × Soulidity Hard-Cut Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `new-web` 的 Soul 产品一次性切到 `move/soulidity`，并同轮下线旧 `web/lib/souls/**` / allowlist / 模拟交易 / mock 业务数据的旧运行时。

**Architecture:** 前端页面路径保持 Soulidity 产品现有信息架构，但协议适配层整体迁到 `new-web/lib/soulidity/**`。链上对象继续做真相源，`new-web/app/api/**` 只负责鉴权、限流、校验和 Postgres projection；Prisma 只保留查询型镜像，不再承载旧 allowlist 补丁语义。

**Tech Stack:** Next.js 16、React 19、Privy、`@mysten/sui`、Walrus、Seal、Prisma/Postgres、Sui Move (`move/soulidity`)

---

### Task 1: 冻结协议与仓库契约边界

**Files:**
- Modify: `docs/specs/2026-04-02-new-web-soulidity-hard-cut-integration-spec.md`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `tests/web/repo-contracts.test.ts`

- [ ] 确认新 env 命名统一改为 `SOULIDITY` 前缀，不再沿用 `SOUL_OBJECT` / `ALLOWLIST`。
- [ ] 更新根脚本，使仓库级校验显式覆盖 `new-web`。
- [ ] 在 repo contract 测试里增加以下约束：
  - `new-web` 不得再导入 `@web/lib/souls/**`
  - `new-web` 业务关键页不得继续依赖 simulated tx
  - `new-web` 活动代码中不得继续暴露 allowlist 路由与 env
- [ ] 记录本轮切换前必须保留的唯一回滚点：数据库快照 + 旧部署镜像。

### Task 2: 新建 `new-web/lib/soulidity/**` 协议适配层

**Files:**
- Create: `new-web/lib/soulidity/env.ts`
- Create: `new-web/lib/soulidity/types.ts`
- Create: `new-web/lib/soulidity/queries.ts`
- Create: `new-web/lib/soulidity/events.ts`
- Create: `new-web/lib/soulidity/access.ts`
- Create: `new-web/lib/soulidity/personal-kiosk.ts`
- Create: `new-web/lib/soulidity/tx/publish.ts`
- Create: `new-web/lib/soulidity/tx/buy.ts`
- Create: `new-web/lib/soulidity/tx/list.ts`
- Create: `new-web/lib/soulidity/tx/delist.ts`
- Create: `new-web/lib/soulidity/tx/grant.ts`
- Create: `new-web/lib/soulidity/tx/collection.ts`
- Create: `new-web/lib/soulidity/tx/import.ts`
- Create: `new-web/lib/soulidity/tx/personal-join.ts`
- Modify: `new-web/lib/hooks/use-privy-sui.ts`

- [ ] 按 `move/soulidity` 的真实对象和事件建一套独立类型，不复用旧 `web/lib/souls/types.ts`。
- [ ] 实现对象读取：`Soul`、`SoulState`、`SoulListing`、`SoulCollection`、`SoulCollectionRight`、`SoulGrant`、`SoulMemory`、`MemoryEntry`。
- [ ] 实现事件读取：`SoulMintedToKiosk`、`SoulListed`、`SoulPurchased`、`CollectionMintedToKiosk`、`CollectionListed`、`CollectionPurchased`、grant/memory 相关事件。
- [ ] 实现真实 PTB builder，覆盖 publish / list / delist / buy / create collection / buy collection / issue grant / revoke grant / import / personal join。
- [ ] 让 `usePrivySuiSign` 成为统一签名执行入口，禁止上层 hook 再手写 simulated digest。

### Task 3: 重做数据库 projection 与 migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_hard_cut_new_web_to_soulidity_runtime/migration.sql`
- Modify: `web/lib/prisma.ts` 或 Prisma 生成配置所需文件
- Create: `new-web/lib/soulidity/mirror/upsert-soul.ts`
- Create: `new-web/lib/soulidity/mirror/upsert-collection.ts`
- Create: `new-web/lib/soulidity/mirror/upsert-grant.ts`
- Create: `new-web/lib/soulidity/mirror/upsert-memory.ts`
- Create: `new-web/lib/soulidity/mirror/tx-sync.ts`

- [ ] 以硬切方式改表，删除旧 allowlist 字段和旧 tx-sync 约束。
- [ ] 保留 `SoulAsset` 作为 Soul 主 projection，但补齐 `stateOnChainId`、`memoryOnChainId`、`provenanceKind`、`originRef`、`collectionOnChainId`、`activeGrantOnChainId`、`activeGranteeAddress`。
- [ ] 新增 `SoulCollectionAsset`、`SoulGrantRecord`、`SoulMemoryEntry` 或等价 projection。
- [ ] 重定义 tx-sync route key，覆盖 `publish`、`buy`、`list`、`delist`、`grant:issue`、`grant:revoke`、`collection:*`、`import`、`personal-join`。
- [ ] migration 中清空旧 Soul 运行时数据，避免 `soul_object` 与 `soulidity` 数据混读。

### Task 4: 用新适配层重写 `new-web` BFF 路由

**Files:**
- Modify: `new-web/app/api/souls/route.ts`
- Modify: `new-web/app/api/souls/[id]/route.ts`
- Modify: `new-web/app/api/souls/my/route.ts`
- Modify: `new-web/app/api/souls/upload/route.ts`
- Modify: `new-web/app/api/souls/publish/route.ts`
- Modify: `new-web/app/api/souls/[id]/purchase/route.ts`
- Modify: `new-web/app/api/souls/[id]/delist/route.ts`
- Modify: `new-web/app/api/souls/[id]/access/route.ts`
- Delete: `new-web/app/api/souls/[id]/allowlist/route.ts`
- Modify: `new-web/app/api/souls/personal-kiosk/route.ts`
- Create: `new-web/app/api/souls/[id]/grant/route.ts`
- Create: `new-web/app/api/collections/route.ts`
- Create: `new-web/app/api/collections/[id]/route.ts`
- Create: `new-web/app/api/collections/[id]/purchase/route.ts`
- Create: `new-web/app/api/collections/[id]/list/route.ts`
- Create: `new-web/app/api/import/route.ts`
- Create: `new-web/app/api/wrap-link/personal/route.ts`

- [ ] 所有 Soul/Collection API 改为只导入 `new-web/lib/soulidity/**`。
- [ ] publish / purchase / list / delist 流程改成“提交 txDigest + 必要对象 ID + 服务器二次校验 + projection upsert”。
- [ ] access 路由改成 owner / granted-agent 双路径，不再支持 allowlisted。
- [ ] 新增 Collection 和 Grant 的读写路由，覆盖产品真实能力。
- [ ] 保留现有认证、限流、Walrus/Seal/Privy 基础设施，但接线点迁入新适配层。

### Task 5: 收口 `new-web` 客户端 hook 与产品页面

**Files:**
- Modify: `new-web/lib/hooks/use-souls.ts`
- Modify: `new-web/lib/hooks/use-publish.ts`
- Modify: `new-web/lib/hooks/use-purchase.ts`
- Modify: `new-web/lib/hooks/use-list-soul.ts`
- Create: `new-web/lib/hooks/use-grant.ts`
- Create: `new-web/lib/hooks/use-collections.ts`
- Modify: `new-web/app/market/page.tsx`
- Modify: `new-web/app/souls/[id]/page.tsx`
- Modify: `new-web/app/souls/[id]/buy/page.tsx`
- Modify: `new-web/app/souls/[id]/sell/page.tsx`
- Modify: `new-web/app/souls/[id]/sell/authorize/page.tsx`
- Modify: `new-web/app/my-souls/page.tsx`
- Modify: `new-web/app/collections/[id]/page.tsx`
- Modify: `new-web/app/create/**`
- Modify: `new-web/app/import/**`
- Modify: `new-web/app/wrap-link/**`
- Modify: `new-web/components/**` 中与 Soul / Collection / Grant 交互相关组件

- [ ] 移除 `mockSouls` / `mockCollections` 在关键业务页的依赖。
- [ ] publish / buy / list / delist 全部改走真实 hook 和真实签名执行。
- [ ] Grant 管理 UI 改为 issue / revoke / current grant 状态，不再出现 allowlist 词汇。
- [ ] Collection detail / list 页面从 prototype 数据态切到真实 API，购买统一收口到 detail 页内联动作。
- [ ] Create / Import / Personal Join 页面改成真实交易准备流程，替换 placeholder contract 文案。
- [ ] 清理不存在的 `/create-collection` 等伪入口，改成真实页面或移除入口。

### Task 6: 清理旧运行时与双轨入口

**Files:**
- Delete or Replace: `web/lib/souls/**`
- Delete or Replace: `web/app/api/souls/**`
- Delete or Replace: `web/app/api/agent/souls/**`
- Delete or Replace: `web/app/souls/**`
- Modify: `tests/web/**`
- Modify: `docs/specs/**`
- Modify: `docs/plans/**`

- [ ] 决定旧 `web` 若继续部署时的 Soul 路由策略：统一 redirect 到 `new-web` 或返回 gone。
- [ ] 删除 `web/lib/souls/**` 活动运行时代码，至少保证不再被任何活动入口引用。
- [ ] 删掉旧 allowlist 测试、旧 repo contract 断言、旧 env 文档。
- [ ] 文档中统一用 `Soulidity` 对象命名，不再混用旧 `soul_object` 术语。

### Task 7: 验证、迁移演练与上线收口

**Files:**
- Modify as needed: `tests/web/**`
- Modify as needed: `move/soulidity/sources/protocol_tests.move`
- Modify as needed: CI / docs files

- [ ] 先跑协议验证：`sui move test --path move/soulidity`
- [ ] 跑仓库测试：`npm test`
- [ ] 跑前端校验：`npm --prefix new-web run typecheck`
- [ ] 跑前端构建：`npm --prefix new-web run build`
- [ ] 演练数据库迁移：备份 -> 执行 migration -> 校验 projection 表结构 -> 回滚演练
- [ ] 演练切换顺序：新 env -> migration -> 新部署 -> 旧 Soul 路由下线/redirect
- [ ] 最终验收以 spec 为准，不接受“主链路好了但旧 API 还留着”“先继续保留 mock fallback”这类半收口状态。

## 实施顺序建议

1. 先冻结 env / 路由 / DB 契约，否则后面会重复返工。
2. 再建 `new-web/lib/soulidity/**` 适配层，把协议语义从旧 `web/lib/souls/**` 脱钩。
3. 再做 Prisma hard-cut migration 和 BFF 重写。
4. 再收口客户端页面与交互。
5. 最后统一删旧入口、补测试、做上线演练。

## 必须项

- 新适配层独立
- allowlist 全量退出
- Collection / Grant / Memory 进入产品真链路
- mock / simulated tx 全量退出关键业务页
- 旧 `web` Soul 入口退役
- Prisma hard-cut migration
- 文档 / env / repo contract 同步收口

## 可选项

- 将 `new-web` 的协议统计卡片接成真实链上统计
- 将社区页里的 Soul 卡片和 Collection 卡片完全切到真实数据
- 增加链上回放脚本，用于从 `move/soulidity` 全量重建 projection

可选项不影响硬切主验收，但如果本轮要把 `new-web` 当作正式产品上线，建议把“协议统计真实化”和“projection 回放脚本”一起做掉。
