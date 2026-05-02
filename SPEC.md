# Soul Content Storage Hard-Cut Spec

## Goal

按 `/Users/admin/.claude/plans/harmonic-puzzling-puzzle.md` 一次性把 `move/soulidity + new-web + prisma` 的 Soul 内容存储链路切到新架构：Memory 改为 `Table<u64, ID>`、Skills 改为 `Table<String, vector<SkillSlot>>`，Soul/Memory/Skills 全部具备 Seal sidecar 和 access API，默认走加密上传，并同步清理旧 `MemoryEntry` / `SkillVersion` / `latestSkillVersionOnChainId` / 旧路由形状等兼容尾巴。

## Scope

- `move/soulidity/**`
- `prisma/schema.prisma`
- `prisma/migrations/**`
- `new-web/lib/soulidity/**`
- `new-web/lib/hooks/**`
- `new-web/app/api/souls/**`
- `new-web/app/api/agent/souls/**`
- `new-web/app/create/**`
- `new-web/app/import/**`
- `new-web/app/wrap-link/**`
- `new-web/app/resources/**`
- `new-web/app/souls/[id]/page.tsx`
- `new-web/components/souls/**`
- `docs/specs/soul-content-format.md`
- `tests/new-web/**`

## Non-Goals

- 不兼容旧链上 `move/soulidity` 数据，不做迁移
- 不保留旧 object ID、旧 route 参数形状、旧 projection 唯一键
- 不处理 `timestamp_ms` 同毫秒碰撞
- 不扩展新权限模型；继续以 owner / granted-agent / public 为边界

## Constraints

- 以 fresh deploy 为前提，开发环境允许直接重建 package/shared object/DB schema
- 新方案确认替代旧方案后，旧字段、旧路由、旧查询逻辑、旧 UI 文案、旧测试断言必须同轮清理
- Memory 默认 encrypted upload，不再保留 public blob 作为默认产品路径
- Skills 上传入口限制 `.zip`，`skillName` 以 ZIP 内 `SKILL.md` frontmatter `name` 为准
- `new-web` 细节页、skills panel、access API 不能再依赖 `entryIndex` / `versionOnChainId` / `latestSkillVersionOnChainId`
- 所有完成声明前必须有新鲜验证证据

## Acceptance

1. `move/soulidity` 完成新对象模型：`SoulState.memory_id`、`SoulMemory.entries: Table<u64, ID>`、`SoulSkills.skills: Table<String, vector<SkillSlot>>`，并移除 `MemoryEntry` / `SkillVersion` 链路依赖。
2. `move/soulidity` event 与 approval 契约切到新复合键：memory 使用 `timestamp_key`，skills 使用 `skill_name + version_index`。
3. Prisma schema 与 projection 改成 `(memoryOnChainId, timestampKey)` 和 `(skillsOnChainId, skillName, versionIndex)` 唯一键，不再保留 `latestSkillVersionOnChainId`、`entryIndex`、`versionOnChainId`、`previousVersionOnChainId`。
4. `new-web/lib/soulidity` 的 types / queries / events / repository / mirror / access / tx builder 全部收口到新契约。
5. create / import / personal-join / memory append 默认走 encrypted upload，并能构建 founding/append memory sidecar。
6. human / agent memory access route 按 `/memory/[entryKey]/access` 工作；human / agent skills access/delete route 按 `/skills/[skillName]/versions/[versionIndex]/*` 工作。
7. skills append/list/delete/open 支持多 skill，默认 private；显式 public 路径仍可工作。
8. create/import/wrap-link 页面、Soul detail 页和 skills panel 使用新模板、新字段和新资源页入口，不再暴露旧格式或旧 key。
9. `docs/specs/soul-content-format.md` 更新为新方案已实现规范。
10. 验证至少覆盖：
   - `sui move test --path move/soulidity`
   - `npm test -- tests/new-web/**` 或等价覆盖 relevant new-web suite
   - `npm --prefix new-web run typecheck`
   - `npm --prefix new-web run build`

## Audit Closeout Addendum — 2026-05-02

本轮在 fresh deploy / mainnet reset 前提下继续收口 Soulidity 审计项，不保旧链上 ABI 或旧对象布局。

追加验收：

1. `SoulState.active_grants` 不再是可枚举 vector，改为 grantee / grant-id 双 Table 索引与 `active_grant_count`；owner rotation 只归零当前 active count，旧 grant 通过 epoch mismatch 懒失效。
2. grant 发放拒绝当前或过去的过期时间；revoke / revoke-scope / assert / destroy / cleanup 都只触碰目标 grant id 或 grantee，避免 O(n) 清理。
3. `ContentAccessList` 与 `SoulState.access_list_id` 双向绑定；add / revoke / price / duration / scope / seal approve / purchase 全部拒绝未绑定 access list。
4. Content access entry 继续 epoch-pinned，旧 epoch row 保留审计价值，并提供 permissionless stale-row cleanup。
5. assets / skills soft-delete 后可由 owner purge 对应 Walrus Blob dynamic object field；purged / deleted version 不可再通过 Seal approval。
6. metadata active sprite / voice 底层 setter 只保留 package 内部可见，外部必须走 `market` wrapper，继续校验 asset 存在、未删、类型与 public/private policy。
7. `register_existing_personal_kiosk` 删除，所有登记路径统一到 `ensure_personal_kiosk_registered`；content access 禁止 owner 自购。
8. mint / collection create / listing 护栏提前拒绝 platform fee + royalty 超过 `MAX_BPS` 的组合。
