# 旧兼容代码审计（2026-03-26 实施版）

## 复核结论

基于当前仓库代码、测试和文档重新核对后，原审计里的 5 项中已有 2 项在本轮完成清理：

- `A1` 发布草稿本地存储的 legacy global key fallback：已清理。
- `A2` 发布镜像路由对“单交易发布流程”的 backward compatibility fallback：已清理。

另外 3 项需要修正分类：

- `A3` 认证链路里按 `tgId/email` 回捞 legacy account：目前**不适合直接删除**，它仍是现有认证/迁移验收的一部分。
- `B4` `members.wallet -> wallet_bindings` migration SQL：属于**历史 migration**，应保留，不应回写修改历史迁移。
- `B5` `src/db/database.ts` 的 snake_case 映射层：原判断**不成立**，这不是废弃兼容层，而是当前 root pipeline 的活跃接口。

---

## A. 确认可清理项

### 1) 发布草稿本地存储的 legacy global key fallback

- 文件：`web/lib/souls/publish-draft.ts`
- 现状：
  - `readSoulPublishDraft` 只读取 wallet-scoped key，不再回退读取全局旧 key `SOUL_PUBLISH_DRAFT_STORAGE_KEY`
  - `writeSoulPublishDraft` / `clearSoulPublishDraft` 只操作 wallet-scoped key
- 复核证据：
  - `rg` 结果显示当前运行时调用方只有 `web/app/souls/publish/page.tsx`
  - 仓库内已不存在其他旧全局 key 写入入口
  - `tests/web/soul-publish-draft.test.ts` 已改为验证“忽略 legacy global key”与“wallet-scoped draft 归一化恢复”
- 判断：
  - 这是纯前端本地持久化兼容分支，调用面单一，已完成收口
  - 旧浏览器里遗留的裸 key 会被显式忽略，不再做静默迁移

### 2) 发布镜像路由对“单交易发布流程”的 backward compatibility fallback

- 文件：`web/app/api/souls/publish/route.ts`
- 现状：
  - `releaseOnChainId` 与 `releaseTxDigest` 现在是显式成对契约：缺一即 `400`
  - route 不再回退复用 `txDigest` 对应的 `seriesTransaction` 校验 release
- 复核证据：
  - 当前调用方只有 `web/app/souls/publish/page.tsx`
  - 该页面已经显式分步执行 release 上链，并在提交 mirror 时始终传 `releaseTxDigest`
  - `tests/web/soul-publish-route.test.ts` 已改为验证“缺失 `releaseTxDigest` 时在任何链上校验前直接返回 `400`”
- 判断：
  - 这是旧单交易发布流程残留，已收口为强契约：`releaseOnChainId` 存在时必须同时提供 `releaseTxDigest`
  - 对“旧浏览器草稿恢复后只有 `releaseId` 没有 `releaseTxDigest`”的场景，已在 draft 读取层显式清空 release 相关字段，避免再依赖服务端 fallback

---

## B. 本轮不应直接删除的项

### 3) 认证链路中按 `tgId/email` 回捞 legacy account 的自动关联

- 文件：`web/lib/auth/identity.ts`
- 原审计判断：如果已经切到纯 Privy 新账号体系，可改成只认 `privyDid`
- 复核结果：**本轮不应清理**
- 证据：
  - `tests/web/identity.test.ts` 仍有 3 条明确测试在验证：
    - 首次 Privy 登录按 `tgId` 回捞
    - `email` 被占用时回退只补 `privyDid/tgName`
    - 按 `email` 回捞 legacy account
  - `docs/test-plan-auth.md` 的 `AC5` / `AC8` 仍把“409 后 refresh 自动关联账号”列为人工验收场景
  - `web/components/auth-provider.tsx` 会在登录后调用 `/api/auth/me`，而 `/api/auth/me` 依赖 `resolveIdentity()`；这条自动关联链路仍是实际产品路径
  - `web/app/api/register/route.ts` 当前创建 `Account` 时仍会写入 `tgId`，说明账号模型还没有彻底退出 TG 维度
- 判断：
  - 这不是“无调用方的历史兜底”，而是尚未完成下线的认证迁移逻辑
  - 若要删除，必须作为单独 auth decommission 项目处理，先补数据盘点、验收调整和登录链路迁移

### 4) `members.wallet` 到 `wallet_bindings` 的迁移 SQL

- 文件：`prisma/migrations/20260323173000_drop_member_wallet_legacy_fallback/migration.sql`
- 复核结果：**保留**
- 原因：
  - 这是历史 migration，不是运行时兼容逻辑
  - migration 中保留 legacy 校验、冲突检测和回填是合理的，不能把“想清理兼容代码”扩展成“篡改历史迁移”
- 建议：
  - 只补文档说明“这是历史迁移脚本，不代表当前运行时兼容策略”

### 5) `src/db/database.ts` 的 snake_case 映射层

- 文件：`src/db/database.ts`
- 原审计判断：如果上层全面切到 Prisma/camelCase DTO，可评估下线
- 复核结果：**当前不属于 legacy compat cleanup**
- 证据：
  - `src/db/database.ts` 当前直接以 `src/shared/types.ts` 的 snake_case 类型作为函数入参与返回值
  - 运行时调用方覆盖 root 主链路：`src/collector/*`、`src/producer/*`、`src/bot/*`、`src/scheduler.ts`
  - 这层不仅是 bot/scheduler 的残留适配，而是当前 root 服务代码的稳定接口
- 判断：
  - 如果未来要统一 camelCase，需要单独立项做 root pipeline 数据模型改造
  - 不能把它误算进这次 Souls/auth 兼容清理

---

## 修正后的清理顺序

### 第一批：已完成

1. 已删除 `web/lib/souls/publish-draft.ts` 里的 legacy global key fallback。
2. 已收紧 `web/app/api/souls/publish/route.ts` 契约：
   - `releaseOnChainId` 存在时必须显式提供 `releaseTxDigest`
   - 缺字段时在任何链上校验前直接返回 `400`
3. 已同步更新 `tests/web/soul-publish-draft.test.ts`、`tests/web/soul-publish-route.test.ts`
4. 已明确采用“清空旧 draft 的 release 相关字段”策略，避免恢复旧本地状态后行为模糊

### 第二批：只做文档边界收口

1. 在清理计划 / Spec 中把 `A3` 改为“独立 auth decommission 项目”
2. 给 `B4` 补“历史 migration only”说明
3. 把 `B5` 从本轮清理范围中移出

### 第三批：单独立项，不并入本轮

1. auth 迁移收尾：
   - 盘点 `accounts.privy_did IS NULL` / `accounts.email IS NULL` / 依赖 `tgId` 的真实数据规模
   - 删除 `resolvePrivyIdentity()` 的 `tgId/email` 自动回捞
   - 同步改 `docs/test-plan-auth.md`、`tests/web/identity.test.ts`、claim/register 验收
2. root pipeline 命名统一：
   - 若要去掉 snake_case，需要单独改 `src/shared/types.ts`、`src/db/database.ts` 和全部 root 调用方

---

## 本轮验收结果

- publish draft：
  - 只恢复 wallet-scoped draft
  - 不再读取或迁移裸 `SOUL_PUBLISH_DRAFT_STORAGE_KEY`
- publish mirror：
  - `releaseOnChainId` 存在但 `releaseTxDigest` 缺失时直接返回 `400`
  - 在返回 `400` 前不触发 `getTransactionBlock` / `getObject`
- stale draft：
  - 对“有 `releaseId` 但无 `releaseTxDigest`”的旧本地状态，读取时直接清空 `releaseId` / `releaseTxDigest` / `sealDekEnvelope`
- auth：
  - 本轮不改 `resolvePrivyIdentity()` 的 `tgId/email` 自动关联行为
  - `tests/web/identity.test.ts` 仍作为 defer 边界验证
