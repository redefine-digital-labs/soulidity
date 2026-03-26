# 旧数据兼容代码审计（开发环境）

## 结论

基于当前仓库实现与最近 PR 上下文（当前只支持单 Privy Sui 钱包、开发环境为主），仓库里仍存在一批“为历史数据/旧流程兜底”的代码。
其中有一部分是**可以尽快清理的无效兼容代码**，另一部分属于**迁移期可保留但应标记下线窗口**的过渡逻辑。

---

## A. 明显可清理的无效兼容代码（优先）

### 1) 发布草稿本地存储的 legacy key 迁移兜底

- 文件：`web/lib/souls/publish-draft.ts`
- 现状：`readSoulPublishDraft` 在读取 wallet-scoped key 失败后，会回退读取全局旧 key `SOUL_PUBLISH_DRAFT_STORAGE_KEY`，并做一次迁移。`clearSoulPublishDraft` 也保留了对旧 key 的条件删除。 
- 代码位置：`readSoulPublishDraft` 的 legacy fallback 与迁移逻辑（192-205），`clearSoulPublishDraft` 的 legacy 清理逻辑（216-225）。
- 判断：如果线上/测试环境已完成 wallet-scoped 草稿切换，且不再存在旧 key 写入入口，这段兼容分支将长期只增加维护成本与认知负担。

### 2) 发布路由对“单交易发布流程”的 backward compatibility 分支

- 文件：`web/app/api/souls/publish/route.ts`
- 现状：当 `releaseTxDigest` 缺失时，逻辑回退复用 `seriesTransaction` 校验 release 创建（注释明确为 backward compatibility）。
- 代码位置：173-179（注释与分支）。
- 判断：若当前前端已稳定要求 release 使用独立 txDigest（或提交必带 releaseTxDigest），该分支是旧流程残留，会掩盖请求契约问题并增加校验复杂度。

### 3) 认证链路中“按 tgId/email 回捞 legacy account”的自动关联

- 文件：`web/lib/auth/identity.ts`
- 现状：在找不到 `privyDid` 直连账号时，会按 tgId/email 依次回捞历史账号并补写 `privyDid/email/tgName`。
- 代码位置：341-400。
- 判断：如果项目阶段已切到纯 Privy 新账号体系、并且历史 Telegram/邮箱账号不再需要自动并档，这段逻辑属于历史迁移兜底，继续保留会放大身份合并的隐性复杂度。

---

## B. 迁移期逻辑（非立即删除，但建议明确下线时间）

### 4) `members.wallet` 到 `wallet_bindings` 的迁移 SQL

- 文件：`prisma/migrations/20260323173000_drop_member_wallet_legacy_fallback/migration.sql`
- 现状：完整保留了 legacy `members.wallet` 的校验、冲突检测和回填流程。
- 判断：这是 migration 历史的一部分，通常不应改写；但可在工程文档中明确“仅历史迁移用途，不代表当前运行时兼容策略”。

### 5) 旧 snake_case 结果类型映射层

- 文件：`src/db/database.ts`
- 现状：注释明确是 “Prisma model → legacy snake_case types”。
- 代码位置：219 起。
- 判断：若上层调用已全面切到 Prisma/camelCase DTO，这层可评估下线；若仍有 bot/scheduler 依赖，则应保留并补注释说明存量调用方。

---

## 建议执行顺序（一次性收口）

1. **先删 A1（publish-draft legacy key fallback）**：收益高、风险低、验证简单。
2. **再删 A2（publish releaseTxDigest backward fallback）**：同时把 API 契约改成“release 发布必须显式提供 releaseTxDigest”。
3. **评估 A3（legacy account 回捞）**：若确认无历史账号并档需求，改为严格 `privyDid` 唯一来源。
4. **保留 B 类但补文档**：标注“仅历史迁移/兼容层”，并登记预期下线里程碑。

---

## 验收建议

- publish 草稿：确认仅 wallet-scoped key 生效，不再读取/写入旧全局 key。
- publish mirror：缺失 `releaseTxDigest` 直接返回 4xx，避免静默 fallback。
- 身份解析：仅 `privyDid` 路径可登录；tgId/email 不再触发自动并档。
- 回归：`souls publish/release`、登录、草稿恢复、钱包绑定相关测试全绿。
