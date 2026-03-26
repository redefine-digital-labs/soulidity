# Legacy Compat Cleanup Spec

**日期**: 2026-03-26
**状态**: 已实施
**范围**: Souls 发布草稿存储兼容、Souls publish mirror 契约、相关测试与审计文档

## 1. 目标

一次性清理当前仓库里已确认失效的 Souls 兼容分支，同时把“看起来像 legacy、实际仍是当前契约”的逻辑明确排除出本轮，避免误删。

## 2. 本轮范围

- `web/lib/souls/publish-draft.ts` 的 legacy global key fallback
- `web/app/api/souls/publish/route.ts` 对 `releaseTxDigest` 的 backward compatibility fallback
- `tests/web/soul-publish-draft.test.ts`
- `tests/web/soul-publish-route.test.ts`
- `LEGACY_COMPAT_AUDIT.md`

## 3. 非目标

- 不删除 `web/lib/auth/identity.ts` 中按 `tgId/email` 自动回捞账号的逻辑
- 不改写历史 migration：`prisma/migrations/20260323173000_drop_member_wallet_legacy_fallback/migration.sql`
- 不处理 `src/db/database.ts` / `src/shared/types.ts` 的 snake_case 接口统一

## 4. 约束

- 必须以当前仓库事实为准，不能基于“应该已经迁移完了”的假设直接删 auth 逻辑
- 删除兼容分支后，旧本地草稿若无法满足新契约，必须显式失效或显式要求重建，不允许继续依赖服务端静默 fallback
- 所有清理都要同步更新测试和审计文档

## 4.1 本轮采用的显式策略

- 对旧浏览器草稿里“`releaseId` 存在但 `releaseTxDigest` 缺失”的状态，在 `readSoulPublishDraft()` 读取时直接清空 `releaseId` / `releaseTxDigest` / `sealDekEnvelope`
- `/api/souls/publish` 不再承担旧契约恢复职责，只接受显式完整的 release mirror 参数

## 5. 验收

1. `readSoulPublishDraft()` 只读取 wallet-scoped key，不再读取或迁移裸 `SOUL_PUBLISH_DRAFT_STORAGE_KEY`。
2. `clearSoulPublishDraft()` / `writeSoulPublishDraft()` 不再依赖旧 global key 兼容分支。
3. `/api/souls/publish` 在 `releaseOnChainId` 存在但 `releaseTxDigest` 缺失时，必须在任何链上校验前返回 `400`。
4. 旧浏览器草稿若出现 `releaseId` 存在但 `releaseTxDigest` 缺失，必须有明确处理策略，不能再依赖 route fallback。
5. `tests/web/soul-publish-draft.test.ts` 和 `tests/web/soul-publish-route.test.ts` 反映新契约并通过。
6. `LEGACY_COMPAT_AUDIT.md` 明确标注：
   - `A1/A2` 纳入本轮清理
   - `A3` 转为独立 auth decommission 项目
   - `B4` 为历史 migration
   - `B5` 不属于本轮 legacy cleanup
