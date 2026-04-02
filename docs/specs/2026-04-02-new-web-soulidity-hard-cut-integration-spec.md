# New-Web × Soulidity Hard-Cut Integration Spec

## Goal

一次性把 `new-web` 的 Soul 产品链路切到 `move/soulidity`，让 `new-web` 成为唯一的 Soulidity 前端与 BFF 入口；同轮移除对旧 `web/lib/souls/**`、allowlist 模型、模拟交易、mock Soul/Collection 数据和旧 Soul API 运行时的依赖，不留双轨、不留兼容尾巴。

## 已观察事实

### 1. `new-web` 目前仍依赖旧 Soul 运行时

- `new-web/app/api/souls/**` 大量直接导入 `@web/lib/souls/**`、`@web/lib/auth/**`、`@web/lib/services/**`。
- `new-web/tsconfig.json` 通过 `@web/* -> ../web/*` 把 `new-web` 绑定到了旧 `web` 工程。
- `new-web/lib/hooks/use-publish.ts`、`use-purchase.ts`、`use-list-soul.ts` 仍然使用 simulated digest 或 placeholder 参数，不是真实上链执行。

### 2. 旧运行时和 `move/soulidity` 的对象模型不一致

- `web/lib/souls/on-chain-verification.ts` 仍按旧 `soul_object` 读取 `allowlist_address`、`allowlist_version`、`content_blob` 等字段，并假定 `SoulListed` / `SoulPurchased` 事件里有 `kiosk_cap_id`、`seller_kiosk_id`、`buyer_kiosk_cap_id`。
- `move/soulidity/sources/seal_policy.move` 已切成 `seal_approve_owner` / `seal_approve_granted_agent`，没有 allowlist 路径。
- `move/soulidity/sources/market.move` 已切成 `Soul` / `SoulState` / `SoulListing` / `SoulCollectionRight` / `SoulGrant` / `SoulMemory` 的目标态模型，事件字段也与旧运行时不同。

### 3. `new-web` 的关键产品页仍有原型态残留

- `new-web/app/market/page.tsx`、`new-web/app/collections/[id]/page.tsx`、`new-web/app/collections/[id]/buy/page.tsx`、`new-web/app/my-souls/page.tsx` 等仍依赖 `mockSouls` / `mockCollections`。
- `new-web/app/souls/[id]/page.tsx` 和买卖页仍使用 mock fallback，而不是纯真实数据。
- 导航里存在 `/create-collection` 之类未真正落地的入口，说明当前产品路径还不是可收口状态。

### 4. 当前数据库真相源仍是旧 Soul 模型

- `prisma/schema.prisma` 里的 `SoulAsset` 仍带 `allowlistAddress`、`allowlistCapOnChainId`、`allowlistVersion`。
- 当前只覆盖 Soul 自身与 prepared purchase，没有 `SoulCollection`、`SoulGrant`、`SoulMemory` 的目标态投影。

## 方案比较

### 方案 A：在 `new-web` 内新建 `lib/soulidity/**` 适配层，硬切替换旧 `@web/lib/souls/**`

- 做法：以 `move/soulidity` 为唯一协议真相源，在 `new-web` 内重建查询、事件解析、TX builder、API mirror、Prisma projection 和 UI hooks。
- 优点：边界最干净，能把 allowlist、旧事件假设、旧 env、旧类型一次性拔掉。
- 缺点：本轮改动面最大，需要同时处理 API、DB、UI 和旧入口清理。

### 方案 B：继续改造 `web/lib/souls/**`，让旧运行时同时兼容 `soul_object` 与 `soulidity`

- 做法：在旧 `web/lib/souls/**` 上继续加分支，兼容两套合约和两套事件。
- 优点：表面 diff 更小，`new-web` 可以继续借用旧实现。
- 缺点：会把 allowlist / grant、旧事件 / 新事件、旧 schema / 新 schema 一起搅在一层里，长期一定留尾巴。

### 方案 C：前端直接读链，尽量不做数据库投影

- 做法：`new-web` 绝大多数页面直接查 Sui，对 Postgres 只保留社区和账号数据。
- 优点：数据库迁移最少。
- 缺点：市场列表、Collection、Grant、Memory、我的资产、搜索/排序/分页、交易恢复都难做稳定；不适合这个仓库现有结构。

## 决策

采用方案 A。

理由：

- 这是唯一符合“一次集成，不留尾巴”的路径。
- `move/soulidity` 已经不是旧 `soul_object` 的小改版，而是权利对象、访问控制和交易模型都变了。
- `new-web` 现在虽可借旧 `web` 的账号、Prisma、Walrus/Seal 基础设施，但 Soul 协议适配层必须独立出来，否则旧语义会一直污染新产品。

## Scope

- `move/soulidity/**`
- `new-web/lib/**`
- `new-web/app/api/souls/**`
- `new-web/app/api/auth/**`
- `new-web/app/api/community/**` 中与 Soul/Collection 展示耦合的读接口
- `new-web/app/market/**`
- `new-web/app/souls/**`
- `new-web/app/collections/**`
- `new-web/app/create/**`
- `new-web/app/import/**`
- `new-web/app/wrap-link/**`
- `new-web/app/my-souls/**`
- `new-web/components/**` 中与 Soul/Collection/Grant 交互相关的组件
- `prisma/schema.prisma`
- `prisma/migrations/**`
- `.env.example`
- `package.json`
- `tests/web/**`

## Non-Goals

- 根目录新闻采集、生产、发布链路
- 旧 `web` 中与 Soul 无关的页面和后台
- 这轮之外的运营功能、举报治理、AI agent 主动发起 grant request 流程
- 为兼容旧 `soul_object` 再保留任何双轨逻辑

## Constraints

- 协议真相源只能是 `move/soulidity`；不能再从 `soul_object` 借 ABI、事件或字段语义。
- `new-web` 在 Soul 业务代码里不得继续依赖 `@web/lib/souls/**`。
- allowlist 语义必须整体退出，统一切到 `SoulGrant`。
- 用户可见交易链路不得再出现 simulated digest、placeholder contract 名称、假成功页。
- 所有展示 Soul / Collection / Grant 状态的关键页面必须使用真实数据；允许保留静态文案，但不允许关键业务视图靠 mock fallback 驱动。
- 切换时不得保留两个对外可写的 Soul API 入口；旧 `web` 的 Soul API 需要删除、下线或只保留显式 redirect / gone 行为。

## Target Architecture

### 1. 运行时归属

- Soulidity 产品运行时由 `new-web` 独占。
- 用户侧页面路由继续保留 `/market`、`/souls/*`、`/collections/*`、`/create/*`、`/import/*`、`/wrap-link/*` 这些产品路径，不为了技术迁移改用户路径。
- 旧 `web/app/souls/**`、`web/app/api/souls/**`、`web/app/api/agent/souls/**` 不再承载活跃 Soul 业务。

### 2. 前端与 BFF 分层

- 在 `new-web/lib/soulidity/**` 新建协议适配层，最少包含：
  - `env.ts`：新 env 读取与校验
  - `types.ts`：`Soul`、`SoulState`、`SoulListing`、`SoulCollection`、`SoulCollectionRight`、`SoulGrant`、`SoulMemory`、`MemoryEntry`
  - `queries.ts` / `events.ts`：链上对象与事件解析
  - `tx/`：publish / list / delist / buy / create-collection / buy-collection / issue-grant / revoke-grant / import / personal-join builder
  - `mirror/`：交易后校验与 DB upsert
- `new-web/app/api/**` 只作为鉴权、限流、链上校验、DB projection 和恢复层，不再承担旧协议兼容逻辑。

### 3. 数据真相源与投影

- 链上对象是唯一真相源：
  - `Soul`
  - `SoulState`
  - `SoulListing`
  - `SoulCollection`
  - `SoulCollectionRight`
  - `SoulGrant`
  - `SoulMemory`
  - `MemoryEntry`
- Postgres 只保留查询型 projection，不再发明链上没有的旧语义补丁。
- 推荐 projection 结构：
  - 保留并重定义 `SoulAsset`，新增/替换为 `stateOnChainId`、`memoryOnChainId`、`provenanceKind`、`originRef`、`collectionOnChainId`、`activeGrantOnChainId`、`activeGranteeAddress`
  - 新增 `SoulCollectionAsset`
  - 新增 `SoulGrantRecord`
  - 新增 `SoulMemoryEntry` 或 `SoulMemoryCursor`
  - 保留交易恢复表，但 route key 和字段按 `soulidity` 重定义
- 旧 allowlist 字段、旧 prepared purchase 假设、旧 tx-sync key 必须同轮清理。

### 4. 访问控制与内容下载

- 内容访问统一收敛为：
  - owner 访问：`seal_policy::seal_approve_owner`
  - granted agent 访问：`seal_policy::seal_approve_granted_agent`
- 不再保留 allowlist access cap、allowlist registry、allowlist set/clear UI 和 API。
- Memory 写入与访问能力以 `SoulGrant` 单活授权为准，不再沿用旧“允许地址”模型。

### 5. 页面与功能收口

- 本轮必须真实打通的产品能力：
  - Soul market list/detail/buy/sell/delist
  - Create Soul
  - Import Soul
  - Personal Join
  - Collection create/detail/buy/list/delist
  - My Souls / My Collections
  - Grant issue / revoke / current status
  - Soul content access
- 本轮必须移除的原型残留：
  - `mockSouls` / `mockCollections` 在关键业务页的依赖
  - simulated tx digest
  - 未落地的 `/create-collection` 伪入口
  - 旧 contract label（如 `SoulFactory::create_series` 一类 placeholder）

### 6. 环境变量与配置

- 旧 `NEXT_PUBLIC_SOUL_OBJECT_*` 命名不再延续到新方案。
- 新方案统一用 `SOULIDITY` 前缀，例如：
  - `NEXT_PUBLIC_SOULIDITY_PACKAGE_ID`
  - `NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID`
  - `NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID`
  - `NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID`
  - `NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE`
- Seal / Walrus / Privy 基础设施可复用现有能力，但接入点必须迁到 `new-web/lib/soulidity/**`。

### 7. 切换方式

- 开发过程允许在同一分支内分层推进，但上线切换必须是单次硬切。
- 上线前必须做一次数据库快照。
- 上线时同步执行：
  - 新 env 生效
  - 新 Prisma migration 生效
  - 新 `new-web` 运行时生效
  - 旧 `web` Soul 入口下线/重定向

## Acceptance

1. `new-web` 的 Soul 业务代码中不再导入 `@web/lib/souls/**`，也不再依赖旧 `web` 的 Soul API 运行时。
2. `new-web` 的 publish / buy / list / delist / grant / collection / import / personal join 全部使用真实 `move/soulidity` PTB 构建与真实签名执行，不再出现 simulated digest。
3. `new-web/app/api/souls/**` 及新增 `collections` / `grants` 相关路由只校验 `move/soulidity` 对象与事件，不再读取 allowlist 语义。
4. `allowlist` API、allowlist UI、allowlist DB 字段、allowlist env 在活动代码中全部删除。
5. `market`、`soul detail`、`buy`、`sell`、`collections`、`my-souls`、`create`、`import`、`wrap-link` 的关键业务数据全部来自真实 API / DB projection，不再依赖 `mockSouls` / `mockCollections`。
6. Prisma schema 能表达 Soul、Collection、Grant、Memory 的目标态 projection；旧 Soul 数据通过硬切 migration 清空或迁出，避免新旧协议数据混放。
7. 旧 `web` 的 Soul 页面/API 不再对外提供活跃写能力；若旧站点继续部署，Soul 路由必须 redirect / gone，而不是继续跑旧逻辑。
8. `.env.example`、repo contract 测试、技术文档都以 `Soulidity` 命名和新协议对象为准。
9. 验证至少覆盖：
   - `npm test`
   - `npm --prefix new-web run typecheck`
   - `npm --prefix new-web run build`
   - `sui move test --path move/soulidity`
10. 若因链上环境、外部 RPC、Seal/Walrus 测试条件受阻，阻塞点必须记录到实施结果中，但不得以“先保留旧逻辑”代替收口。

## Risk Notes

- 最大风险不在前端样式，而在旧 `web/lib/souls/**` 的语义污染；这也是本方案坚持新建 `new-web/lib/soulidity/**` 的原因。
- Prisma 是本轮唯一需要明确回滚点的部分；执行 migration 前必须先做数据库快照。
- `move/soulidity` 现有事件字段虽足以支撑业务，但 mirror 层不能再假设旧事件字段存在，必须改成“事件 + 对象查询 + 必要的客户端已知参数”组合校验。
